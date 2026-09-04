# CRGGR.sh

A terminal for macOS, built on the GRID design system.

This is a real terminal — real PTYs, real shells, real ANSI — not a themed
viewer. The block model sits above the emulator rather than replacing it: each
command is one addressable unit, with boundaries reported by the shell rather
than guessed at.

The front end was rebuilt on GRID; the app previously shipped as TRMNL with a
TRON-derived visual system, and the repository, bundle identifier and config
directory still carry that name.

**Status: early.** It is used daily by its author and shared with a small group.
Interfaces and config format may still change between versions.

## Install

Download the latest `.dmg` from
[Releases](https://github.com/MatthewRCrigger/TRMNL/releases), open it, and drag
TRMNL to Applications. Builds are signed and notarized, so they open without a
Gatekeeper warning.

**Apple Silicon only** — Intel Macs are not supported and there are no plans to
add them. Requires macOS 11 or later.

To build from source, see [Running it](#running-it).

## Licence and credits

MIT — see [LICENSE](LICENSE).

The visual system is **GRID**, applied from its own handoff. Icons are
[Lucide](https://lucide.dev) (ISC), inlined so they inherit `currentColor`.
Type is [Rajdhani](https://fonts.google.com/specimen/Rajdhani) and
[Space Mono](https://fonts.google.com/specimen/Space+Mono), both OFL, bundled
locally rather than fetched at paint.

The build previously used [The Gridcn](https://github.com/educlopez/thegridcn-ui)
for its TRON-derived token values; nothing of it remains.

---

## What it's built on, and why

| Layer | Choice | Why this one |
|---|---|---|
| App shell | **Tauri 2** | 4.3 MB binary vs ~150 MB for Electron. Uses the system WebView, so nothing bundles Chromium. |
| Native half | **Rust** | Owns the PTYs, shell integration, telemetry and config — the parts that need real OS access. |
| PTY | **`portable-pty`** | Battle-tested (it is WezTerm's own PTY layer). One reader thread per session. |
| UI | **React 19** | The block stream is a list of derived views over changing state — the thing React is actually good at. |
| State | **Zustand** | One window = one store, panes are children. No context plumbing, no reducer ceremony. |
| Interactive programs | **xterm.js** | A real terminal grid for when a program takes over the screen. Not used for ordinary output. |
| Block boundaries | **OSC 133** | Shell-reported, not guessed. See [The block model](#the-block-model). |

### Why not SwiftUI / fully native?

This was the real fork in the road, and the honest answer is that **the product is
90% text layout and 10% OS integration** — which inverts what native AppKit or
SwiftUI is good at.

Concretely:

- **The design is a CSS design.** GRID is a system of hairlines, dotted leaders,
  tint fills and panels whose borders and header fills carry state. Reproducing
  a dotted leader that fills the gap in a header row, or a panel whose six
  toggles compose independently, means hand-rolling layout in SwiftUI that flexbox
  and `border-style: dotted` do for free.
- **Text layout is the whole product.** Proportional-width tables, hairline
  rules, tabular numerals, ellipsised paths, wrap behaviour on 10k-line
  scrollback — this is the browser's core competency and decades of its
  optimisation. `AttributedString` and `Text` are workable but you rebuild a lot.
- **`xterm.js` has no native peer.** The one genuinely hard problem here is
  emulating a terminal, and the mature implementations are either JS (`xterm.js`)
  or Rust/C++ libraries that would still need a renderer written around them.
  SwiftTerm exists but is a much smaller bet.
- **The 10% that is OS work is already native.** PTYs, `SIGWINCH`, `$PATH`
  resolution, load average, Keychain (pending) and notifications all live in the
  Rust half. The WebView is a rendering target, not the architecture.

What this trades away is real, and worth stating: **~40 ms of extra cold-start**,
no AppKit-native text selection semantics, and a WebView process per window. For
a terminal — long-lived, opened once, kept open — that is the right side of the
trade. For a menu-bar utility it would not be.

Electron would have worked too and the ecosystem is deeper, but it buys ~145 MB
and a second browser engine for capabilities this app never uses.

### How it fits together

```
┌─ Rust ──────────────────────────────────────────────────────────┐
│  pty.rs               spawns shells, one reader thread each     │
│  shell_integration.rs writes the OSC 133 hooks, injects them    │
│  detect.rs            inspects cwd for the welcome state        │
│  telemetry.rs         real CPU / mem / load / disk / network     │
│  config.rs            atomic writes to ~/.config/trmnl          │
└────────────────────────┬────────────────────────────────────────┘
                         │  events: pty://data, pty://exit
                         │  commands: pty_spawn, pty_write, …
┌────────────────────────▼────────────────────────────────────────┐
│  term/session.ts      one PTY ⇄ one stream of blocks            │
│    ├ osc133.ts        parses boundaries out of the byte stream   │
│    ├ renderers.ts     build / git / serve / err / list parsers   │
│    ├ completion.ts    delegates TAB to the real shell            │
│    └ altscreen.ts     detects programs that take over the screen │
│  state/store.ts       window state; panes and sessions           │
│  components/          the design, as described in the handoff    │
└─────────────────────────────────────────────────────────────────┘
```

The seam is deliberately narrow: Rust emits bytes and never interprets them;
the frontend interprets bytes and never touches the OS. Everything that could
be wrong about a terminal — boundary detection, ANSI handling, renderer parsing —
is therefore testable without a PTY, which is why the test suite can be fast and
still meaningful.

## Running it

```bash
npm install
npm run app
```

`npm run app:build` produces an unsigned `.app` and `.dmg` — fine locally, but
Gatekeeper blocks it on any other Mac. For a distributable build see
[Signing and notarization](#signing-and-notarization).

Requires the Rust toolchain. It was installed here with `--no-modify-path`, so
`$HOME/.cargo/bin` may need to be on `PATH`:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

## Tests

```bash
npm test && npm run test:rust
```

The suites cover the two places where being wrong is expensive:

- **`src/term/osc133.test.ts`** — the parser must yield identical block
  boundaries no matter how the PTY splits the stream. PTY chunks land
  mid-escape-sequence routinely, so it is tested byte-at-a-time and at uneven
  chunk sizes against a single-chunk baseline.
- **`src/term/renderers.test.ts`** — **parse, never fabricate.** Most of these
  assert `null`: a clean `git status`, a build with no route table, a wrong exit
  code and outright garbage must all fall back to plain text. A wrong table is
  much worse than no table.
- **`src-tauri/src/detect.rs`** — the welcome state must never suggest a command
  that would fail. Every suggestion traces to a file that was read.

## Architecture

### The block model

A block is one command execution — the command line, its output, exit code,
duration and timestamp, as a single addressable unit. See `src/term/types.ts`.

Boundaries come from **OSC 133 semantic prompt sequences**, not from guessing at
prompts. `src-tauri/src/shell_integration.rs` ships hooks for zsh, bash and fish
that emit them:

| Sequence | Meaning |
|---|---|
| `OSC 133 ; A` | prompt start |
| `OSC 133 ; B` | command start |
| `OSC 133 ; C` | output start |
| `OSC 133 ; D ; <n>` | command end, exit code `n` |
| `OSC 7 ; file://host/path` | cwd report |

The hooks load **without editing any of your dotfiles**: zsh gets a generated
`ZDOTDIR` whose `.zshrc` sources your real config first and our hooks last; bash
gets an equivalent `--rcfile` shim. If the hooks are absent — a remote host
without them installed — the session **degrades to a single continuous block**.
That is deliberate: a wrong boundary is worse than none.

### Structured output

Four renderers turn recognised output into UI (`src/term/renderers.ts`), each
one opt-out under Settings → Behavior:

| Renderer | Matches | Renders |
|---|---|---|
| `build` | `npm run build`, `next build` | Route table, over-budget first-loads in `--warn` |
| `git` | `git status` | File chips grouped by status |
| `serve` | `shopify app dev`, `npm run dev`, `vite` | Link card with OS-handled opens |
| `err` | exit 127 | Error panel + runnable did-you-mean |

The interface is `(command, output, exitCode) => Structured | null`, so adding a
test-runner or `kubectl` renderer touches nothing else. Structured rendering
resolves **only on completion** — blocks stream as text and then swap.

Did-you-mean is a real edit-distance match against `$PATH`, replacing the
prototype's 3-character prefix hack.

### Design tokens

`src/styles/tokens.css` is the whole colour system, and every value in it is a
literal. There is no accent to derive from: **GRID is functionally monochrome**,
and colour is a *signal* rather than decoration.

The load-bearing properties:

1. **One signal plane.** Every signal hue sits at L 0.83 / C 0.14 — red excepted
   at L 0.70 / C 0.19 so alarm reads hotter — so hue is the only variable and
   nothing shouts louder than anything else. Tint fills never exceed 0.16 and are
   the only translucency in the system.
2. **Hierarchy is line brightness, not thickness.** Four brightnesses
   (`--line-100` … `--line-400`) and one weight. To make a rule read, brighten
   it; do not thicken it.
3. **No elevation.** Depth is line brightness, then surface fill, then a scrim —
   in that order. There are no drop shadows; `--elev-dialog`, a hard 1px halo of
   void, is the single sanctioned exception.
4. **12px is the floor.** There is no literal `font-size` in the stylesheets at
   all, so it cannot be undercut one rule at a time — which is exactly how the
   old build's 8.5–10px chrome crept in.
5. **Two families, split by origin.** Rajdhani for anything a person wrote,
   Space Mono for anything a system emitted. Casing carries the same split:
   uppercase is the app talking about itself, lowercase is shell truth.

`src/styles/tokens.test.ts` asserts all of this against the stylesheets.

The token set is the **applied** one, not GRID's defaults — four rows differ and
they are the whole visual character of the build: a 2px panel border, a 4px frame
gap, round corners (8px outer, 4px inner) and a 14px panel heading. The round
corner is a deliberate override of GRID's own `DESIGN_GUIDE.md`, which calls a
rounded card a bug; the live theme setting overrides that on purpose.

**Traffic lights are native.** macOS draws and manages them via a transparent
titlebar. Reimplementing them would mean owning window drag, zoom, fullscreen,
snapping and Mission Control.

### The panel contract

Every panel-bearing surface exposes the same six toggles — `showPanel`,
`panelBorder`, `headerBorder`, `headerFilled`, `contentBorder`, `panelColor` —
as **real props**, not one `bordered` boolean. That is what lets the block stream
vary them independently, which is the core of the design:

| Block state | Colour | Header filled |
|---|---|---|
| Settled, exit 0 | unset → `--line-300` | no |
| Latest | unset → `--line-100` | **yes** |
| Non-zero exit | red | **yes** |
| Running / live | cyan | no |
| Raw scrollback dump | *no panel at all* | — |

Exit status is not a chip bolted onto a header; it *is* the panel's border and
header fill. See `blockPanel` in `src/term/types.ts`. `headerFilled` is reserved
for the block you are reading — the latest plus a failure is the intended maximum
in one viewport.

The **double frame** (outer line, a gap of void, inner line) is reserved for the
outermost container of a view. The window has one and a dialog has one; inside
either, single hairlines only, or the screen turns to corduroy.

### App icon

The source of truth is **`crggr-sh.icon/`**, an Icon Composer bundle of three
layers, top-first: the amber brackets and `.sh` (accent), `CRGGR` in ink
(mark), and an opaque `#060809` field. Nothing is drawn — the whole mark is the
bracket lockup from the wordmark set in the system's own two families, which is
what keeps it inside the rule forbidding a logotype, an emblem or an icon mark.

**Glass is off**, along with shadow and translucency. `elevation.css` opens by
saying nothing casts light onto anything else, and a specular sheen on the mark
would be the first thing anyone sees disagreeing with that. If it ever reads
dead beside Tahoe's own icons, the sanctioned fallback is `glass: true` on the
**accent layer only** — never on the wordmark.

The field is `#060809` rather than true black on purpose: it keeps a faint edge
against a black dock instead of reading as a hole.

Tauri cannot read `.icon` bundles, so the rasters under `src-tauri/icons/` are
generated from it. To regenerate after editing the bundle — layers are passed
**bottom-first**, the reverse of how `icon.json` lists them:

```bash
swift scripts/composite-icon.swift \
  crggr-sh.icon/Assets/layer-1-field-1024.png \
  crggr-sh.icon/Assets/layer-2-mark-1024.png \
  crggr-sh.icon/Assets/layer-3-accent-1024.png \
  src-tauri/icons/icon.png
npx tauri icon src-tauri/icons/icon.png && rm -rf src-tauri/icons/android src-tauri/icons/ios
```

The small-size treatments the icon spec calls for — dropping `.sh` at 64, and
brackets plus the block caret at 32/16 — are **not yet authored**. They are
different compositions rather than scaled versions of the 1024, so they need
drawing separately; until then macOS downsamples the full lockup.

### Installer

`src-tauri/dmg/dmg-background.png` (and its `@2x`) is the volume background,
wired up in `tauri.conf.json` under `bundle.macOS.dmg` along with the window
size and both icon positions. The drop zones in the artwork are corner notches
sitting just *outside* each 128px icon box, so they frame the icon rather than
being covered by it — which means the coordinates in the config and the artwork
have to agree:

| Item | Position | Size |
|---|---|---|
| `TRMNL.app` | 160, 196 | 128 |
| `Applications` alias | 480, 196 | 128 |

The app's zone is amber and the Applications zone is `--line-300`: one is the
thing you are moving, the other is where it goes.

**Nothing that expires belongs on this artwork.** It is a flat PNG, so any
claim written on it is one the build cannot check and nothing corrects — a
version in particular goes stale on the *next* release, silently, while the DMG
still mounts and installs perfectly. `scripts/check-dmg-background.sh` reads the
image back with Vision and fails the release if it finds a version that is not
the one being built; `release.sh` runs it before the build rather than after, so
a stale asset costs seconds instead of a full sign-and-notarize round trip.

### Config

`~/.config/trmnl/config.json`, written atomically (temp file + rename) because
settings save on every keystroke and there is no Save button. Stored as JSON
rather than the handoff's TOML: the frontend owns this blob's shape, and
round-tripping nested UI state through TOML buys nothing. The Settings footer
reflects whatever path the backend reports.

## Still named TRMNL

The rebuild is scoped to the WebView half. The repository, the bundle
identifier, `tauri.conf.json`'s `productName`, the DMG volume name, the `.icon`
asset names and the config directory (`~/.config/trmnl/`) all still say TRMNL,
and renaming them is a separate job with its own migration: a config directory
that moves without one silently loses every profile a user has.

The **UI** says CRGGR.sh throughout, per the wordmark rules — `CRGGR` in
Rajdhani 600 at `.28em`, caps, `--ink-100`; `.sh` in Space Mono 400, lowercase,
amber, at 0.75× the display size. Never set `.sh` in Rajdhani, never in caps,
never in ink: it is the one lowercase thing in the chrome, and that is the point.

## Deviations from the prototype worth knowing

The app is built against a design handoff — a written spec defining the visual
system, the token set, and which states are deliberately left undesigned. "The
handoff" below refers to that document. It is not in this repository, but the
decisions it drove are recorded here and in the comments, which is what matters
for changing the code.

The current handoff is the **GRID rebuild**; the deviations below span both it
and the TRON-derived design that preceded it, since most concern behaviour the
rebuild did not touch.

- **Auto-scroll sticks to bottom only when already at bottom**, with a
  `↓ JUMP TO LATEST` affordance. The prototype scrolled unconditionally, which
  fights the user the moment they scroll up.
- **History recall with `↑`/`↓`** is implemented; the prototype omitted it.
- **Palette ranking is real fuzzy subsequence matching** with word-boundary and
  frequency weighting, and path segments are individually matchable, so `gr/ops`
  finds `~/dev/grid-ops`.
- **Telemetry is real** (`sysinfo`), not the prototype's simulated jitter. The
  footer adds LOAD and DISK beyond the design's CPU/MEM, and every value sits in
  a fixed grid cell with tabular numerals so a changing number cannot reflow the
  row.
- **The newest block never folds.** The design folds any block past the
  threshold; folding the thing you just ran, while you are reading it, is
  hostile. It collapses once a newer block supersedes it.
- **Interactive programs get a terminal overlay.** Nothing in the design covers
  full-screen TUIs. Programs that take over the screen (`vim`, `htop`, Ink-based
  CLIs like the Shopify CLI) are detected and handed a real `xterm.js` grid
  floating above the pane, with the block history visible behind.
- **TAB completion delegates to the shell** rather than reimplementing `compsys`,
  so project-specific completers work.
- **`ls -l` renders as a table** — on the same `Table` component as the build
  route table, so a listing and a route table cannot drift apart into two
  hand-built grids.
- **Split copy actions** (`COPY OUT` / `COPY CMD`) instead of one button that
  grabs command and output together.
- **`⌘[` / `⌘]` step between blocks** — navigation the block model makes possible
  and the design does not mention.
- **Completion notifications** for commands that finish while the window is in
  the background, gated on a 10s threshold so fast commands stay silent.
- **Blocks carry a per-session ordinal** (`042`), zero-padded in the panel header
  and in search results. It makes the stream read as an addressable log and gives
  `⌘[`/`⌘]` and search hits a visible coordinate.
- **Remote sessions are structurally marked**, not just dot-coloured: a globe
  icon on the tab, a cyan dot, and the hostname in the pane header. Which machine
  you are typing into is the most consequential thing to be wrong about. **ssh
  disconnect is left undesigned**, so this establishes only the "this is
  elsewhere" vocabulary and deliberately invents no failure state.
- **A clean exit is not an error.** `PROCESS EXITED (CODE 0)` is neutral —
  `--line-200` on `--surface-2`. The old build painted a zero exit code in the
  error colour, which called a shell doing exactly what it was told a failure.
  Only a non-zero code takes the danger treatment.
- **The ghost suggestion is `--ink-300`, not `--ink-400`.** A Tab-acceptable
  suggestion is copy the user acts on, and `--ink-400` is disabled-state only.
- **The split divider is one 1px line**, not a 4px slab with a grip. Depth does
  the work instead: the focused pane sits on `--void` with an amber label, the
  unfocused one on `--surface-1` a step dimmer throughout. The hit area is
  widened by a transparent overlay so the line stays a line.
- **`src/harness/`** renders the real components against fixture data at
  `/harness.html` under `npm run dev`. The app itself cannot run in a plain
  browser — Tauri's IPC bridge is absent — and a type checker cannot see a badge
  that vanished into the header fill behind it. Not included in the build.

### The animation budget is zero

The system is **still**. No entrance animation, no easing with personality, no
bounce, no fade-in: a machine display either shows a state or it doesn't. There
is deliberately not one `@keyframes` in `src/`, and a test asserts it.

`--transition-state` transitions **only** `color`, `background-color` and
`border-color`, at 80ms linear, dropping to 0ms under
`prefers-reduced-motion: reduce`. Transitioning `transform`, `opacity`, `width`
or `box-shadow` is wrong by construction — the transition exists to soften a
colour change, not to move anything. Overlays appear at 0ms.

An earlier build spent four keyframes on a cold boot, an identity sweep, a
divider trace, plus a blinking caret and a pulsing status dot. All of them are
gone:

| Was | Now |
|---|---|
| Cold boot sequence | A static attach frame — what is on screen before first paint, not a sequence anyone waits through |
| Identity sweep | No identity to switch |
| Divider trace | The divider is one 1px line and simply exists |
| Caret blink | `Prompt` draws a static block caret |
| Status pulse | `Badge` draws a static dot |

The one blink left is xterm's own cursor, which is a real terminal cursor in a
real emulator. The stillness rule governs chrome.

## Not built — needs a design pass

The handoff lists eight undesigned states and says not to invent them. Five
remain open:

1. ssh disconnect / host unreachable
2. Unfocused-window chrome
3. Text selection semantics (block- vs stream-scoped)
4. Small-window behavior below ~800px
5. Empty/error states for structured renderers

Three have since been built, because leaving them out meant shipping controls
that lied about what they did:

- **Scrollback search** (`⌘⇧F`) — the chord was in the keymap and the
  Keybindings pane with no UI behind it. Built minimally from existing vocabulary
  rather than inventing a new surface.
- **Session close** — sessions could be created but never closed, so the rail
  grew unbounded and each row held a live PTY. That was a resource leak, not just
  a missing affordance. `✕` on row hover, plus `⌘W` when solo.
- **Session restore** — "Restore sessions on launch" persisted to disk and was
  read by nothing. Now restores split geometry, per-pane cwd and history.
  Scrollback is deliberately *not* persisted: 10k lines per session would make
  the config file unusable as the dotfile it is meant to be.

The **keybinding editor** is still unbuilt, and its `EDIT` affordance is
deliberately inert and labelled as such — a visible control that does nothing
when clicked is worse than one that says it isn't ready.

## Signing and notarization

`npm run app:release` builds, signs, notarizes, and staples both artifacts, then
verifies them.

Nothing about signing is baked into this repo — the certificate and Apple ID
belong to whoever is building. If you only want to run TRMNL, none of this
applies: `npm run app` and `npm run app:build` need no identity at all. Signing
matters only for a build you intend to hand to someone else.

**Your signing identity.** Find yours with `security find-identity -v -p
codesigning`, then either export it or drop it in `.env.local` at the repo root,
which is gitignored:

```bash
APPLE_SIGNING_IDENTITY=Developer ID Application: Your Name (TEAMID1234)
```

**Notarization credentials** come from a `notarytool` keychain profile, created
once:

```bash
xcrun notarytool store-credentials TRMNL-notary \
  --apple-id "you@example.com" --team-id "TEAMID1234"
```

```bash
NOTARY_PROFILE=TRMNL-notary npm run app:release
```

`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` work too, where `APPLE_PASSWORD`
is an app-specific password from appleid.apple.com — a normal Apple ID password
is rejected.

Two things worth knowing:

- **Tauri does not notarize the `.dmg`.** It notarizes and staples the `.app`,
  then builds the disk image afterward, so the `.dmg` ships un-notarized and is
  rejected on download. `release.sh` exists to submit and staple it separately.
- **Hardened runtime is required for notarization**, and `entitlements.plist`
  carries the exceptions a terminal needs — JIT for the WebView, plus
  `disable-library-validation` and `allow-dyld-environment-variables`, because
  profile env vars let a user inject `DYLD_*` into spawned shells. Removing
  those breaks shell spawning only in signed builds, never in `tauri dev`.

- **Bundling the `.dmg` needs Automation permission.** `bundle_dmg.sh` runs
  `osascript` to have Finder lay out the mounted volume, and Tauri swallows its
  output — so a denied permission appears only as `failed to bundle project:
  error running bundle_dmg.sh`, with nothing pointing at Finder. Check with
  `osascript -e 'tell application "Finder" to get name of startup disk'` and
  grant it under System Settings → Privacy & Security → Automation. The step is
  purely cosmetic; `--skip-jenkins` produces a plain but working image where the
  permission cannot be granted, such as CI.

Verify a build with:

```bash
spctl -a -vvv -t install src-tauri/target/release/bundle/macos/TRMNL.app
```

`accepted` with `source=Notarized Developer ID` is the goal;
`source=Unnotarized Developer ID` means signing worked but notarization didn't.

## Security note

Profile environment variables are stored in plaintext. The Profiles pane warns
when a key looks like a credential, but **Keychain routing is not implemented**.
The handoff flags this for security review before shipping; treat it as open.

## Updating

There is no auto-update. New versions are published to
[Releases](https://github.com/MatthewRCrigger/TRMNL/releases) and installed by
hand. What an updater would involve is specced in
[docs/updater-spec.md](docs/updater-spec.md); it is not built.

## Contributing

Bug reports and feature ideas are welcome as
[issues](https://github.com/MatthewRCrigger/TRMNL/issues). Include the version
from the welcome screen, your shell, and what you ran.

Pull requests are **not being accepted yet** — this is a solo project moving
fast, and unreviewed PRs would sit. That will change once the interfaces settle.
If you want to build on it, the licence permits forking.

Working on the code with an AI agent: read [AGENTS.md](AGENTS.md) first. It is
the short list of things that have already cost someone an afternoon.
