/** Shell-driven TAB completion.
 *
 * Completion is the shell's job, not ours. Reimplementing it in the frontend
 * would mean reimplementing zsh's compsys — every `cd` completing directories
 * only, every git subcommand, every user-installed completer — and getting it
 * subtly wrong forever. Instead the current line is handed to the real shell,
 * TAB is sent, and the reply is interpreted.
 *
 * zsh answers in one of two shapes (verified over a PTY):
 *
 *   unique     `cd cr` + TAB  ->  "ggr\x1b[1m/\x1b[0m"
 *              just the delta to append.
 *
 *   ambiguous  `cd ` + TAB    ->  BEL, then a formatted candidate list, then
 *              cursor-movement escapes redrawing the prompt.
 *
 * Distinguishing them is what makes this reliable: a BEL or an embedded newline
 * means "list", anything else is a direct insertion.
 */

import { stripAnsi } from './osc133'

export interface CompletionResult {
  /** Text to append to the current input. Empty when only a list came back. */
  insert: string
  /** Candidate names, when the completion was ambiguous. */
  candidates: string[]
}

const BEL = '\x07'

/**
 * Interpret a shell's response to TAB.
 *
 * `sent` is the line that was in the composer, used to recognise the prompt
 * redraw that zsh appends after listing candidates.
 */
export function parseCompletion(response: string, sent: string): CompletionResult {
  if (!response) return { insert: '', candidates: [] }

  const listed = response.includes(BEL) || response.includes('\n')

  if (!listed) {
    // A direct insertion. Escapes are decoration (zsh bolds the trailing slash
    // on a directory), so only the visible text is kept.
    const insert = stripAnsi(response).replace(/\r/g, '')
    return { insert, candidates: [] }
  }

  // Ambiguous: pull the candidate block out from between the BEL and the
  // prompt redraw. Everything after the last `\x1b[<n>A` (cursor-up) belongs to
  // the redraw, not the list.
  let body = response.slice(response.indexOf(BEL) + 1)
  const redraw = body.lastIndexOf('\x1b[')
  const upMatch = /\x1b\[\d*A/.exec(body)
  if (upMatch) {
    body = body.slice(0, upMatch.index)
  } else if (redraw > 0) {
    body = body.slice(0, redraw)
  }

  const plain = stripAnsi(body)
  const candidates = plain
    .split(/[\r\n]+/)
    // zsh lays candidates out in padded columns; two or more spaces separate
    // them, while a single space can legitimately appear inside a filename.
    .flatMap((line) => line.split(/\s{2,}/))
    .map((s) => s.trim())
    .filter(Boolean)
    // Drop zsh's own interactive chrome, which is not a candidate.
    .filter((s) => !/^(zsh:|--|\(|\[)/.test(s))

  // A single candidate that extends what was typed is really a unique match
  // that zsh chose to display; complete it rather than showing a one-item list.
  if (candidates.length === 1) {
    const only = candidates[0]!
    const word = lastWord(sent)
    if (only.startsWith(word) && only.length > word.length) {
      return { insert: only.slice(word.length), candidates: [] }
    }
  }

  return { insert: '', candidates }
}

/** The word TAB would complete — the text after the last unescaped space. */
export function lastWord(line: string): string {
  const match = /(?:^|[^\\])\s([^\s]*)$/.exec(line)
  if (match?.[1] !== undefined) return match[1]
  return /\s/.test(line) ? '' : line
}

/**
 * The longest prefix shared by every candidate.
 *
 * When several candidates share more text than the user has typed, that shared
 * part is inserted — the same "complete as far as it can" behavior a real shell
 * gives you before it starts listing.
 */
export function commonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0]!
  for (const value of values.slice(1)) {
    let i = 0
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix) break
  }
  return prefix
}
