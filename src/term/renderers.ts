/** Structured output renderers.
 *
 * Certain commands get their output parsed and rendered as UI instead of text.
 *
 * The governing rule from the handoff: **parse, never fabricate.** Every parser
 * here returns null the moment anything is ambiguous, and the block falls back to
 * plain text. A wrong table is much worse than no table.
 *
 * The interface is `(command, output, exitCode) => Structured | null` so more
 * renderers (test runners, docker compose, kubectl) can be added without
 * touching the block model.
 */

import { EXIT_NOT_FOUND, type BuildRoute, type GitGroup, type Structured } from './types'

export type RendererId = 'build' | 'git' | 'serve' | 'err'

export interface Renderer {
  id: RendererId
  /** Does this renderer want to try? Cheap check before parsing. */
  matches: (cmd: string, code: number) => boolean
  parse: (output: string, cmd: string, code: number) => Structured | null
}

/** Which renderers are enabled. Mirrored from Settings → Behavior. */
let enabled: Record<RendererId, boolean> = {
  build: true,
  git: true,
  serve: true,
  err: true,
}

export function setRendererEnabled(next: Partial<Record<RendererId, boolean>>): void {
  enabled = { ...enabled, ...next }
}

export function getRendererEnabled(): Record<RendererId, boolean> {
  return { ...enabled }
}

/* --- build: next/npm build route table ------------------------------------ */

const buildRenderer: Renderer = {
  id: 'build',
  matches: (cmd, code) =>
    code === 0 && /\b(npm|pnpm|yarn|bun)\s+run\s+build\b|\bnext\s+build\b/.test(cmd),
  parse(output) {
    const lines = output.split('\n')
    const routes: BuildRoute[] = []
    let sharedChunks: string | undefined
    let summary: string | undefined

    // Next's table rows look like:
    //   ┌ ○ /                    4.1 kB   128 kB
    //   ├ ƒ /api/registry/[name]     0 B     0 B
    const row =
      /^[\s│├└┌┬─]*([○ƒλ●])\s+(\S+)\s+([\d.]+\s*(?:B|kB|MB|GB))\s+([\d.]+\s*(?:B|kB|MB|GB))\s*$/

    for (const raw of lines) {
      const line = raw.trimEnd()

      const m = row.exec(line)
      if (m) {
        const [, marker, path, size, firstLoad] = m
        if (!marker || !path || !size || !firstLoad) continue
        routes.push({
          path,
          marker: marker === 'ƒ' || marker === 'λ' ? 'dynamic' : 'static',
          size: size.replace(/\s+/g, ' '),
          firstLoad: firstLoad.replace(/\s+/g, ' '),
          overBudget: overBudget(firstLoad),
        })
        continue
      }

      const shared = /\+\s*First Load JS shared by all\s+([\d.]+\s*(?:B|kB|MB))/i.exec(line)
      if (shared?.[1]) sharedChunks = shared[1]

      const compiled = /Compiled successfully(?:\s+in\s+([\d.]+\s*m?s))?/i.exec(line)
      if (compiled) {
        const pages = /\((\d+)\/(\d+)\)|\b(\d+)\s*\/\s*(\d+)\s+static pages/i.exec(output)
        summary = compiled[1]
          ? `Compiled successfully in ${compiled[1]}`
          : 'Compiled successfully'
        if (pages) summary += ` · ${pages[0].replace(/[()]/g, '')} static pages`
      }
    }

    // No rows means this wasn't a route-table build. Fall back to text.
    if (routes.length === 0) return null
    return { kind: 'build', routes, sharedChunks, summary }
  },
}

/** First-load budget. Next itself warns past 128 kB, so that is the threshold. */
function overBudget(value: string): boolean {
  const m = /([\d.]+)\s*(B|kB|MB|GB)/.exec(value)
  if (!m?.[1] || !m[2]) return false
  const n = Number.parseFloat(m[1])
  const kb = m[2] === 'MB' ? n * 1024 : m[2] === 'GB' ? n * 1024 * 1024 : m[2] === 'B' ? n / 1024 : n
  return kb > 128
}

/* --- git: status file chips ------------------------------------------------ */

const gitRenderer: Renderer = {
  id: 'git',
  matches: (cmd, code) => code === 0 && /^\s*git\s+status\b/.test(cmd),
  parse(output) {
    // Only the porcelain-ish default output is parsed. `--porcelain` and `-s`
    // have different shapes; rather than half-support them, defer to text.
    if (/^\s*[MADRCU?!]{1,2}\s/m.test(output) && !/Changes to be committed|not staged/.test(output)) {
      return null
    }

    const branchMatch = /On branch (\S+)/.exec(output)
    const aheadMatch = /Your branch is (ahead of|behind) '([^']+)' by (\d+) commit/.exec(output)

    const groups: GitGroup[] = []
    const sections: { header: RegExp; label: string; tone: 'warn' | 'err' }[] = [
      { header: /Changes to be committed:/, label: 'STAGED', tone: 'warn' },
      { header: /Changes not staged for commit:/, label: 'MODIFIED', tone: 'warn' },
      { header: /Untracked files:/, label: 'UNTRACKED', tone: 'err' },
    ]

    const lines = output.split('\n')

    for (const section of sections) {
      const start = lines.findIndex((l) => section.header.test(l))
      if (start === -1) continue

      const files: GitGroup['files'] = []
      for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i]
        if (line === undefined) break
        const trimmed = line.trim()
        if (!trimmed) {
          // A blank line ends the section, but only after we've seen a file.
          if (files.length > 0) break
          continue
        }
        if (trimmed.startsWith('(')) continue
        if (/^(Changes|Untracked|On branch|Your branch|no changes|nothing)/.test(trimmed)) break

        // `modified:   path` / `new file:   path` / bare `path` for untracked.
        const labelled = /^(modified|new file|deleted|renamed|copied|typechange):\s+(.+)$/.exec(
          trimmed,
        )
        if (labelled?.[1] && labelled[2]) {
          files.push({ marker: markerFor(labelled[1]), path: labelled[2].trim() })
        } else if (section.label === 'UNTRACKED') {
          files.push({ marker: 'U', path: trimmed })
        }
      }

      if (files.length > 0) {
        groups.push({ label: section.label, tone: section.tone, files })
      }
    }

    // A clean tree, or output we didn't understand. Both are better as text.
    if (groups.length === 0) return null

    return {
      kind: 'git',
      groups,
      branch: branchMatch?.[1],
      ahead:
        aheadMatch?.[1] && aheadMatch[3]
          ? `${aheadMatch[1]} ${aheadMatch[2]} by ${aheadMatch[3]}`
          : undefined,
    }
  },
}

function markerFor(label: string): string {
  switch (label) {
    case 'modified':
      return 'M'
    case 'new file':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    default:
      return 'T'
  }
}

/* --- serve: dev-server link card ------------------------------------------ */

const serveRenderer: Renderer = {
  id: 'serve',
  matches: (cmd) =>
    /\bshopify\s+app\s+dev\b|\b(npm|pnpm|yarn|bun)\s+run\s+dev\b|\bnext\s+dev\b|\bvite\b/.test(cmd),
  parse(output) {
    const links: { label: string; url: string }[] = []
    const seen = new Set<string>()

    const push = (label: string, url: string) => {
      const clean = url.replace(/[),.]+$/, '')
      if (seen.has(clean)) return
      seen.add(clean)
      links.push({ label, url: clean })
    }

    // Labelled lines first, so we get the design's PREVIEW URL / GRAPHIQL names.
    const labelled: [RegExp, string][] = [
      [/Preview URL:\s*(\S+)/i, 'PREVIEW URL'],
      [/GraphiQL:\s*(\S+)/i, 'GRAPHIQL'],
      [/GraphiQL URL:\s*(\S+)/i, 'GRAPHIQL'],
      [/Dev store:\s*(\S+)/i, 'DEV STORE'],
      [/Local:\s*(\S+)/i, 'LOCAL'],
      [/Network:\s*(\S+)/i, 'NETWORK'],
    ]

    for (const [re, label] of labelled) {
      const m = re.exec(output)
      if (m?.[1] && /^https?:\/\//.test(m[1])) push(label, m[1])
    }

    // Then any bare URL, as LOCAL, so a plain `vite` still gets a card.
    if (links.length === 0) {
      const bare = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\S*/.exec(output)
      if (bare?.[0]) push('LOCAL', bare[0])
    }

    if (links.length === 0) return null

    const hints: { key: string; label: string }[] = []
    if (/\bp\b.*preview/i.test(output)) hints.push({ key: 'p', label: 'PREVIEW' })
    if (/\bg\b.*graphiql/i.test(output)) hints.push({ key: 'g', label: 'GRAPHIQL' })
    if (/\bq\b.*quit/i.test(output)) hints.push({ key: 'q', label: 'QUIT' })

    return { kind: 'serve', links, title: 'DEV SERVER RUNNING', hints }
  },
}

/* --- err: command-not-found panel ----------------------------------------- */

/** Populated from $PATH at boot, for a real did-you-mean match. */
let knownCommands: string[] = []

export function setKnownCommands(commands: string[]): void {
  knownCommands = commands
}

const errRenderer: Renderer = {
  id: 'err',
  matches: (_cmd, code) => code === EXIT_NOT_FOUND,
  parse(output, cmd) {
    const missing =
      /command not found:?\s*(\S+)/i.exec(output)?.[1] ??
      /(\S+):\s*command not found/i.exec(output)?.[1] ??
      cmd.trim().split(/\s+/)[0]

    if (!missing) return null

    const first = output.split('\n').find((l) => l.trim())?.trim()
    const suggestion = suggest(missing, cmd)

    return {
      kind: 'err',
      message: first ?? `command not found: ${missing}`,
      detail: `no executable named ${missing} found in $PATH`,
      suggestion,
    }
  },
}

/**
 * Did-you-mean via edit distance against $PATH, replacing the prototype's
 * 3-character prefix match. Returns the full command line with the typo fixed,
 * so the suggestion chip is directly runnable.
 */
function suggest(missing: string, cmd: string): string | undefined {
  if (knownCommands.length === 0) return undefined

  const maxDistance = missing.length <= 4 ? 1 : missing.length <= 8 ? 2 : 3
  let best: { name: string; score: number } | null = null

  for (const name of knownCommands) {
    // Cheap length gate before the expensive comparison.
    if (Math.abs(name.length - missing.length) > maxDistance) continue
    const d = editDistance(missing, name)
    if (d > maxDistance) continue
    // Prefer a shared prefix when distances tie — closer to what was intended.
    const score = d * 10 - sharedPrefix(missing, name)
    if (!best || score < best.score) best = { name, score }
  }

  if (!best) return undefined
  const rest = cmd.trim().slice(missing.length)
  return `${best.name}${rest}`
}

function sharedPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Levenshtein, two-row variant. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let cur = new Array<number>(b.length + 1).fill(0)

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(
        (cur[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      )
    }
    ;[prev, cur] = [cur, prev]
  }

  return prev[b.length] ?? 0
}

/* --- registry ------------------------------------------------------------- */

export const renderers: Renderer[] = [errRenderer, buildRenderer, gitRenderer, serveRenderer]

/** Try each enabled renderer in order; first non-null wins. */
export function detectStructured(
  cmd: string,
  output: string,
  code: number,
): Structured | null {
  for (const renderer of renderers) {
    if (!enabled[renderer.id]) continue
    if (!renderer.matches(cmd, code)) continue
    try {
      const result = renderer.parse(output, cmd, code)
      if (result) return result
    } catch {
      // A throwing parser must never take the block down with it.
    }
  }
  return null
}
