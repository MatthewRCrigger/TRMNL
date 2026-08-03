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
  /**
   * Accent this command claimed while it ran, if any.
   *
   * Held on the block so its header keeps the tool's colour after the global
   * accent reverts — the block is a record of what ran, and the colour is part
   * of that record. Undefined for commands with no matching rule, which then
   * follow the live accent as before.
   */
  accent?: string
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
  /** Rendered in --warn when the first-load budget is exceeded. */
  overBudget?: boolean
}

export interface GitGroup {
  /** MODIFIED renders in --warn, UNTRACKED in --err. */
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

/** Derive the visual state from a block. Drives spine colour, chip and actions. */
export function blockState(block: Block): BlockState {
  if (block.running) return block.live ? 'live' : 'running'
  if (block.code === EXIT_CANCELLED) return 'cancelled'
  if (block.code === 0 || block.code === undefined) return 'success'
  return 'failure'
}

/** The spine (left border) colour token for a state. */
export function spineVar(state: BlockState): string {
  switch (state) {
    case 'running':
    case 'live':
      return 'var(--warn)'
    case 'failure':
    case 'cancelled':
      return 'var(--err)'
    default:
      return 'var(--ac)'
  }
}

/** The status chip label. */
export function chipLabel(block: Block, state: BlockState): string {
  switch (state) {
    case 'running':
      return 'RUNNING'
    case 'live':
      return 'LIVE'
    case 'cancelled':
      return 'CANCELLED'
    default:
      return `EXIT ${block.code ?? 0}`
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
