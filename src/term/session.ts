/** PtySession — binds one PTY to one stream of blocks.
 *
 * Responsibilities:
 *  - spawn/kill the shell
 *  - translate OSC 133 events into block boundaries
 *  - stream output lines into the current block
 *  - degrade to a single continuous block when the hooks are absent
 *
 * It deliberately knows nothing about React; the store subscribes to it.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import {
  RepaintDetector,
  entersAltScreen,
  leavesAltScreen,
  looksInteractive,
} from './altscreen'
import { parseCompletion, type CompletionResult } from './completion'
import { Osc133Parser, ansiToLines, stripAnsi } from './osc133'
import { detectStructured } from './renderers'
import {
  EXIT_CANCELLED,
  type Block,
  type Line,
  timestamp,
} from './types'

export interface SpawnOptions {
  shell?: string
  cwd?: string
  env?: Record<string, string>
  connectVia?: string
  integrationDir?: string
  cols?: number
  rows?: number
  /** Protocol version this build's hooks announce; see shell_integration.rs. */
  hookVersion?: number
}

export interface SessionCallbacks {
  onBlocks: (blocks: Block[]) => void
  onCwd?: (cwd: string) => void
  onExit?: () => void
  /**
   * A full-screen program took over (or handed back). While `active` is true the
   * pane must render a real terminal instead of the block stream.
   */
  onTakeover?: (active: boolean) => void
}

/** Commands whose processes are not expected to exit. */
const LIVE_HINTS =
  /\b(dev|serve|watch|start|tail\s+-f|nodemon|vite|next\s+dev|ping|top|htop|journalctl\s+-f|docker\s+compose\s+up)\b/

/** How long a process must run past its first output before it counts as live. */
const LIVE_AFTER_MS = 4000

let counter = 0
/** DOM-unique block key. Not shown; see `Block.seq` for the displayed index. */
const nextId = () => `b${++counter}`

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class PtySession {
  readonly id: string
  private parser = new Osc133Parser()
  private blocks: Block[] = []
  private current: Block | null = null
  private unlisten: UnlistenFn[] = []
  private cbs: SessionCallbacks
  private liveTimer: number | null = null
  private scrollbackCap: number

  /** Monotonic per-session block ordinal, shown in the block header. */
  private seq = 0
  /** Set after an interactive block: its content is final, so trailing terminal-
   *  mode teardown is discarded rather than appended. Cleared at the next block. */
  private sealed = false
  /** True once we have seen an OSC 133 marker; until then we assume no hooks. */
  private integrated = false
  /**
   * The version this build expects the hooks to announce.
   *
   * A shell started before an upgrade holds the previous hooks in memory, so it
   * can emit `C` (opening a block) using a dialect this build no longer speaks —
   * and the block then waits forever for a `D` that never comes. Comparing
   * announced against expected turns that hang into an explicit degrade.
   */
  private expectedHookVersion: number | null = null
  /** Version the shell announced, or null if it has announced nothing. */
  private announcedHookVersion: number | null = null
  /**
   * Whether this session's OSC 133 markers can be trusted.
   *
   * Hooks that predate the version handshake announce nothing at all, so silence
   * is itself a mismatch once this build expects an announcement — that is
   * exactly the stale-shell case that otherwise hangs a block forever. A build
   * with no expectation (`expectedHookVersion === null`) trusts markers as
   * before, which keeps remote hosts running hand-installed hooks working.
   */
  private get markersTrusted(): boolean {
    if (this.expectedHookVersion === null) return true
    return this.announcedHookVersion === this.expectedHookVersion
  }
  /** True when the hooks are present but speak a version we do not. */
  private hookMismatch = false
  /** The single catch-all block used when the shell has no integration. */
  private degraded: Block | null = null

  private cwd: string
  private alive = false

  constructor(
    id: string,
    cwd: string,
    cbs: SessionCallbacks,
    scrollbackCap = 10_000,
  ) {
    this.id = id
    this.cwd = cwd
    this.cbs = cbs
    this.scrollbackCap = scrollbackCap
  }

  async start(opts: SpawnOptions): Promise<void> {
    if (this.alive) return

    this.unlisten.push(
      await listen<{ id: string; data: string }>('pty://data', (event) => {
        if (event.payload.id !== this.id) return
        this.handleData(event.payload.data)
      }),
    )
    this.unlisten.push(
      await listen<{ id: string }>('pty://exit', (event) => {
        if (event.payload.id !== this.id) return
        this.handleShellExit()
      }),
    )

    this.expectedHookVersion = opts.hookVersion ?? null
    await invoke('pty_spawn', { id: this.id, options: opts })
    this.alive = true
  }

  /**
   * Bind to a shell that is already running, after a reload.
   *
   * Everything `start` does except spawn: the listeners are what make a session
   * live, and the PTY on the other end never stopped. What cannot be recovered
   * is the scrollback the previous page had already consumed — those bytes were
   * delivered once, to a listener that no longer exists. So the session resumes
   * mid-stream, showing output from the moment of re-attachment onward.
   *
   * The hook version is taken on faith rather than re-probed. The shell decided
   * whether it was integrated when it started and cannot change its mind, and
   * re-probing would mean writing to a shell that may be mid-command.
   */
  async attach(hookVersion?: number): Promise<void> {
    if (this.alive) return

    this.unlisten.push(
      await listen<{ id: string; data: string }>('pty://data', (event) => {
        if (event.payload.id !== this.id) return
        this.handleData(event.payload.data)
      }),
    )
    this.unlisten.push(
      await listen<{ id: string }>('pty://exit', (event) => {
        if (event.payload.id !== this.id) return
        this.handleShellExit()
      }),
    )

    this.expectedHookVersion = hookVersion ?? null
    this.alive = true
  }

  /** Send a command line to the shell. The shell echoes it; OSC 133 frames it. */
  async run(cmd: string): Promise<void> {
    this.submitted = true
    // When the shell has no integration we open the block ourselves, since no
    // `C` marker will arrive to do it for us.
    if (!this.integrated) {
      this.echoPending = cmd
      this.openBlock(cmd)
    } else {
      this.pendingCmd = cmd
    }
    await this.write(`${cmd}\n`)
  }

  /** Raw write — keystrokes, control characters, paste. */
  async write(data: string): Promise<void> {
    if (!this.alive) return
    await invoke('pty_write', { id: this.id, data })
  }

  /**
   * Ask the real shell to complete `line`.
   *
   * The line is typed into the shell, TAB is sent, the reply is captured, and
   * the line is then erased with ⌃U so the shell is left exactly as it was.
   * Completion is a side conversation: `capture` diverts output away from the
   * block stream for its duration, so none of this appears as command output.
   */
  async complete(line: string): Promise<CompletionResult> {
    if (!this.alive || !line) return { insert: '', candidates: [] }

    const response = await this.capture(async () => {
      await this.write(line)
      // Let the shell echo before asking it to complete, otherwise the reply can
      // interleave with the echo and confuse the parser.
      await delay(30)
      this.captured = ''
      await this.write('\t')
    })

    // ⌃U clears the line; ⌃C would abort and print a fresh prompt instead.
    await this.write('\x15')
    await delay(10)

    return parseCompletion(response, line)
  }

  /**
   * Run `action` with PTY output diverted into a buffer instead of the block
   * stream, and return what arrived. Used for completion, where the shell's
   * chatter is a means to an end rather than command output.
   */
  private async capture(action: () => Promise<void>): Promise<string> {
    this.capturing = true
    this.captured = ''
    try {
      await action()
      // Poll until output stops arriving rather than waiting a fixed time, so a
      // fast completion feels instant and a slow one still completes.
      let previous = ''
      let idle = 0
      while (idle < 3) {
        await delay(25)
        if (this.captured === previous) {
          idle++
        } else {
          idle = 0
          previous = this.captured
        }
      }
      return this.captured
    } finally {
      this.capturing = false
      this.captured = ''
    }
  }

  /** ⌃C. The shell reports 130 via OSC 133; we do not fabricate it here. */
  async cancel(): Promise<void> {
    await this.write('\x03')
    // Without integration nothing will close the block, so close it ourselves.
    if (!this.integrated && this.current) {
      this.appendLines([{ text: '^C', tone: 'err' }])
      this.closeBlock(EXIT_CANCELLED)
    }
  }

  async resize(cols: number, rows: number): Promise<void> {
    if (!this.alive) return
    await invoke('pty_resize', { id: this.id, cols, rows })
  }

  async dispose(): Promise<void> {
    this.clearLiveTimer()
    for (const un of this.unlisten) un()
    this.unlisten = []
    if (this.alive) {
      this.alive = false
      await invoke('pty_kill', { id: this.id }).catch(() => {})
    }
  }

  setScrollbackCap(cap: number): void {
    this.scrollbackCap = cap
  }

  getBlocks(): Block[] {
    return this.blocks
  }

  /**
   * True when the shell is running hooks from a different build.
   *
   * The session still works — it degrades to a single continuous block — but the
   * UI should say so, because the block model silently not applying is otherwise
   * indistinguishable from a bug.
   */
  hasHookMismatch(): boolean {
    // Covers both a wrong version and hooks too old to announce one at all.
    return this.integrated || this.announcedHookVersion !== null
      ? !this.markersTrusted
      : this.hookMismatch
  }

  /** Version the shell announced, for diagnostics. */
  getAnnouncedHookVersion(): number | null {
    return this.announcedHookVersion
  }

  /* --- internals --------------------------------------------------------- */

  private pendingCmd: string | null = null
  /** Text seen since `output-start`, kept for the structured renderers. */
  private outputBuffer = ''
  /** True between `command-start` and `output-start` — the echoed command line. */
  private inPrompt = false
  /** True once the user has submitted anything; gates the degraded fallback. */
  private submitted = false
  /** Command whose terminal echo has not yet been swallowed (no-integration path). */
  private echoPending: string | null = null
  /** While true, PTY output is buffered for a side conversation, not rendered. */
  private capturing = false
  private captured = ''

  /** A full-screen program owns the screen; the pane renders a terminal. */
  private takeover = false
  /** Rolling detector for repainting UIs that never switch screen buffers. */
  private repaint = new RepaintDetector()
  /** Output from the takeover chunk onward, replayed into the new terminal. */
  private takeoverBacklog = ''
  private rawHandlers = new Set<(data: string) => void>()

  /**
   * Subscribe to raw PTY output. Used by the terminal renderer during a
   * takeover; returns an unsubscribe.
   */
  onRaw(handler: (data: string) => void): () => void {
    this.rawHandlers.add(handler)
    return () => {
      this.rawHandlers.delete(handler)
    }
  }

  /** Bytes seen since the takeover began, so the terminal can catch up. */
  getTakeoverBacklog(): string {
    return this.takeoverBacklog
  }

  private shouldTakeOver(chunk: string): boolean {
    // An explicit alternate-screen switch is unambiguous.
    if (entersAltScreen(chunk)) return true

    // Everything below only applies while a command is actually running — the
    // shell redrawing its own prompt must never trigger a takeover.
    if (!this.current?.running) return false

    // A single chunk dense with cursor addressing (vim-style painting).
    if (looksInteractive(chunk)) return true

    // Or a repaint pattern accumulating across many small chunks, which is how
    // Ink-based CLIs (the Shopify CLI among them) actually behave.
    return this.repaint.push(chunk, Date.now())
  }

  private beginTakeover(chunk: string): void {
    this.takeover = true
    this.takeoverBacklog = chunk

    // Whatever the block collected before the takeover is half-drawn screen
    // painting, not readable output. Replace it with a marker so the block
    // reads sensibly in the scrollback once the program exits.
    if (this.current) {
      this.current = {
        ...this.current,
        lines: [{ text: '⧉ interactive session', tone: 'dd' }],
        interactive: true,
      }
      this.replaceCurrent()
      this.emit()
    }

    // Handlers attach after the callback mounts the terminal, so the first
    // chunk is delivered via the backlog rather than the handler set.
    this.cbs.onTakeover?.(true)
  }

  private endTakeover(): void {
    this.takeover = false
    this.takeoverBacklog = ''
    this.parser.reset()
    this.repaint.reset()
    // An exiting program restores the terminal modes it changed — modifyOtherKeys,
    // the Kitty keyboard stack, bracketed paste, DEC private modes. Those arrive
    // after the alt-screen is already released, so they would otherwise land in
    // the block as text appended to the `interactive session` marker. The marker
    // is the whole of what this block should say, so further output is dropped
    // until the shell's next prompt reopens a block.
    this.sealed = this.current?.interactive === true
    this.cbs.onTakeover?.(false)
  }

  private handleData(chunk: string): void {
    // A side conversation (completion) owns the stream: buffer it and render
    // nothing, so the shell's completion chatter never becomes block output.
    if (this.capturing) {
      this.captured += chunk
      return
    }

    // While a full-screen program is running, every byte belongs to the
    // terminal renderer. Block parsing resumes when it hands the screen back.
    if (this.takeover) {
      if (this.rawHandlers.size === 0) {
        // The renderer has not mounted yet; keep the bytes so it can catch up.
        this.takeoverBacklog += chunk
      } else {
        this.rawHandlers.forEach((h) => h(chunk))
      }

      // An alt-screen program announces its exit. A repainting one does not, so
      // its OSC 133 `D` marker is what tells us the command finished — the
      // shell prompt is back and the block stream should resume.
      if (leavesAltScreen(chunk)) {
        this.endTakeover()
      } else if (/\x1b\]133;D/.test(chunk)) {
        const code = /\x1b\]133;D;(\d+)/.exec(chunk)
        this.endTakeover()
        this.closeBlock(code?.[1] ? Number.parseInt(code[1], 10) : 0)
      }
      return
    }

    if (this.shouldTakeOver(chunk)) {
      this.beginTakeover(chunk)
      return
    }

    for (const event of this.parser.feed(chunk)) {
      switch (event.type) {
        case 'hooks': {
          this.announcedHookVersion = event.version
          // An unrecognised dialect means the shell is running hooks from a
          // different build. Refuse to trust its boundary markers rather than
          // half-understanding them.
          this.hookMismatch =
            this.expectedHookVersion !== null && event.version !== this.expectedHookVersion
          if (this.hookMismatch) {
            console.warn(
              `trmnl: shell announced hook version ${event.version}, expected ` +
                `${this.expectedHookVersion}. Degrading to a single block — ` +
                'open a new session to pick up the current hooks.',
            )
          }
          break
        }

        case 'prompt-start':
          if (!this.markersTrusted) break
          this.integrated = true
          // A prompt means the previous command is done; if one is still open
          // (no `D` arrived) close it optimistically as success.
          if (this.current?.running) this.closeBlock(0)
          this.inPrompt = true
          break

        case 'command-start':
          if (!this.markersTrusted) break
          this.integrated = true
          this.inPrompt = true
          break

        case 'output-start': {
          if (!this.markersTrusted) break
          this.integrated = true
          this.inPrompt = false
          // The command text comes from what we sent, not from the echo — the
          // echo is wrapped in prompt escapes and is unreliable to scrape.
          const cmd = this.pendingCmd ?? ''
          this.pendingCmd = null
          if (this.current?.running) this.closeBlock(0)
          this.openBlock(cmd)
          break
        }

        case 'command-end':
          if (!this.markersTrusted) break
          this.integrated = true
          this.closeBlock(event.code)
          break

        case 'cwd':
          this.cwd = event.cwd
          this.cbs.onCwd?.(event.cwd)
          break

        case 'text':
          this.handleText(event.text)
          break
      }
    }
  }

  private handleText(text: string): void {
    if (!text) return

    // Between `B` and `C` the shell is drawing its prompt and echoing what the
    // user typed. We render our own prompt line, so that is dropped.
    if (this.inPrompt && this.integrated) return

    // An interactive block says only `interactive session`; the mode-restore
    // sequences that follow the program's exit are not content.
    if (this.sealed) return

    if (!this.current) {
      // Output arriving with no open block is the shell drawing its startup
      // banner and first prompt. Swallowing it keeps the welcome state intact;
      // it only becomes a degraded block once the user actually runs something.
      if (!this.integrated && this.submitted) {
        // No shell integration: everything lands in one continuous block rather
        // than guessing boundaries. A wrong boundary is worse than none.
        this.openDegradedBlock()
      } else {
        return
      }
    }

    this.outputBuffer += text
    let lines = ansiToLines(text)

    // Without integration the shell echoes the submitted command back and then
    // redraws its prompt, both of which would otherwise appear as output. We
    // render the command in the block header and draw our own prompt, so drop
    // the echo of whatever we just sent.
    if (!this.integrated && this.echoPending !== null) {
      const echo = this.echoPending
      const idx = lines.findIndex((l) => l.text.trimEnd().endsWith(echo))
      if (idx !== -1) {
        lines = lines.slice(idx + 1)
        this.echoPending = null
      }
    }

    if (lines.length === 0) return
    this.appendLines(lines, /* continuation */ true)
  }

  private openBlock(cmd: string): void {
    this.clearLiveTimer()
    this.sealed = false
    // Repaint signals are per-command; carrying them over would let a busy
    // command push the next one into a takeover it never earned.
    this.repaint.reset()
    const block: Block = {
      id: nextId(),
      seq: ++this.seq,
      cmd,
      cwd: this.cwd,
      ts: timestamp(),
      t0: Date.now(),
      running: true,
      live: false,
      lines: [],
      structured: null,
    }
    this.current = block
    this.blocks = [...this.blocks, block]
    this.outputBuffer = ''

    // Long-running processes never report an exit code, so the UI would look
    // stuck on RUNNING forever. Promote to LIVE either by command shape or by
    // still being alive after a few seconds.
    if (LIVE_HINTS.test(cmd)) {
      this.liveTimer = window.setTimeout(() => this.promoteToLive(), 1200)
    } else {
      this.liveTimer = window.setTimeout(() => this.promoteToLive(), LIVE_AFTER_MS)
    }

    this.emit()
  }

  private openDegradedBlock(): void {
    const block: Block = {
      id: nextId(),
      seq: ++this.seq,
      cmd: '',
      cwd: this.cwd,
      ts: timestamp(),
      t0: Date.now(),
      running: true,
      live: true,
      lines: [],
      structured: null,
    }
    this.degraded = block
    this.current = block
    this.blocks = [...this.blocks, block]
    this.emit()
  }

  private promoteToLive(): void {
    this.liveTimer = null
    if (!this.current?.running || this.current.live) return
    this.current = { ...this.current, live: true }
    this.replaceCurrent()
    this.emit()
  }

  private appendLines(lines: Line[], continuation = false): void {
    if (!this.current) return

    let existing = this.current.lines
    // A chunk boundary can land mid-line, so the first new line continues the
    // last one rather than starting a fresh row.
    if (continuation && existing.length > 0 && lines.length > 0) {
      const lastIdx = existing.length - 1
      const last = existing[lastIdx]
      const first = lines[0]
      if (last && first && !last.text.endsWith('\n')) {
        existing = [
          ...existing.slice(0, lastIdx),
          { text: last.text + first.text, tone: first.tone || last.tone },
        ]
        lines = lines.slice(1)
      }
    }

    let next = [...existing, ...lines]
    if (next.length > this.scrollbackCap) {
      next = next.slice(next.length - this.scrollbackCap)
    }

    this.current = { ...this.current, lines: next }
    this.replaceCurrent()
    this.emit()
  }

  private closeBlock(code: number): void {
    this.clearLiveTimer()
    if (!this.current) return

    const plain = stripAnsi(this.outputBuffer)

    // Output almost always ends with a newline, and an erased prompt mark can
    // leave another blank behind it. Those would render as empty rows padding
    // the bottom of every block, so they are trimmed once the block settles —
    // blank lines *within* the output are left alone, since they carry meaning.
    let lines = this.current.lines
    let end = lines.length
    while (end > 0 && (lines[end - 1]?.text ?? '').trim() === '') end--
    if (end !== lines.length) lines = lines.slice(0, end)

    const block: Block = {
      ...this.current,
      lines,
      running: false,
      live: false,
      code,
      ms: Date.now() - this.current.t0,
    }

    // Structured rendering resolves only on completion — intentional, per spec.
    block.structured = detectStructured(block.cmd, plain, code)

    this.current = block
    this.replaceCurrent()
    this.current = null
    this.degraded = null
    this.outputBuffer = ''
    this.emit()
  }

  private handleShellExit(): void {
    this.clearLiveTimer()
    if (this.current?.running) this.closeBlock(0)
    this.alive = false
    this.cbs.onExit?.()
  }

  private replaceCurrent(): void {
    if (!this.current) return
    const id = this.current.id
    const idx = this.blocks.findIndex((b) => b.id === id)
    if (idx === -1) return
    const next = [...this.blocks]
    next[idx] = this.current
    this.blocks = next
    if (this.degraded?.id === id) this.degraded = this.current
  }

  private clearLiveTimer(): void {
    if (this.liveTimer !== null) {
      clearTimeout(this.liveTimer)
      this.liveTimer = null
    }
  }

  private emit(): void {
    this.cbs.onBlocks(this.blocks)
  }
}
