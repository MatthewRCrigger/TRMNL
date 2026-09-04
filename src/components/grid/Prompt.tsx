/** Prompt — `user@host path $ command`.
 *
 * The one row where the casing rule is most visible: everything here is
 * lowercase shell truth, sitting under chrome that is entirely uppercase.
 *
 * Colour splits the row by who is speaking: the user in the tone's signal, the
 * host and sigil in --ink-300 because they are context rather than content, the
 * path in --ink-200, and the command itself in --ink-100 — it is the single
 * most important string on screen.
 *
 * The caret is a STATIC block. It does not blink; GRID has no infinite
 * animation, and a blinking caret in a stream of settled blocks would be the
 * only moving thing on a still display.
 */

import { toneColor, type Tone } from './tone'

interface Props {
  user?: string
  host?: string
  path?: string
  /** The shell sigil. `$` by default. */
  sigil?: string
  /** The command line. Rendered in --ink-100. */
  command?: React.ReactNode
  /** Amber by default — the prompt sigil is the accent's canonical home. */
  tone?: Tone
  /** Draw the static block caret after the command. */
  caret?: boolean
  /** Right-aligned meta — duration, timestamp. */
  meta?: React.ReactNode
  /** Ghost suggestion, in --ink-300. Load-bearing copy: never --ink-400. */
  ghost?: React.ReactNode
  className?: string
  size?: 'xs' | 'sm'
}

export function Prompt({
  user,
  host,
  path,
  sigil = '$',
  command,
  tone = 'accent',
  caret = false,
  meta,
  ghost,
  className,
  size = 'xs',
}: Props) {
  const signal = toneColor(tone)

  return (
    <div
      className={['gprompt', `gprompt--${size}`, className].filter(Boolean).join(' ')}
      style={{ '--prompt-signal': signal } as React.CSSProperties}
    >
      {user && <span className="gprompt__user">{user}</span>}
      {host && <span className="gprompt__host">@{host}</span>}
      {path && <span className="gprompt__path">{path}</span>}
      <span className="gprompt__sigil">{sigil}</span>
      {command !== undefined && <span className="gprompt__cmd">{command}</span>}
      {ghost && <span className="gprompt__ghost">{ghost}</span>}
      {caret && <span className="gprompt__caret" aria-hidden />}
      {meta && (
        <>
          <span className="gprompt__gap" />
          <span className="gprompt__meta">{meta}</span>
        </>
      )}
    </div>
  )
}
