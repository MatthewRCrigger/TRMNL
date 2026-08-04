# Working on TRMNL

Operational notes for coding agents. `README.md` explains what the app is and
how it is built; this file is the shorter, sharper list of things that have
already cost someone an afternoon. Read the README's Architecture section before
changing how blocks, sessions or tokens work.

## Verify before you claim

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest, ~208 tests
npm run test:rust      # cargo test --lib
npm run app            # tauri dev, hot reload
```

Run all three checks before saying something works. `npm run build` is
typecheck + Vite and does not compile Rust, so it will not catch a broken
`src-tauri`.

## The accent system is load-bearing

Every neutral in `src/styles/tokens.css` is derived from the accent via
`color-mix`, so one variable repaints the whole interface. That property is what
makes identities, per-profile colours and command accents work. Do not replace a
derivation with a literal value.

Three tokens, and picking the wrong one is a real bug:

- `--ac-raw` — the colour exactly as chosen. **Write this**, never `--ac`.
- `--ac` — `--ac-raw` with lightness floored to 0.62. Structure: hairlines,
  washes, fills, borders.
- `--act` — floored to 0.7. **Text only.**

The floors exist because every hairline is the accent at ~26% opacity over a
near-black page, which silently assumes the accent is lighter than the page. The
five shipped identities all are; an arbitrary picked colour is not. Setting black
used to dissolve the interface entirely.

`contrast-color()` is supported in this webview but is the wrong tool here — it
returns black or white for text *on* a given background, whereas this is
accent-coloured text on a fixed dark surface. Using it discards the accent.

Accent precedence, strongest first: **running command → session's profile →
global identity**. Command beats profile deliberately — a client colour a running
`docker` could not tint would make the command rules useless in the sessions
doing work, and a command's colour reverts itself where a profile's does not.

Reading a colour token from JS needs care: `getPropertyValue('--ac')` returns the
*unresolved* `oklch(from …)` text. Resolve it through a probe element — see
`readColor` in `src/components/TerminalView.tsx`.

## Sessions are owned by windows

Rust owns the session table so multiple windows can exist. When touching session
lifecycle, ask which window owns it. Any app-wide `emit` is suspect — prefer
emitting to the owning window, or it double-fires per window. Menu events must
route to the *focused* window, never a named one.

A new window's label must be covered by the `win-*` glob in
`src-tauri/capabilities/default.json`, or it gets no permissions and loads
completely dead — a failure that names no window and looks like a broken build.

## Command accents scan the process tree

Accents resolve from the process tree under a session's shell
(`src-tauri/src/proctree.rs` → `pty_tools` → `accentFor`), not just the typed
command: `bun run start` names no tool, while `shopify` may be four levels down.

Two non-obvious facts, both verified against a live tree:

- **Process names are useless.** `node_modules/.bin` shims run as `node`/`bun`,
  so the tree reports the runtime. Match argv basenames, not `proc.name()`.
- **Tree order is a startup race.** `run-p` starts children concurrently, so
  `accentFor` iterates the configured *rules* and takes the first present in the
  tree. Iterating tree words would be nondeterministic.

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

Profiles are **not** validated on load; colours are validated at the point of use
(`profileAccent`) so a hand-edited file cannot break the theme. Nothing seeds this
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
Credentials live there rather than in a `.env` on purpose — the credential is an
app-specific password, and the keychain keeps it encrypted.

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

Builds are **arm64 only**; `aarch64-apple-darwin` is the sole installed Rust
target, so Intel Macs cannot run TRMNL at all.

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
