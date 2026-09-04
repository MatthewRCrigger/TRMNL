/** The macOS window title, which is also the Dock's window-list label.
 *
 * A window whose title never changes is indistinguishable from every other one
 * in "Show All Windows" — the whole point of that list is to tell them apart, so
 * the title has to describe the session you would land in by picking it.
 *
 * The shape is Terminal.app's, deliberately: `dir — command — 80×24`, em-dash
 * separated. It is the format every Mac terminal user already parses at a glance,
 * and matching it means the Dock preview reads the same way Terminal's does.
 */

/** What the title needs to know about the active session. Deliberately not
 *  `Session` — this is a formatter, and taking the whole store type would tie it
 *  to fields it has no business reading. */
export interface TitleParts {
  /** Working directory, absolute. `~` is applied here, not by the caller. */
  cwd?: string
  /** Command line of the running block, when one is running. */
  command?: string
  /** The session's shell path, shown when nothing is running. */
  shell?: string
  /** Absolute home directory, for the `~` abbreviation. */
  home?: string
  cols?: number
  rows?: number
}

/** Shown when there is no session at all — during boot, or after the last one
 *  closes and before its replacement spawns. */
export const FALLBACK_TITLE = 'CRGGR.sh'

/**
 * Build the window title from the active session.
 *
 * Every part is optional because every part genuinely can be missing: a session
 * exists before its first cwd report arrives, a shell spawn can fail, and the
 * pane has not measured its grid until it has been laid out once. Rather than
 * printing empty segments or `undefined`, a missing part drops out of the title
 * entirely — so an early title is short but never wrong. With nothing at all to
 * say, the app name is the honest answer.
 */
export function formatWindowTitle(parts: TitleParts): string {
  const segments: string[] = []

  const dir = directoryLabel(parts.cwd, parts.home)
  if (dir) segments.push(dir)

  // A running command is what the window is *doing*, so it displaces the shell
  // name; the shell is only interesting when it is the thing waiting for you.
  const activity = firstWord(parts.command) ?? shellLabel(parts.shell)
  if (activity) segments.push(activity)

  const size = dimensionLabel(parts.cols, parts.rows)
  if (size) segments.push(size)

  return segments.length > 0 ? segments.join(' — ') : FALLBACK_TITLE
}

/**
 * The trailing component of the cwd, with home abbreviated to `~`.
 *
 * Terminal.app shows only the basename, and the Dock's list is narrow enough
 * that a full path would be truncated into uselessness. The home directory is
 * the one case where the basename would be the account name rather than
 * anything about the session, so `~` replaces it — matching the pane header.
 */
function directoryLabel(cwd?: string, home?: string): string {
  if (!cwd) return ''

  const path = trimTrailingSlash(cwd)
  const homePath = home ? trimTrailingSlash(home) : ''

  if (homePath && path === homePath) return '~'
  // A path under home keeps its basename; only home *itself* becomes `~`, since
  // `~/src/crggr` would just be a longer way of writing `crggr`.
  if (homePath && path.startsWith(`${homePath}/`)) {
    return basename(path.slice(homePath.length + 1))
  }
  // The filesystem root has no basename, and an empty segment would read as a
  // missing directory rather than as `/`.
  return basename(path) || '/'
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path
}

/**
 * The command name alone, without its arguments.
 *
 * `npm run build --workspace=@acme/thing` would push the dimensions out of the
 * Dock's visible width; the verb is the part that identifies the window.
 */
function firstWord(command?: string): string | null {
  const word = command?.trim().split(/\s+/)[0]
  return word ? word : null
}

/**
 * The shell's name, formatted the way a login shell appears in `ps`.
 *
 * Terminal.app writes `-zsh`, leading hyphen and all, because that is the argv[0]
 * a login shell is given. Reproducing it keeps the title recognisable to anyone
 * who has ever read that window list.
 */
function shellLabel(shell?: string): string {
  const name = shell ? basename(shell.trim()) : ''
  if (!name) return ''
  // Already hyphenated (the shell path itself was an argv[0]); don't double it.
  return name.startsWith('-') ? name : `-${name}`
}

/** `80×24`, using the multiplication sign as Terminal does — not a letter x. */
function dimensionLabel(cols?: number, rows?: number): string {
  if (!isPositiveInt(cols) || !isPositiveInt(rows)) return ''
  return `${cols}×${rows}`
}

function isPositiveInt(value?: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
