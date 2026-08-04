/** A colour swatch and a hex box, kept in sync.
 *
 * Colours are stored as oklch because the token set derives every neutral from
 * `--ac` via `color-mix`, but nobody should have to author oklch by hand to pick
 * a colour. This is the way in: the swatch opens the system picker, the hex box
 * takes a value from anywhere else, and both write the same stored oklch.
 *
 * Hex is the exchange format rather than the stored one. `<input type="color">`
 * speaks nothing else, and hex is what a brand guide, a designer, or any other
 * tool will hand the user.
 */

import { useState } from 'react'

import { anyColorToHex, formatOklch, hexToOklch } from '../lib/color'

/** Shown when a field opens on a value the picker cannot represent. */
const FALLBACK_HEX = '#7f7f7f'

export function ColorField({
  value,
  onChange,
  label,
}: {
  /** The stored colour, in any CSS notation. Empty means unset. */
  value: string
  /** Called with the new colour, formatted as oklch. */
  onChange: (color: string) => void
  label: string
}) {
  const hex = anyColorToHex(value)

  // The text box holds its own text while focused, so a half-typed `#a1` is not
  // parsed, rejected, and yanked out from under the cursor on every keystroke.
  //
  // The draft is cleared on blur rather than when `value` changes: typing a
  // complete hex commits, which changes `value`, and resetting on that would
  // rewrite the box to the normalised form mid-edit — `#abc` becoming `#aabbcc`
  // under the cursor. While the box is not focused it simply mirrors `value`, so
  // a swatch click or a different profile still lands.
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (next: string) => {
    const parsed = hexToOklch(next)
    if (parsed) onChange(formatOklch(parsed))
  }

  return (
    <div className="cfield">
      {/* The native control is invisible and stretched under the swatch: it
          cannot be styled, but it is what opens the system picker and what
          makes the whole thing keyboard-reachable. */}
      <span className="cfield__well" style={hex ? { background: hex } : undefined}>
        <input
          className="cfield__native"
          type="color"
          value={hex ?? FALLBACK_HEX}
          onChange={(e) => commit(e.target.value)}
          aria-label={label}
        />
      </span>

      <input
        className="cfield__hex"
        value={draft ?? hex ?? ''}
        onChange={(e) => {
          setDraft(e.target.value)
          // Commit as soon as it parses, so the interface previews while typing;
          // an incomplete value simply waits.
          const withHash = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
          if (hexToOklch(withHash)) commit(withHash)
        }}
        onBlur={() => setDraft(null)}
        placeholder="#7f3fbf"
        aria-label={`${label} hex value`}
        spellCheck={false}
        maxLength={7}
      />
    </div>
  )
}
