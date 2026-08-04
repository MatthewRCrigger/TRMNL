# Auto-update — specification

Status: **proposed, not built.** This describes what an updater for TRMNL would
look like, what it costs, and the decisions that have to be made before writing
any of it.

Written 2026-08-04 against TRMNL 0.4.1, Tauri 2, `aarch64-apple-darwin`.

## Why

New versions currently reach people by hand: build, notarize, publish a release,
tell them. They stay on whatever they installed until told otherwise, and there
is no way to know what anyone is running. A three-person group can live with
that; it stops working as soon as a bug needs to reach everyone.

## What the user would see

On launch, the app quietly asks a URL whether there is a newer version. If there
is, it says so and offers to install. Accepting downloads the new build, checks
its signature, replaces the app in place, and restarts into it. No disk image, no
drag to Applications.

Declining is remembered for that version, so the same prompt does not reappear
every launch.

## How it works

Four parts.

**1. A signing keypair, separate from the Apple certificate.** These prove
different things and are not interchangeable. The Apple Developer ID proves to
*macOS* that the app came from a known developer. This keypair proves to *the
already-installed app* that an update came from the same origin as itself. Tauri
will not install an update whose signature does not verify against the public key
compiled into the running build.

    npm run tauri signer generate -- -w ~/.tauri/trmnl.key

**2. Updater artifacts.** With `createUpdaterArtifacts: true`, the build emits
two extra files beside the `.dmg`:

| file | what it is |
|---|---|
| `TRMNL.app.tar.gz` | the app bundle, compressed — the update payload |
| `TRMNL.app.tar.gz.sig` | its signature, made with the private key above |

**3. A manifest at a fixed URL**, listing the current version and where to get
it:

```json
{
  "version": "0.5.0",
  "notes": "Short summary shown in the prompt.",
  "pub_date": "2026-08-10T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of TRMNL.app.tar.gz.sig>",
      "url": "https://github.com/MatthewRCrigger/TRMNL/releases/download/v0.5.0/TRMNL.app.tar.gz"
    }
  }
}
```

`darwin-aarch64` is the only platform key TRMNL needs — Apple Silicon is the
only supported target, and that is a decision rather than a gap.

**4. A check in the app**, on launch and behind a manual "Check for updates"
menu item.

## Configuration

`src-tauri/Cargo.toml`:

```toml
tauri-plugin-updater = "2"
```

`package.json`:

```
@tauri-apps/plugin-updater
```

`src-tauri/tauri.conf.json`:

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<public key from signer generate>",
      "endpoints": ["https://github.com/MatthewRCrigger/TRMNL/releases/latest/download/latest.json"]
    }
  }
}
```

`src-tauri/capabilities/default.json` needs `updater:default` added to
`permissions`. Its `windows` list already covers `main` and `win-*`, so no change
there — but see *Multi-window* below.

Builds must run with the private key in the environment:

    TAURI_SIGNING_PRIVATE_KEY=~/.tauri/trmnl.key npm run app:release

## What this requires that already exists

- **A stable URL.** GitHub Releases gives
  `releases/latest/download/<name>`, which does not change between versions.
  This is why the repository was made public; it is the thing the updater polls.
- **Notarized builds.** `scripts/release.sh` already produces them.
- **Consistent versions.** The manifest compares against the running build's
  version, so the four version files must agree — see AGENTS.md.

## Notarization, precisely

Worth stating carefully, because the intuitive answer is wrong.

The `.app` inside the current release has **no stapled ticket**, yet a quarantined
copy of it is still `accepted / source=Notarized Developer ID`. Gatekeeper checks
Apple's notarization service over the network when no ticket is stapled locally.
Notarization is a record held by Apple against the binary's hash, not solely a
file attached to it.

Consequences for the updater:

- The `.app.tar.gz` payload does not need its own notarization submission. It
  contains the same signed, already-notarized bundle.
- It **does** need to contain the bundle produced by a signed release build.
  Shipping an ad-hoc-signed app would fail on the user's machine, the same way
  the pre-0.4.0 disk images did.
- Stapling matters for **offline** first launch. A stapled ticket is checked
  locally; without one, a machine with no network may refuse the app. Worth
  testing before relying on it — the update itself requires network anyway, but
  the *next* cold launch may not have one.

**Open question:** whether to staple the `.app` inside the tarball. Cheap to do
(`xcrun stapler staple` before compressing) and removes the offline doubt
entirely. Recommend doing it.

## Risks

**Losing the private key is unrecoverable.** Every installed copy carries the
matching public key and will reject anything signed by a different one. There is
no remote override — the only recovery is telling every user to download a new
build by hand. It must be backed up somewhere durable, not left only in
`~/.tauri`.

**A bad update is pushed to everyone at once.** Today a broken build affects
whoever downloads it next; with an updater it reaches every install on next
launch. Mitigations, in order of value: keep `release.sh`'s Gatekeeper
verification as the gate, install and run the build locally before publishing the
manifest, and publish the manifest as a *separate step* from the release so a bad
build can be caught in between.

**The manifest and the release can disagree.** If the manifest is hand-edited,
its `version`, `url` and `signature` can drift from the artifacts. Generating it
from the build output rather than by hand removes the whole class.

**Silent failure.** An update that fails to download or verify must say so.
Failing quietly leaves someone on an old build believing they are current, which
is worse than having no updater.

## Multi-window

Sessions are owned by windows and hold live PTYs. An update restarts the app, so
it must not be offered while work is in flight without warning. Minimum: do not
prompt automatically when any session has a running command; state that
installing will close all windows and end running sessions.

The check should also run once per app launch, not once per window — the natural
mistake here, and the same class as the app-wide `emit` warning in AGENTS.md.

## Work involved

| step | notes |
|---|---|
| Generate and back up the keypair | one-time; irreversible if lost |
| Add plugin, config, capability | mechanical |
| Check-on-launch and menu item | small UI, plus the running-command guard |
| Generate the manifest in `release.sh` | reads version and `.sig` from the build |
| Publish manifest as a release asset | `gh release upload` |
| Test an actual upgrade | install an older build, publish a newer one, watch it upgrade |

Roughly a focused afternoon, most of it in the last row. The upgrade test is the
only part that proves any of it works.

## Decisions needed first

1. **Staple the `.app` inside the tarball?** Recommend yes.
2. **Check automatically on launch, or only from the menu?** Automatic with a
   dismissible prompt is conventional; menu-only is more predictable.
3. **Who is this for?** If TRMNL stays a handful of friends, the manual path is
   honestly fine and this can wait. The updater earns its keep at the point where
   telling everyone individually stops being realistic.

## Prerequisite

Do not build this until someone other than the author has installed a release
and confirmed it opens cleanly. Until then a failure in the updater and a failure
in distribution look identical from the outside — "it didn't update" — and
debugging two unfamiliar signing systems at once is how an afternoon becomes a
week.
