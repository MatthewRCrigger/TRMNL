/** Completion notifications.
 *
 * A long build finishing while you have switched to another app is worth
 * interrupting for; `ls` finishing is not. The rules, in order:
 *
 *  1. The window must be unfocused — if you are watching the block stream, the
 *     block itself already told you.
 *  2. The command must have run past a threshold. Anything fast enough to watch
 *     does not warrant a notification.
 *  3. Permission is requested lazily, on the first notification that qualifies,
 *     so launching TRMNL never triggers a permission prompt on its own.
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

import { formatDuration, type Block } from '../term/types'

/** Below this, the command was quick enough that you were probably watching. */
export const NOTIFY_AFTER_MS = 10_000

/** Cached so we ask the OS once per launch rather than per notification. */
let granted: boolean | null = null

async function ensurePermission(): Promise<boolean> {
  if (granted !== null) return granted
  try {
    granted = await isPermissionGranted()
    if (!granted) {
      granted = (await requestPermission()) === 'granted'
    }
  } catch {
    // A denied or unavailable notification centre is not an error worth
    // surfacing; we simply stay quiet.
    granted = false
  }
  return granted
}

export function shouldNotify(block: Block, windowFocused: boolean): boolean {
  if (windowFocused) return false
  if (block.running) return false
  if (!block.cmd.trim()) return false
  // An interactive session's duration measures how long the user sat in the
  // overlay, not how long work took.
  if (block.interactive) return false
  return (block.ms ?? 0) >= NOTIFY_AFTER_MS
}

/** Fire a completion notification for a finished block. */
export async function notifyComplete(block: Block, sessionName: string): Promise<void> {
  if (!(await ensurePermission())) return

  const failed = block.code !== undefined && block.code !== 0
  const duration = block.ms !== undefined ? formatDuration(block.ms) : ''

  try {
    sendNotification({
      title: failed ? `Failed · exit ${block.code}` : `Done · ${duration}`,
      // The command is the useful part; the session tells you which one.
      body: `${block.cmd}\n${sessionName}`,
    })
  } catch {
    // Never let a notification failure affect the terminal.
  }
}

/** Reset cached permission state. Test seam. */
export function resetPermissionCache(): void {
  granted = null
}
