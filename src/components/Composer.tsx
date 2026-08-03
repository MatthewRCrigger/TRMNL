/** Composer — the input line.
 *
 * Uses the ghost-suggestion pattern from the design: a visible span stack
 * (typed text + caret + ghost remainder) with a transparent <input> positioned
 * over it. This avoids text measurement entirely, which is why the handoff says
 * to keep it.
 */

import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Props {
  value: string
  ghost: string
  focused: boolean
  shellLabel: string
  onChange: (value: string) => void
  onSubmit: () => void
  onAcceptGhost: () => void
  onHistory: (delta: number) => void
  onCancel: () => void
  onFocus: () => void
  /** Ask the shell to complete the line; resolves to candidates when ambiguous. */
  onComplete: () => Promise<string[]>
  /** Inert while an interactive program owns the session's input. */
  disabled?: boolean
}

export function Composer({
  value,
  ghost,
  focused,
  shellLabel,
  onChange,
  onSubmit,
  onAcceptGhost,
  onHistory,
  onCancel,
  onFocus,
  onComplete,
  disabled = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [resolved, setResolved] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const completing = useRef(false)

  const runCompletion = async () => {
    // TAB can repeat faster than the shell replies; ignore the extras rather
    // than interleaving two conversations on one PTY.
    if (completing.current) return
    completing.current = true
    try {
      setCandidates(await onComplete())
    } finally {
      completing.current = false
    }
  }

  // Keep the DOM focus in sync with which pane the store considers focused.
  // This also runs on mount, so a new session or split pane is ready to type in
  // without a click.
  useEffect(() => {
    if (!focused || disabled) return
    const input = inputRef.current
    if (!input || document.activeElement === input) return
    // preventScroll: focusing must never yank the block stream around.
    input.focus({ preventScroll: true })
  }, [focused, disabled])

  // Clicking chrome — a rail row, a block action, the pane background — moves
  // DOM focus off the input, and the next keystroke would go nowhere. Return it
  // to the composer once the click settles, unless the click landed on another
  // text field (settings, palette) that legitimately wants the caret.
  useEffect(() => {
    if (!focused || disabled) return

    const reclaim = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      // Never interfere with a window drag: stealing focus mid-gesture can cancel
      // it, and the title bar has nothing to type into anyway.
      if (target?.closest('[data-tauri-drag-region]')) return
      // Let the click's own focus changes land first.
      window.setTimeout(() => {
        const input = inputRef.current
        if (!input) return
        const active = document.activeElement
        if (active === input) return
        if (active?.matches('input, textarea, [contenteditable="true"]')) return
        input.focus({ preventScroll: true })
      }, 0)
    }

    window.addEventListener('mouseup', reclaim)
    return () => window.removeEventListener('mouseup', reclaim)
  }, [focused, disabled])

  // Resolve the first word against $PATH for the right-aligned hint.
  useEffect(() => {
    const first = value.trim().split(/\s+/)[0]
    if (!first) {
      setResolved(null)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      invoke<string | null>('which', { cmd: first })
        .then((path) => {
          if (!cancelled) setResolved(path)
        })
        .catch(() => {
          if (!cancelled) setResolved(null)
        })
    }, 90)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [value])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // ⌃C cancels; it is not remappable.
    if (event.ctrlKey && event.key === 'c') {
      event.preventDefault()
      onCancel()
      return
    }

    switch (event.key) {
      case 'Enter':
        event.preventDefault()
        onSubmit()
        break
      case 'Tab':
        // Always consume TAB. Without this the browser moves focus and the
        // composer silently loses the caret — there is nowhere sensible to tab
        // to in a terminal.
        event.preventDefault()
        if (ghost) {
          onAcceptGhost()
        } else {
          void runCompletion()
        }
        break
      case 'ArrowUp':
        // History recall only when the caret is at the start of a single line.
        event.preventDefault()
        onHistory(-1)
        break
      case 'ArrowDown':
        event.preventDefault()
        onHistory(1)
        break
      default:
        break
    }
  }

  return (
    <div className="composer no-drag" data-disabled={disabled} onMouseDown={onFocus}>
      {candidates.length > 0 && (
        <div className="completions">
          <div className="completions__head micro">
            {candidates.length} MATCHES
          </div>
          <div className="completions__list">
            {candidates.map((candidate) => (
              <span className="completions__item" key={candidate}>
                {candidate}
              </span>
            ))}
          </div>
        </div>
      )}

      <span className="bracket bracket--tl" style={{ width: 9, height: 9 }} />

      <div className="composer__row">
      <span className="composer__prompt">❯</span>

      <div className="composer__field">
        {/* Ghost layer, behind the input. It holds an invisible copy of the typed
            text purely as a spacer so the suggestion starts in the right column —
            same trick as before, no text measurement — but it no longer draws the
            caret or the typed text. The input itself is now visible and renders
            both, natively. */}
        <span className="composer__ghosts" aria-hidden="true">
          <span className="composer__spacer">{value}</span>
          <span className="composer__ghost">{ghost}</span>
        </span>
        <input
          ref={inputRef}
          className="composer__input"
          value={value}
          onChange={(e) => {
            // Typing supersedes the candidate list.
            if (candidates.length > 0) setCandidates([])
            onChange(e.target.value)
          }}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="Command input"
          disabled={disabled}
        />
      </div>
      </div>

      {/* Reserved line. The hint used to sit in the input's flex row, so a long
          resolved path stole width and the input visibly shrank as you typed.
          Giving it its own fixed-height row below keeps the input a constant
          width and the composer a constant height. */}
      <div className="composer__meta">
        <span className="composer__hint">{resolved ?? shellLabel}</span>
      </div>
    </div>
  )
}
