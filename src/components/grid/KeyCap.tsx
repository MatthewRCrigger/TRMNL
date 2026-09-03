/** KeyCap — a chord glyph in an outlined square-ish key.
 *
 * One of only two things in the system that get a 2px radius (the other is
 * Badge); buttons and inputs stay square. `min-width` tracks the height so a
 * single glyph reads as a key rather than as a narrow pill.
 *
 * The glyphs themselves stay as type rather than becoming icons — ⌘ ⌃ ⇧ ⌥ ⇥ ↵
 * ↑ ↓ are what the keyboard is actually engraved with.
 */

export type KeyCapSize = 'sm' | 'md' | 'lg'

interface Props {
  size?: KeyCapSize
  /** Fills amber with inverted text — a held or currently-armed key. */
  active?: boolean
  children: React.ReactNode
}

export function KeyCap({ size = 'sm', active = false, children }: Props) {
  return (
    <span className={`gkey gkey--${size}`} data-active={active || undefined}>
      {children}
    </span>
  )
}
