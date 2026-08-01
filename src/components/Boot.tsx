/**
 * Cold-boot sequence: corner brackets draw in, the wordmark resolves.
 *
 * The whole point of this component is that it is *decorative and subordinate*.
 * A terminal is opened dozens of times a day, so the animation must never be
 * something the user waits on:
 *
 * - It is an overlay on top of an already-mounted, already-initialising app. It
 *   never gates rendering and never delays `init()`.
 * - `done` is driven by whichever happens first: real init finishing, the
 *   animation elapsing, or any keypress/pointer press. Init finishing first
 *   tears the overlay down mid-animation on purpose.
 * - `prefers-reduced-motion: reduce` skips it before the first paint.
 */

import { useEffect, useRef, useState } from 'react'

/** Matches the CSS timing; the overlay is torn down when this elapses. */
const BOOT_MS = 400

export function Boot({ ready }: { ready: boolean }) {
  // Resolved once, on mount, so a mid-animation settings change or a media
  // query flip cannot restart or extend a sequence already in flight.
  const enabled = useRef<boolean | null>(null)
  if (enabled.current === null) {
    enabled.current = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  const [done, setDone] = useState(!enabled.current)

  useEffect(() => {
    if (done) return

    // Any input dismisses instantly. Capture phase so the overlay cannot swallow
    // the event, and the listeners are passive since nothing is prevented — the
    // keystroke that skips the boot still reaches the composer.
    const skip = () => setDone(true)
    const timer = window.setTimeout(skip, BOOT_MS)

    window.addEventListener('keydown', skip, { capture: true, passive: true })
    window.addEventListener('pointerdown', skip, { capture: true, passive: true })

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', skip, { capture: true })
      window.removeEventListener('pointerdown', skip, { capture: true })
    }
  }, [done])

  // Real initialisation outrunning the animation is the case that matters most:
  // yield immediately rather than holding the user to the remaining timer.
  useEffect(() => {
    if (ready) setDone(true)
  }, [ready])

  if (done) return null

  return (
    <div className="boot" aria-hidden>
      <span className="bracket bracket--tl" />
      <span className="bracket bracket--tr" />
      <span className="bracket bracket--bl" />
      <span className="bracket bracket--br" />
      <span className="boot__word">TRMNL</span>
    </div>
  )
}
