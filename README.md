# TRMNL

A TRON-inspired terminal for macOS. Built from the `design_handoff_grid_terminal`
bundle; ship target is that document's **turn 3 / option 3a**.

This is a real terminal — real PTYs, real shells, real ANSI — not a themed
viewer. The block model sits above the emulator rather than replacing it.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | Per the handoff's recommendation: small footprint, no Chromium dependency. |
| UI | React 19 + Zustand | One window = one store; panes are children. |
| PTY | `portable-pty` (Rust) | Spawns real shells; one reader thread per session. |
| Block boundaries | **OSC 133** shell integration | The only reliable approach — see below. |

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
- **Telemetry is real** (`sysinfo`), not the prototype's simulated jitter.

## Not built — needs a design pass

The handoff lists these as undesigned, and says not to invent them:

1. ssh disconnect / host unreachable
2. Scrollback search (`⌘⇧F` is in the keymap with no UI)
3. Session close and reorder
4. Unfocused-window chrome
5. Text selection semantics (block- vs stream-scoped)
6. Small-window behavior below ~800px
7. Keybinding editor — the `EDIT` affordance is deliberately inert rather than a
   dead control; it needs chord capture and conflict detection
8. Empty/error states for structured renderers

## Security note

Profile environment variables are stored in plaintext. The Profiles pane warns
when a key looks like a credential, but **Keychain routing is not implemented**.
The handoff flags this for security review before shipping; treat it as open.
