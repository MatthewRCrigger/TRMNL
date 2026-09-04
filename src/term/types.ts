/** Core block model types. See the handoff's "The block model" section. */

export type Tone = 'txt' | 'dim' | 'dd' | 'acc' | 'err' | 'wrn'

export interface Line {
  text: string
  tone: Tone
}

/** Exit code 130 is SIGINT (⌃C); 127 is command-not-found. */
export const EXIT_CANCELLED = 130
export const EXIT_NOT_FOUND = 127

export type BlockState = 'running' | 'live' | 'success' | 'failure' | 'cancelled'

export interface Block {
  id: string
  /**
   * Per-session ordinal, starting at 1 and displayed zero-padded in the header.
   *
   * Distinct from `id`, which is only a DOM key: the sequence restarts per
   * session so it reads as a position in *this* stream rather than a global
   * counter, which is what makes it usable as a coordinate when navigating with
   * `⌘[`/`⌘]` or picking a search hit.
   */
  seq: number
  /** The raw command line as typed. */
  cmd: string
  /** cwd at time of execution, for the prompt line. */
  cwd: string
  /** Wall-clock start, HH:MM:SS. */
  ts: string
  /** Epoch ms, for the live elapsed timer. */
  t0: number
  /** True from submit until process exit. */
  running: boolean
  /** A long-running process that is not expected to exit. */
  live: boolean
  /** Parsed output, appended as it streams. */
  lines: Line[]
  /** Exit code. Undefined while running. */
  code?: number
  /** Final duration in ms. */
  ms?: number
  /** Set on completion when a renderer claims the output. */
  structured: Structured | null
  /** User has expanded a folded block. */
  expanded?: boolean
  /**
   * A full-screen program owned the screen for this command, so its output was
   * rendered by the terminal emulator rather than captured as lines.
   */
  interactive?: boolean
}

/** Discriminated union of structured-renderer payloads. */
export type Structured =
  | { kind: 'build'; routes: BuildRoute[]; sharedChunks?: string; summary?: string }
  | { kind: 'git'; groups: GitGroup[]; branch?: string; ahead?: string }
  | { kind: 'serve'; links: ServeLink[]; title: string; hints: ServeHint[] }
  | { kind: 'err'; message: string; detail?: string; suggestion?: string }
  | { kind: 'list'; entries: ListEntry[]; total?: string }
  | { kind: 'test'; passed: number; failed: number; skipped: number; duration?: string; failures: TestFailure[] }

export interface TestFailure {
  name: string
  /** The suite/describe path the test lives under, when the runner reports one. */
  suite?: string
}

export interface ListEntry {
  name: string
  /** Rendered as the row marker, mirroring the build table's ○ / ƒ. */
  kind: 'dir' | 'file' | 'link' | 'exec'
  /** Human-readable size; directories show their entry count instead. */
  size: string
  modified: string
  perms: string
  owner: string
  /** Symlink target, when the entry is a link. */
  target?: string
  /** Dotfiles are dimmed so the listing reads at a glance. */
  hidden: boolean
}

export interface BuildRoute {
  path: string
  /** `○` static or `ƒ` dynamic. */
  marker: 'static' | 'dynamic'
  size: string
  firstLoad: string
  /** The one amber cell in the build table when the budget is exceeded. */
  overBudget?: boolean
}

export interface GitGroup {
  /** STAGED renders amber, UNTRACKED red. */
  label: string
  tone: 'warn' | 'err'
  files: GitFile[]
}

export interface GitFile {
  /** Single-letter status marker, e.g. M or U. */
  marker: string
  path: string
  added?: string
  removed?: string
}

export interface ServeLink {
  label: string
  url: string
}

export interface ServeHint {
  key: string
  label: string
}

/** Derive the visual state from a block. Drives the panel toggles and badge. */
export function blockState(block: Block): BlockState {
  if (block.running) return block.live ? 'live' : 'running'
  if (block.code === EXIT_CANCELLED) return 'cancelled'
  if (block.code === 0 || block.code === undefined) return 'success'
  return 'failure'
}

/**
 * A block's state, expressed as panel toggles.
 *
 * This is the core mapping of the GRID rebuild. A block used to be a bare left
 * border and later a box with a filled accent header; it is now a panel, and
 * exit status is not a chip bolted onto that panel — it *is* the panel's border
 * and header fill.
 *
 *   settled, exit 0  → colour unset (falls back to --line-300), header plain
 *   latest           → colour unset (--line-100 via `latest`), header FILLED
 *   non-zero exit    → red border,  header FILLED
 *   running / live   → cyan border, header plain
 *   raw dump         → no panel at all
 *
 * `headerFilled` is reserved for the block you are currently reading. Two
 * filled headers in one viewport — the latest block plus a failure — is the
 * intended maximum; a stream of them is a bug, which is why nothing else in
 * this function can set it.
 *
 * The raw-dump case matters most for long output: a 10,000-line scrollback
 * dump gets no frame at all rather than a frame per block, because at that
 * length the frame stops being an addressable unit and becomes noise.
 */
export function blockPanel(
  block: Block,
  options: { isLatest: boolean; rawDumpThreshold: number },
): { panelColor: string | null; headerFilled: boolean; showPanel: boolean } {
  const state = blockState(block)
  const failed = state === 'failure' || state === 'cancelled'
  const running = state === 'running' || state === 'live'

  return {
    panelColor: failed
      ? 'var(--signal-red)'
      : running
        ? 'var(--signal-cyan)'
        : options.isLatest
          ? 'var(--line-100)'
          : null,
    headerFilled: options.isLatest || failed,
    // Structured output is never a raw dump however long it is: it has been
    // parsed into a table or a list, which is the opposite of an unframed
    // scrollback spill.
    showPanel: !!block.structured || block.lines.length <= options.rawDumpThreshold,
  }
}

/** The badge label and tone for a block's state. */
export function blockBadge(
  block: Block,
  isLatest: boolean,
): { label: string; tone: 'accent' | 'live' | 'success' | 'danger' | 'neutral'; dot: boolean } {
  const state = blockState(block)

  switch (state) {
    case 'running':
      return { label: 'RUNNING', tone: 'live', dot: true }
    case 'live':
      return { label: 'LIVE', tone: 'live', dot: true }
    case 'cancelled':
      return { label: 'CANCELLED', tone: 'danger', dot: false }
    case 'failure':
      return { label: `EXIT ${block.code ?? 0}`, tone: 'danger', dot: false }
    default:
      // The latest settled block says so; the badge is what tells you which
      // filled header you are looking at when a failure is also on screen.
      return isLatest
        ? { label: 'LATEST', tone: 'neutral', dot: false }
        : { label: `EXIT ${block.code ?? 0}`, tone: 'success', dot: true }
  }
}

/** Format a duration the way the design does: `240ms`, `1.4s`, `2:05`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Live elapsed time for a running block: `M:SS`. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function timestamp(at = new Date()): string {
  return at.toTimeString().slice(0, 8)
}

/**
 * Render a settled block as a single markdown snippet — command, output, exit
 * status and duration — for pasting into a PR description, issue or chat.
 *
 * Structured blocks (build tables, git chips, …) still serialise their
 * underlying line output rather than reproducing the rendered UI: a fenced
 * text dump of what the command printed is legible enough, and matching the
 * on-screen table exactly is not the goal here.
 */
export function blockToMarkdown(block: Block): string {
  const state = blockState(block)
  const status = state === 'cancelled' ? 'cancelled' : state === 'success' ? '✓' : `✗ exit ${block.code ?? ''}`
  const duration = block.ms !== undefined ? formatDuration(block.ms) : undefined
  const output = block.lines.map((l) => l.text).join('\n')

  const lines = [
    '```console',
    `$ ${block.cmd}`,
    ...(output ? [output] : []),
    '```',
    [status, duration].filter(Boolean).join(' · '),
  ]

  return lines.join('\n')
}
