/** Fuzzy subsequence ranking for the command palette.
 *
 * Replaces the prototype's substring match, per the handoff: weight prefix and
 * word-boundary hits, rank frequently-used items higher, and make path segments
 * individually matchable so `gr/ops` finds `~/dev/grid-ops`.
 */

export interface Scored<T> {
  item: T
  score: number
  /** Indices in the label that matched, for highlighting. */
  matches: number[]
}

const BOUNDARY = /[\s/\-_.:]/

/**
 * Score `query` against `text`. Higher is better; null means no match.
 *
 * Every query character must appear in order (subsequence match). Consecutive
 * runs, word-boundary starts, and matches near the front all score higher.
 */
export function score(query: string, text: string): { score: number; matches: number[] } | null {
  if (query === '') return { score: 0, matches: [] }

  const q = query.toLowerCase()
  const t = text.toLowerCase()

  // A separator in the query means the user is describing segments, e.g.
  // `gr/ops` — each part must match in order but gaps between them are free.
  if (/[\s/]/.test(q)) {
    const parts = q.split(/[\s/]+/).filter(Boolean)
    let cursor = 0
    let total = 0
    const matches: number[] = []
    for (const part of parts) {
      const found = t.indexOf(part, cursor)
      if (found === -1) return null
      for (let i = 0; i < part.length; i++) matches.push(found + i)
      // Reward a segment that starts at a boundary.
      const prev = found > 0 ? t[found - 1] : '/'
      if (prev && BOUNDARY.test(prev)) total += 12
      total += 20 - Math.min(10, found - cursor)
      cursor = found + part.length
    }
    return { score: total, matches }
  }

  let ti = 0
  let total = 0
  let streak = 0
  const matches: number[] = []

  for (const ch of q) {
    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i
        break
      }
    }
    if (found === -1) return null

    matches.push(found)

    // Consecutive characters are a strong signal.
    if (found === ti && streak > 0) {
      streak += 1
      total += 8 + streak * 2
    } else {
      streak = 1
      total += 4
    }

    // Word-boundary and start-of-string hits rank above mid-word ones.
    const prev = found > 0 ? t[found - 1] : undefined
    if (found === 0) total += 16
    else if (prev && BOUNDARY.test(prev)) total += 10

    // Prefer earlier matches, mildly.
    total -= Math.min(6, Math.floor(found / 4))

    ti = found + 1
  }

  // A shorter haystack matching the same query is the tighter match.
  total -= Math.min(10, Math.floor((t.length - q.length) / 8))

  return { score: total, matches }
}

/**
 * Rank a list. `fields` are searched in priority order — the first field that
 * matches determines the score, with later fields penalised so a label hit
 * always outranks a description hit.
 */
export function rank<T>(
  query: string,
  items: T[],
  fields: (item: T) => string[],
  frequency?: (item: T) => number,
): Scored<T>[] {
  const out: Scored<T>[] = []

  for (const item of items) {
    const values = fields(item)
    let best: { score: number; matches: number[] } | null = null
    let bestField = 0

    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      if (!value) continue
      const result = score(query, value)
      if (!result) continue
      const adjusted = { score: result.score - i * 25, matches: i === 0 ? result.matches : [] }
      if (!best || adjusted.score > best.score) {
        best = adjusted
        bestField = i
      }
    }

    if (!best) continue

    // Frequently-used items rank higher, capped so it can't override a much
    // better textual match.
    const freq = frequency?.(item) ?? 0
    const boost = Math.min(30, freq * 6)

    out.push({
      item,
      score: best.score + boost - (bestField > 0 ? 0 : 0),
      matches: best.matches,
    })
  }

  return out.sort((a, b) => b.score - a.score)
}
