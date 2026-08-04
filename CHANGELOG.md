# Changelog

All notable changes to TRMNL are recorded here. Dates are when a version was
released, not when a change merged.

## [Unreleased]

### Added

- **Test-runner structured renderer.** `npm test`, `vitest`, `jest` and
  `cargo test` output is now parsed into a pass/fail/skipped summary with
  failed test names as chips, instead of falling back to plain scrollback
  text. Toggle under Settings → Behavior → Output Renderers. Follows the
  existing renderer contract: ambiguous output always falls back to text.
- **Copy block as markdown.** A fourth block action, `COPY MD`, alongside
  `COPY OUT` / `COPY CMD` / `RERUN`. Fences the command, its output, and exit
  status/duration as a single snippet for pasting into a PR description,
  issue, or chat message.
- **Pane focus mode.** `⌘⇧M` temporarily maximizes the focused pane to fill
  the window when split, and restores the prior split geometry on a second
  press. The hidden pane's session keeps running in the background.
- **Keybinding editor.** The `EDIT` control in Settings → Keybindings now
  works: click it, press a chord, and it's captured, checked for collisions
  against every other binding, and saved immediately. A collision prompts an
  explicit REPLACE rather than silently overwriting, and swaps the two
  actions' chords so neither is left unbound. Covers the ten actions handled
  by the app's global keydown handler; `⌘,`/`⌘T`/`⌘W` (native macOS menu
  items) and `⇥` (tied to completion) remain fixed, and `⌃C` remains
  permanent.

## [0.4.2]

- Refuse a plaintext notarization password, and name unknown config keys.
- Let the builder supply their own signing identity via `.env.local` or the
  environment, rather than a hardcoded default.

## [0.4.1]

- Make profiles global in fact, not just in intent — a profile added in one
  window is now reachable from every other.
- Rust owns sessions, so a window is just a view onto them; multiple windows
  can now share session state correctly.
- Add a one-step install into `/Applications` (`npm run app:install`).
