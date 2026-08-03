/** Per-command accent overrides.
 *
 * While a matched command runs, the whole interface shifts to that command's
 * colour and reverts when it settles. This works at all because every neutral in
 * the token set is derived from `--ac` via `color-mix` — so one variable moves
 * the entire UI, which is the property the handoff called load-bearing.
 *
 * Matching is on the command *word*, not a substring: a rule for `claude` must
 * not fire for `claude-helper`, and a rule for `git` must not fire for `gitk`.
 * Leading environment assignments and absolute paths are stripped first, so
 * `FOO=1 /opt/homebrew/bin/shopify app dev` still matches a `shopify` rule.
 */

export interface CommandAccent {
  id: string
  /** The command word to match, e.g. `shopify`. Case-insensitive. */
  match: string
  /** An oklch colour string, used exactly as `--ac`. */
  color: string
  /** Shown in Settings so a row is identifiable at a glance. */
  label: string
  enabled: boolean
}

/** Shipped defaults. Colours sit in the same lightness/chroma band as the
 *  identity palette so hairlines and washes behave the same way. */
export const DEFAULT_COMMAND_ACCENTS: CommandAccent[] = [
  {
    id: 'ca-shopify',
    match: 'shopify',
    color: 'oklch(0.75 0.18 152)',
    label: 'Shopify CLI',
    enabled: true,
  },
  {
    id: 'ca-claude',
    match: 'claude',
    color: 'oklch(0.72 0.17 55)',
    label: 'Claude Code',
    enabled: true,
  },
  {
    id: 'ca-docker',
    match: 'docker',
    color: 'oklch(0.72 0.16 245)',
    label: 'Docker',
    enabled: true,
  },
]

/**
 * The command word a rule would match against.
 *
 * Strips leading `VAR=value` assignments, then any directory part, then a
 * trailing `.exe`-style suffix. Returns lowercase, or null when there is nothing
 * to match (an empty line, or only assignments).
 */
export function commandWord(cmd: string): string | null {
  let rest = cmd.trim()
  if (!rest) return null

  // Peel off environment assignments: `FOO=1 BAR=2 cmd`.
  for (;;) {
    const m = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/.exec(rest)
    if (!m) break
    rest = rest.slice(m[0].length)
  }

  // Step past wrappers that take a command as their argument, so the rule
  // matches the program the user cares about rather than the wrapper.
  for (;;) {
    const m = /^(?:sudo|env|command|exec|time|nice|nohup)\s+(?:-\S+\s+)*/.exec(rest)
    if (!m || m[0].length === 0) break
    rest = rest.slice(m[0].length)
  }

  const first = rest.split(/\s+/)[0]
  if (!first) return null

  // `npx shopify …` and `npm run …` are about the wrapped tool; take the next
  // word for npx/pnpm dlx/bunx, which directly invoke a binary.
  if (/^(?:npx|bunx)$/i.test(first)) {
    const second = rest.split(/\s+/).find((w, i) => i > 0 && !w.startsWith('-'))
    return second ? basename(second) : basename(first)
  }

  return basename(first)
}

function basename(word: string): string {
  const slash = word.lastIndexOf('/')
  const name = slash === -1 ? word : word.slice(slash + 1)
  return name.toLowerCase()
}

/**
 * The colour for a command, or null when no enabled rule matches.
 *
 * First match wins, so ordering in Settings is meaningful.
 */
export function accentFor(cmd: string, rules: CommandAccent[]): string | null {
  const word = commandWord(cmd)
  if (!word) return null

  for (const rule of rules) {
    if (!rule.enabled) continue
    const target = rule.match.trim().toLowerCase()
    if (target && target === word) return rule.color
  }
  return null
}

/** Validate a user-entered colour before it reaches `--ac`.
 *
 * A malformed value would silently break every derived token, so anything we
 * cannot recognise is rejected at the input rather than written to config.
 */
export function isValidColor(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  // oklch(...) / hex / rgb() / named — let the browser be the judge.
  if (typeof CSS !== 'undefined' && CSS.supports?.('color', v)) return true
  return /^oklch\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*(?:\/\s*[\d.]+\s*)?\)$/.test(v)
}
