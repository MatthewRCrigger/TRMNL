/** The attach frame — what replaces the cold-boot sequence.
 *
 * Four corner brackets, the wordmark at 40px, a green `SESSION ATTACHED` badge
 * and one line of machine facts. Nothing draws in. Nothing resolves from wide
 * tracking. Nothing fades.
 *
 * This is what is on screen for the ~40ms before first paint, not a sequence
 * anyone waits through — which is why it has no timer of its own and no exit
 * animation: the moment `init()` settles, App stops rendering it.
 */

import { useStore } from '../state/store'
import { Badge, Wordmark } from './grid'

export function AttachFrame() {
  const host = useStore((s) => s.host)

  return (
    <div className="attach" aria-hidden>
      <div className="attach__notches">
        <span className="notch notch--tl" />
        <span className="notch notch--tr" />
        <span className="notch notch--bl" />
        <span className="notch notch--br" />
      </div>

      <Wordmark size={40} />

      <Badge tone="success" dot>
        SESSION ATTACHED
      </Badge>

      {/* Real numbers or nothing: the line is absent until the host reports,
          rather than showing placeholders that would be wrong for a frame. */}
      {host && (
        <div className="attach__meta">
          {host.version} · DARWIN {host.osVersion} {host.arch.toUpperCase()} ·{' '}
          {host.shell.split('/').at(-1)}
        </div>
      )}
    </div>
  )
}
