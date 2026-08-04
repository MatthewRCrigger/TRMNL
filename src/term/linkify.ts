/** Splits a line of output into plain text and bare URLs, for making the
 *  latter clickable without touching how the line is otherwise rendered.
 *
 *  Deliberately separate from the `serve` renderer in renderers.ts: that one
 *  is a structured, command-specific parse (vite/next dev, shopify app dev)
 *  that runs once over a whole command's output and produces a `ServeLink`
 *  card. This runs over every line of every block, structured or not — it is
 *  what makes something like the Shopify CLI's `[1] http://127.0.0.1:9292`
 *  reference list clickable, which the serve renderer's command allowlist
 *  would never match.
 */

export interface TextToken {
  kind: 'text'
  text: string
}

export interface LinkToken {
  kind: 'link'
  text: string
  url: string
}

export type LineToken = TextToken | LinkToken

/**
 * Bare URLs only — no markdown-link or `label: url` unwrapping, since that is
 * exactly what the `serve` renderer already does for the commands it knows.
 * Trailing punctuation is stripped the same way `serveRenderer.push` does, so
 * a URL at the end of a sentence or inside `[1] http://host:port)` does not
 * carry a closing paren or period into the link.
 */
const URL_RE = /https?:\/\/[^\s<>"'`]+/g

/** True only when the line actually contains something to linkify — lets a
 *  caller skip tokenizing (and re-rendering) the common case of plain text. */
export function hasLink(text: string): boolean {
  URL_RE.lastIndex = 0
  return URL_RE.test(text)
}

export function linkify(text: string): LineToken[] {
  const tokens: LineToken[] = []
  let last = 0
  URL_RE.lastIndex = 0

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index
    const full = match[0]
    // A URL butted up against closing punctuation almost always means the
    // punctuation belongs to the surrounding sentence, not the link. Left as
    // part of `text`, not pushed as its own token here — the next loop
    // iteration (or the final flush below) picks it up naturally as part of
    // whatever comes after, same as any other plain text.
    const raw = full.replace(/[),.;:!?\]]+$/, '')
    if (!raw) continue

    if (start > last) tokens.push({ kind: 'text', text: text.slice(last, start) })
    tokens.push({ kind: 'link', text: raw, url: raw })
    last = start + raw.length
  }

  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) })
  return tokens
}
