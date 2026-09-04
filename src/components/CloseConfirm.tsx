/** `CLOSE .SESSION` — confirmation for closing a shell that is still running.
 *
 * This is the one close path worth interrupting: an idle or already-exited
 * shell closes immediately (see `closeSession`/`closePane` in the store), so
 * reaching this dialog at all means a live process is about to be killed.
 *
 * `tone="danger"` recolours the frames, the title and the header border in red
 * together — the dialog *is* the warning, rather than a neutral box with a
 * warning chip inside it.
 */

import { useStore } from '../state/store'
import { Alert, Button, Dialog } from './grid'

export function CloseConfirm() {
  const pending = useStore((s) => s.closeConfirm)
  const session = useStore((s) => (pending?.kind === 'session' ? s.sessions[pending.id] : undefined))
  const confirmClose = useStore((s) => s.confirmClose)
  const cancelClose = useStore((s) => s.cancelClose)

  const cmd = session?.blocks.at(-1)?.cmd
  const subject = pending?.kind === 'pane' ? 'this pane' : (session?.name ?? 'this session')

  return (
    <Dialog
      open={!!pending}
      onClose={cancelClose}
      escapeHandledByWindow
      title="CLOSE .SESSION"
      tone="danger"
      width={480}
      className="closeconfirm"
      footer={
        <>
          <Button variant="secondary" onClick={cancelClose} autoFocus>
            CANCEL
          </Button>
          <Button variant="primary" tone="danger" onClick={() => void confirmClose()}>
            CLOSE ANYWAY
          </Button>
        </>
      }
    >
      <p className="closeconfirm__body">
        {/* The session is named in mono amber: it is the thing being acted on,
            and naming it in the same voice as the command below keeps the two
            facts reading as one sentence about one shell. */}
        <span className="closeconfirm__subject">{subject}</span> still has a live process.
      </p>

      {cmd && (
        <Alert tone="danger" title="STILL RUNNING">
          {cmd}
        </Alert>
      )}
    </Dialog>
  )
}
