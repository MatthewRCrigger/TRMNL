/** Right-click menu.
 *
 * This exists to *replace* WebKit's stock menu, not to supplement it. That menu
 * offers Reload — and a reload throws away the frontend's session table while
 * the native side keeps every shell it described, so the page comes back to a
 * welcome screen whose sessions point at nothing. The backend reaps and reissues
 * ids to survive it, but nothing about a terminal wants a browser reload in the
 * first place, so the affordance is gone and these actions take its place.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useStore, type Profile, type Session } from '../state/store'
import { DEFAULT_PROFILE_NAME, folderName } from './Settings'

interface Point {
  x: number
  y: number
}

interface Entry {
  label: string
  kbd?: string
  run: () => void
  /** Renders as a divider above this item. */
  group?: boolean
  danger?: boolean
}

/** Keeps the menu off the window edges. */
const MARGIN = 8

/**
 * An existing profile that already describes this session, or undefined.
 *
 * "Already describes it" is the four fields that decide what a session *is* —
 * where it starts, which shell, which host, and what it runs on open. Name,
 * colour and env are deliberately excluded: they are how two profiles over the
 * same directory differ on purpose, and matching on them would call every
 * renamed profile a new one.
 *
 * The session's own profile is checked first, so a session that has not wandered
 * resolves to the profile that launched it rather than to some other row that
 * happens to point at the same place.
 */
export function matchingProfile(
  profiles: Profile[],
  session: Session,
  own: Profile | undefined,
  home: string | undefined,
): Profile | undefined {
  const same = (p: Profile) =>
    samePath(p.cwd, session.cwd, home) &&
    p.shell === session.shell &&
    // A session records its host, not the `user@host` string that produced it;
    // 'local' on both sides is the comparison that actually holds.
    (p.connectVia === 'local' || p.connectVia === '') === (session.host === 'local') &&
    // A startup command is part of what the profile does, but the session cannot
    // report whether it ran, so it only rules a profile *in* when there is none.
    !p.startupCmd

  if (own && same(own)) return own
  return profiles.find(same)
}

/** Two paths naming the same directory, allowing for `~` and a trailing slash. */
function samePath(a: string, b: string, homeDir: string | undefined): boolean {
  const norm = (p: string) => {
    let s = p.trim()
    if (homeDir && s.startsWith('~')) s = homeDir + s.slice(1)
    return s.replace(/\/+$/, '') || '/'
  }
  return norm(a) === norm(b)
}

export function ContextMenu() {
  const [at, setAt] = useState<Point | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState<Point | null>(null)

  const newSession = useStore((s) => s.newSession)
  const closeSession = useStore((s) => s.closeSession)
  const toggleSplit = useStore((s) => s.toggleSplit)
  const clearBuffer = useStore((s) => s.clearBuffer)
  const openSettings = useStore((s) => s.openSettings)
  const openPalette = useStore((s) => s.openPalette)
  const activeSessionId = useStore((s) => s.activeSessionId)
  const selectProfile = useStore((s) => s.selectProfile)
  const upsertProfile = useStore((s) => s.upsertProfile)
  const sessions = useStore((s) => s.sessions)
  const profiles = useStore((s) => s.profiles)
  const home = useStore((s) => s.host?.home)

  useEffect(() => {
    const onContext = (event: MouseEvent) => {
      // A right-click inside a text input should still get the system menu —
      // that is where Cut/Copy/Paste and the spelling items actually live, and
      // reimplementing them badly would be worse than borrowing them.
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return

      event.preventDefault()
      setAt({ x: event.clientX, y: event.clientY })
    }

    window.addEventListener('contextmenu', onContext)
    return () => window.removeEventListener('contextmenu', onContext)
  }, [])

  // Dismiss on anything that is not a click inside the menu.
  useEffect(() => {
    if (!at) return
    const close = () => setAt(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    // Capture phase, so a click outside dismisses the menu before it lands on
    // whatever is underneath. A pointerdown *inside* the menu has to be let
    // through untouched: unmounting here would destroy the button before the
    // click event it is about to produce, which is to say no item would ever
    // fire — pointerdown precedes click, and click needs a mounted target.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.ctxmenu')) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [at])

  // Flip the menu back inside the viewport once its real size is known.
  useLayoutEffect(() => {
    if (!at) {
      setPlaced(null)
      return
    }
    const box = menuRef.current?.getBoundingClientRect()
    if (!box) {
      setPlaced(at)
      return
    }
    setPlaced({
      x: Math.min(at.x, window.innerWidth - box.width - MARGIN),
      y: Math.min(at.y, window.innerHeight - box.height - MARGIN),
    })
  }, [at])

  if (!at) return null

  const sessionId = activeSessionId()
  const session = sessionId ? sessions[sessionId] : undefined
  // Only offer to edit a profile that still exists: an adopted session lost
  // which one spawned it, and a profile can be deleted out from under a session.
  const profile = session?.profileId
    ? profiles.find((p) => p.id === session.profileId)
    : undefined
  // An existing profile that already describes this session, so Save-as can open
  // it rather than mint a duplicate.
  const match = session ? matchingProfile(profiles, session, profile, home) : undefined

  const entries: Entry[] = [
    { label: 'New Session', kbd: '⌘T', run: () => void newSession() },
    {
      label: 'Clone Session',
      // Same profile and same cwd as the session it was cloned from, which is
      // the whole point — a second shell right where you already are.
      run: () => {
        const current = sessionId ? useStore.getState().sessions[sessionId] : undefined
        void newSession(current?.profileId, undefined, current ? { cwd: current.cwd } : undefined)
      },
    },
    // Straight to this session's own profile, which is where its colour, cwd and
    // startup command live. Without this the trip is ⌘, then hunting the right
    // row in a list that is one-per-client and grows.
    ...(profile
      ? [
          {
            label: `Edit Profile — ${profile.name}`,
            group: true,
            run: () => {
              selectProfile(profile.id)
              openSettings('profiles')
            },
          },
        ]
      : []),
    {
      // Snapshots where the session actually *is*, not where its profile said to
      // start — after a few `cd`s those differ, and the current directory is the
      // thing worth keeping. The rest is inherited so a new client profile is one
      // click plus a rename.
      //
      // When an existing profile already describes this exact setup, that one is
      // opened instead of a second copy of it. Saving twice from the same
      // directory is the common way a profile list quietly fills with
      // indistinguishable rows, and the label says which of the two will happen
      // rather than surprising you after the click.
      label: match ? `Open Profile — ${match.name}` : 'Save as New Profile',
      group: !profile,
      run: () => {
        if (match) {
          selectProfile(match.id)
          openSettings('profiles')
          return
        }
        const current = sessionId ? useStore.getState().sessions[sessionId] : undefined
        const id = `p-${Date.now().toString(36)}`
        upsertProfile({
          ...(profile ?? {
            shell: current?.shell ?? '',
            connectVia: 'local',
            startupCmd: '',
            env: [],
          }),
          id,
          // Named for the directory, matching how Browse… names a new profile.
          name: folderName(current?.cwd ?? '') || profile?.name || DEFAULT_PROFILE_NAME,
          cwd: current?.cwd ?? profile?.cwd ?? '~',
          isDefault: false,
        })
        selectProfile(id)
        openSettings('profiles')
      },
    },
    { label: 'Split Right', kbd: '⌘D', group: true, run: () => toggleSplit('row') },
    { label: 'Split Down', kbd: '⇧⌘D', run: () => toggleSplit('col') },
    { label: 'Command Palette', kbd: '⌘K', group: true, run: () => openPalette() },
    { label: 'Clear Buffer', kbd: '⌘⌫', run: () => sessionId && clearBuffer(sessionId) },
    { label: 'Settings', kbd: '⌘,', run: () => openSettings() },
    {
      label: 'Close Session',
      kbd: '⌘W',
      group: true,
      danger: true,
      run: () => sessionId && void closeSession(sessionId),
    },
  ]

  const pos = placed ?? at

  return (
    <div
      ref={menuRef}
      className="ctxmenu"
      role="menu"
      style={{ left: pos.x, top: pos.y, visibility: placed ? 'visible' : 'hidden' }}
    >
      {entries.map((entry) => (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          className="ctxmenu__item"
          data-group={entry.group ? 'true' : undefined}
          data-danger={entry.danger ? 'true' : undefined}
          onClick={() => {
            setAt(null)
            entry.run()
          }}
        >
          <span className="ctxmenu__label">{entry.label}</span>
          {entry.kbd ? <span className="ctxmenu__kbd">{entry.kbd}</span> : null}
        </button>
      ))}
    </div>
  )
}
