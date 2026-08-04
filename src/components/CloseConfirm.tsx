/** Confirmation for closing a session/pane whose shell is still running a command.
 *
 * This is the one close path worth interrupting: an idle or already-exited
 * shell closes immediately (see `closeSession`/`closePane` in the store), so
 * reaching this dialog at all means a live process is about to be killed.
 */

import { useStore } from '../state/store'

export function CloseConfirm() {
  const pending = useStore((s) => s.closeConfirm)
  const session = useStore((s) => (pending?.kind === 'session' ? s.sessions[pending.id] : undefined))
  const confirmClose = useStore((s) => s.confirmClose)
  const cancelClose = useStore((s) => s.cancelClose)

  if (!pending) return null

  const cmd = session?.blocks.at(-1)?.cmd
  const subject = pending.kind === 'pane' ? 'This pane' : session?.name ?? 'This session'

  return (
    <div className="overlay" onMouseDown={cancelClose}>
      <div
        className="closeconfirm"
        onMouseDown={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-label="Confirm close"
      >
        <span className="bracket bracket--tl" />
        <span className="bracket bracket--br" />

        <div className="closeconfirm__head">
          <span className="dot" style={{ color: 'var(--warn)' }} />
          <span className="micro">PROCESS STILL RUNNING</span>
        </div>

        <p className="closeconfirm__body">
          {subject} is still running{cmd ? <> — <code>{cmd}</code></> : null}. Closing it now
          will kill the process.
        </p>

        <div className="closeconfirm__actions">
          <button className="btn is-btn" onClick={cancelClose} type="button" autoFocus>
            CANCEL
          </button>
          <button className="btn is-btn is-btn--danger" onClick={() => void confirmClose()} type="button">
            CLOSE AND KILL PROCESS
          </button>
        </div>
      </div>
    </div>
  )
}
