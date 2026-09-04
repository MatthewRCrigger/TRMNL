# Working on TRMNL

Operational notes for coding agents. `README.md` explains what the app is and
how it is built; this file is the shorter, sharper list of things that have
already cost someone an afternoon. Read the README's Architecture section before
changing how blocks, sessions or tokens work.

## Verify before you claim

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest, ~234 tests
npm run test:rust      # cargo test --lib
npm run app            # tauri dev, hot reload
```

Run all three checks before saying something works. `npm run build` is
typecheck + Vite and does not compile Rust, so it will not catch a broken
`src-tauri`.

## The front end is GRID, and it is monochrome

`src/styles/tokens.css` is the whole colour system and every value in it is a
literal. There is no accent to derive from and no `color-mix` chain repainting
the interface — that was the old system, and it is gone along with the six
identities, per-profile colours and command accents.

Colour here is a **signal**, never decoration. Every signal hue sits on one
lightness/chroma plane — L 0.83 / C 0.14, red excepted at L 0.70 / C 0.19 so
alarm reads hotter — which is what stops any one of them shouting louder than
the others. Reach for a role (`--accent`, `--live`, `--success`, `--danger`),
not a hue, and go through `toneColor()` in `components/grid/tone.ts` rather than
naming a colour at a call site.

Hierarchy comes from **line brightness**, not thickness. Four brightnesses
(`--line-100` … `--line-400`) and one weight: `--stroke-1` for everything that
is not a panel border. If you find yourself thickening a rule to make it read,
brighten it instead.

Depth is three things in this order, and nothing else: line brightness, then
surface fill, then a scrim. **There are no drop shadows** — the single exception
is `--elev-dialog`, a hard 1px halo of void so a dialog frame never touches what
bleeds through the scrim behind it.

Two type families, split by origin, and the test is *did a person write it or
did a system emit it*: Rajdhani (`--font-display`) for headings, labels and
buttons; Space Mono (`--font-mono`) for commands, output, paths and counters.
Casing carries the same split — uppercase is the app talking about itself,
lowercase is user content and shell truth. **12px is the floor.**

Two traps worth naming:

- `--ink-400` is **disabled state only**. The composer's ghost suggestion is
  Tab-acceptable, which makes it load-bearing copy: it takes `--ink-300`.
- Pairing a control height with the wrong padding — 28/10, 36/14, 44/20. The
  `Button` size lookup exists so a caller cannot get this wrong.

Reading a token from JS is now trivial: `getPropertyValue('--signal-amber')`
returns a hex string xterm can parse directly. The probe-element trick relative
colour syntax used to need is gone.

## The system is still

No entrance animation, no fade-in, no bounce, no infinite loop. A machine
display either shows a state or it doesn't. There is deliberately **not one
`@keyframes` in `src/`** — a new one is almost certainly a mistake.

`--transition-state` transitions **only** `color`, `background-color` and
`border-color`, at 80ms linear. If you are transitioning `transform`, `opacity`,
`width` or `box-shadow`, it is wrong. Overlays appear at 0ms.

The one blink in the build is xterm's own cursor, which is a real terminal
cursor in a real emulator; the stillness rule governs chrome. `Prompt` draws a
**static** block caret and `Badge` a **static** dot.

`src/styles/tokens.test.ts` asserts all of this against the stylesheets — no
keyframes, no unsanctioned shadow, no literal `font-size`, every tint fill at or
below 0.16, and the four applied rows intact. It has already caught one real
regression (an inherited `transition: all` that would have animated opacity), so
when it fails, read it before working around it.

## Blocks are panels

The core mapping of the rebuild, in `blockPanel` (`src/term/types.ts`): a
block's state *is* its panel's border colour and header fill, not a chip bolted
onto a header.

| State | Colour | Header filled |
|---|---|---|
| settled, exit 0 | unset → `--line-300` | no |
| latest | unset → `--line-100` | **yes** |
| non-zero exit | red | **yes** |
| running / live | cyan | no |
| raw scrollback dump | *no panel at all* | — |

`panelColor: null` means "unset", which is not the same as an explicitly
neutral colour: only the first stays theme-aware. `headerFilled` is reserved for
the block you are *reading* — latest plus a failure is the intended maximum in
one viewport, and a stream of them is a bug.

`Panel` takes the six toggles as **real props**, not one `bordered` boolean.
That is what lets a dump clear its frame while a failure keeps its red border:
the user's preferences supply the geometry, the block's own state supplies the
colour and the fill, and status is never a preference.

The **double frame** — outer line, a gap of void, inner line — is reserved for
the outermost container of a view. The window has one; a dialog is its own view
so it has one too. Inside one, single hairlines only, or the screen turns to
corduroy. The terminal takeover draws the figure at `--stroke-1` for exactly
this reason.

## Sessions are owned by windows

Rust owns the session table so multiple windows can exist. When touching session
lifecycle, ask which window owns it. Any app-wide `emit` is suspect — prefer
emitting to the owning window, or it double-fires per window. Menu events must
route to the *focused* window, never a named one.

A new window's label must be covered by the `win-*` glob in
`src-tauri/capabilities/default.json`, or it gets no permissions and loads
completely dead — a failure that names no window and looks like a broken build.

## The process tree still feeds the window title

`src-tauri/src/proctree.rs` → `pty_tools` scans the tree under a session's shell
and the result lands in `session.tools`. It no longer picks an accent — that
went with the identity system — but the window title still reads it, because
`bun run start` names no tool and the tree is the only description of what is
actually running.

**Process names are useless** for this: `node_modules/.bin` shims run as
`node`/`bun`, so the tree reports the runtime. Match argv basenames, not
`proc.name()`.

## Config lives outside the bundle

`~/.config/trmnl/config.json`, written atomically by `src-tauri/src/config.rs`.
Deliberately a dotfile, not Application Support.

Every window writes to that one file, so a save merges rather than blindly
serialising. **Profiles are application-global**: a profile added in one window
must be reachable from every other, so `mergeConfig` unions them by id against
what is on disk rather than assigning this window's list. Assigning it deleted
profiles another window had just added — a stale list is indistinguishable from
an authoritative one.

Deletion therefore cannot be expressed by absence: an id missing from this
window's list looks the same as one it never learned about, and the union would
resurrect it. `deletedProfiles` carries the ids this window removed on purpose.
Any new globally-shared collection needs the same treatment.

Workspace layout is the opposite — per-window, under its own key.

Live windows are kept in step by a `trmnl://config-sync` event carrying settings
and profiles (`listenForConfigSync`). Only the shared slices travel; sessions,
panes and focus are the window's own, and syncing those would make two windows
mirror each other rather than be independent views.

Profiles are **not** validated on load — they carry no colour any more, so
there is nothing in one that could break the theme. Settings are: `pickSettings`
rebuilds the object field by field rather than spreading what was on disk, which
is what keeps a retired key (`accent`, `glow`, `bootSequence`) from surviving a
save. Its `panel` block clamps rather than rejects, because geometry has a
sensible nearest neighbour where a rejected block would discard three good
fields alongside one bad one. Nothing seeds this
file, so a fresh install on another Mac is genuinely a clean slate.

## Tauri is not Electron

`-webkit-app-region: drag` silently does nothing. Use `data-tauri-drag-region` on
the element that actually receives the event.

Native window tabbing is unavailable: Tauri force-disables it when
`transparent: true`, and setting `tabbing_identifier` is a silent no-op.

## Releases

Never distribute a `npm run app:build` DMG. That produces an **ad-hoc,
linker-signed** app — no hardened runtime, no entitlements, no sealed resources —
and Gatekeeper rejects it outright with "TRMNL is damaged", not a click-through
warning.

```bash
npm run app:release
```

`NOTARY_PROFILE` defaults to `TRMNL-notary`, a `notarytool` keychain profile.
The *password* lives there rather than in a dotfile on purpose — it is an
app-specific password, and the keychain keeps it encrypted.

The signing **identity** is the other half, and it is deliberately not in the
repo: `scripts/signing-env.sh` resolves `APPLE_SIGNING_IDENTITY` from the
environment or a gitignored `.env.local`, and exits with instructions when it
finds neither. Do not reintroduce a hardcoded default. This repo is public and
gets forked; a Team ID is not a secret — `codesign -dvvv` reads it out of any
shipped artifact — but a default identity means a forker's first release build
fails against a certificate belonging to someone else, which reads as a broken
repo rather than "supply your own."

Tauri warns mid-build that it is *"skipping app notarization, no APPLE_ID &
APPLE_PASSWORD … found"*. That is expected: only the `.dmg` needs a ticket, and
the `.app` inside it clears Gatekeeper through the disk image's. Giving Tauri
credentials buys a second round trip to Apple and nothing else.

For the same reason the two artifacts are verified differently — the `.app` with
`spctl -t exec`, the `.dmg` with `spctl -t install` *and* `stapler validate`.
Requiring a stapled ticket on the `.app` fails every release while printing
`accepted` on the very next line.

Bump the version in **all four** places or the app misreports itself:
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`src-tauri/Cargo.lock`.

**Nothing that expires goes on the installer background.** It is a flat PNG
(`src-tauri/dmg/`), so anything written on it is a claim the build cannot
verify — and a baked-in version goes stale on the *next* release while the DMG
still mounts and installs perfectly, which is the worst kind of wrong.
`scripts/check-dmg-background.sh` OCRs the asset and fails the release on a
mismatch; it runs before the build, so a stale asset costs seconds rather than a
full sign-and-notarize round trip. Its icon coordinates also have to agree with
`bundle.macOS.dmg` in `tauri.conf.json` — the artwork's corner notches frame
the icon boxes, so a position change means re-exporting the background.

The icon bundle is `crggr-sh.icon/` and Tauri cannot read it; regenerate the
rasters with `scripts/composite-icon.swift`, which takes layers **bottom-first**
(`icon.json` lists them top-first, the way a layers panel reads).

**`bundle_dmg.sh` needs Automation permission.** It runs `osascript` to have
Finder position icons in the mounted volume, and Tauri swallows the output, so a
denied permission surfaces only as:

```
failed to bundle project: error running bundle_dmg.sh
```

Check with `osascript -e 'tell application "Finder" to get name of startup disk'`.
An agent's own shell may hold this permission when the user's terminal does not —
"it works when I run it" is evidence of a permission difference, not of a working
script. Grant it under System Settings → Privacy & Security → Automation.

Builds are **arm64 only**. Apple Silicon is the supported target by decision, not
by omission — do not offer a universal build or `x86_64-apple-darwin` as a fix.

There is no auto-update, and adding one is not a small change: see
[docs/updater-spec.md](docs/updater-spec.md) for what it involves and the
decisions that come first.

## Installing locally

```bash
npm run app:install            # copy the existing build to /Applications
npm run app:install -- --build # build first, then copy
```

Separate from `app:release` because the two want different things: shipping needs
a notarized `.dmg`, while running it yourself needs neither the disk image nor the
round trip to Apple — a bundle you built locally has no quarantine attribute, so
Gatekeeper never challenges it.

The script refuses to install while TRMNL is running from `/Applications`, since
replacing a bundle under a live process leaves a half-written copy. It uses
`ditto` rather than `cp` to preserve the extended attributes the signature is
computed over, and re-verifies the signature afterward.

## House style

Match the surrounding code. Comments here explain *why*, especially where a
choice looks wrong without context — several existing comments document
deliberate deviations from the design handoff, and those are worth preserving.
Tests read as prose about behaviour rather than restating the implementation.

Settings save immediately; there is no Save button and there should not be one.

`src/harness/` renders the real components against fixture data at
`/harness.html` under `npm run dev`. It exists because the app itself cannot run
in a plain browser — Tauri's IPC bridge is absent, so `init()` throws — and
because a type checker cannot see a badge that vanished into the header fill
behind it. It is a rendering check, not a test; behaviour belongs in vitest. The
production build does not include it.
