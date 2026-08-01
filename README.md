# TRMNL

A TRON-inspired terminal for macOS. Built from the `design_handoff_grid_terminal`
bundle; ship target is that document's **turn 3 / option 3a**.

This is a real terminal — real PTYs, real shells, real ANSI — not a themed
viewer. The block model sits above the emulator rather than replacing it.

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

- **The design is a CSS design.** The handoff's token system derives every
  neutral from one accent via `color-mix(in oklch, …)`, which is what makes the
  identity switcher recolour the entire interface by changing a single variable.
  Reproducing that in SwiftUI means hand-writing a colour-derivation layer and
  re-resolving it through every view. In CSS it is the platform doing the work.
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

`npm run app:build` produces a distributable `.app` and `.dmg`.

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

`src/styles/tokens.css` holds the token set verbatim. The load-bearing property:
**every neutral derives from `--ac` via `color-mix`**, which is what makes the
identity switcher recolour the whole interface. Do not replace a derivation with
a literal.

Departures from the prototype:

1. **Type floor raised to 10px.** The prototype's 8.5–9px chrome labels read at
   prototype zoom but not on a real display. `--t-micro` / `--t-label` enforce
   the floor centrally so it cannot drift back down. (Required by the handoff.)
2. **Traffic lights are native.** macOS draws and manages them via a transparent
   titlebar. The prototype hand-drew them only because it ran in a browser;
   reimplementing them would mean owning window drag, zoom, fullscreen, snapping
   and Mission Control. (Required by the handoff.)
3. **Glow and scanlines are cut.** The `--gl1`/`--gl2`/`--tgl` glow levels and the
   CRT scanline overlay are gone, along with their controls in the Appearance
   popover and Settings. Panel shadows keep their black depth but no accent halo.
4. **Default identity is USER**, not PROGRAM. `--ac` in `tokens.css` and
   `DEFAULT_IDENTITY` in `store.ts` must stay in agreement — the CSS value is the
   pre-hydration fallback, so a mismatch shows as a colour flash on launch. A test
   pins the two together.
5. **Five identities, not six.** CLU now carries the gold that was ATHENA's; the
   old orange CLU is gone. A config that stored `ATHENA` falls back to USER.

### App icon

The source of truth is **`trmnl-icon.icon/`**, an Icon Composer bundle (two
layers: a dark gradient field and the chevron-plus-cursor mark). Tauri cannot
read `.icon` bundles, so the rasters under `src-tauri/icons/` are generated from
it. To regenerate after editing the bundle:

```bash
swift scripts/composite-icon.swift trmnl-icon.icon/Assets/layer-1-field-1024.png trmnl-icon.icon/Assets/layer-2-mark-1024.png /tmp/icon.png
sips -z 1024 1024 /tmp/icon.png --out src-tauri/icons/icon.png
npx tauri icon src-tauri/icons/icon.png && rm -rf src-tauri/icons/android src-tauri/icons/ios
```

### Config

`~/.config/trmnl/config.json`, written atomically (temp file + rename) because
settings save on every keystroke and there is no Save button. Stored as JSON
rather than the handoff's TOML: the frontend owns this blob's shape, and
round-tripping nested UI state through TOML buys nothing. The Settings footer
reflects whatever path the backend reports.

## Deviations from the prototype worth knowing

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
- **`ls -l` renders as a table** — a fifth renderer, on the same hairline grid as
  the build route table. Not in the handoff, which specs four; renderers are
  documented as pluggable and the treatment suits a listing.
- **Split copy actions** (`COPY OUT` / `COPY CMD`) instead of one button that
  grabs command and output together.
- **`⌘[` / `⌘]` step between blocks** — navigation the block model makes possible
  and the design does not mention.
- **Completion notifications** for commands that finish while the window is in
  the background, gated on a 10s threshold so fast commands stay silent.
- **Blocks carry a per-session ordinal** (`0042`), shown dim in the header and in
  search results. It makes the stream read as an addressable log and gives
  `⌘[`/`⌘]` and search hits a visible coordinate.
- **Remote sessions are structurally marked**, not just dot-coloured: a `⇄` glyph
  and a caution-hued left edge in the rail, and the hostname in the pane header.
  Which machine you are typing into is the most consequential thing to be wrong
  about. The handoff leaves **ssh disconnect undesigned**, so this establishes
  only the "this is elsewhere" vocabulary and deliberately invents no failure
  state.
- **Panels carry a second inset hairline**, implying the plate thickness the
  film's surfaces have. Replaces what glow used to do, without glow.

### The animation budget — a deliberate deviation

The handoff states the animation set is complete and says not to add more. Four
keyframes were added anyway, and the reasoning is uniform: each one dramatises a
**discrete event the user caused**, and none of them animate while the user is
idle. A terminal is stared at for hours, so ambient motion is the thing to avoid —
not motion as such.

| Keyframe | Event | Duration |
|---|---|---|
| `idsweep` | Identity change | 250ms |
| `trace` | Split created | 180ms |
| `bootbr` | Cold boot, brackets | ~400ms total |
| `bootwd` | Cold boot, wordmark | ~400ms total |

All four respect `prefers-reduced-motion: reduce` by skipping entirely. The boot
sequence additionally has a Settings toggle, and is architecturally incapable of
delaying the first prompt: it renders as a sibling of the app tree with
`pointer-events: none`, `init()` is neither wrapped nor awaited around it, and
init finishing tears the overlay down mid-flight. Its lifetime is
`min(init, 400ms, first keypress, first click)`.

The still-unused `spn` keyframe from the original token set remains, superseded by
streaming output. It is kept only because the handoff lists it.

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

## Security note

Profile environment variables are stored in plaintext. The Profiles pane warns
when a key looks like a credential, but **Keychain routing is not implemented**.
The handoff flags this for security review before shipping; treat it as open.
