---
name: release
description: Ship a TRMNL release — verify, branch, bump version, PR to main, build/notarize, then pause for confirmation before publishing the GitHub Release. Use when the user says "let's release", "cut a release", "ship this", "bump and release", or similar.
---

# TRMNL release

Runs the whole release up to and including notarization, then **stops and
asks the user to confirm** before doing anything outward-facing (pushing a
tag, publishing a GitHub Release). Notarization itself is a private Apple API
call, not a publish — it's safe to run without asking.

If the working tree is clean and already on `main` with nothing to ship (no
diff against the last tag), say so and stop — don't manufacture a release.

## 1. Verify

```bash
npm run typecheck
npm test
npm run test:rust
```

All three must pass. Report failures plainly and stop; don't patch around a
red check inside a release flow.

## 2. Branch and commit

Never commit release changes straight to `main`. If not already on a feature
branch:

```bash
git checkout -b <descriptive-branch-name>
```

Commit the feature/fix work first (if not already committed), with a normal
descriptive message.

## 3. Bump the version — all four places

Pick the next version (patch for fixes, minor for features — ask the user if
ambiguous). Bump in **all four**:

- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`
- `src-tauri/Cargo.toml` → `version = "..."` under `[package]`
- `src-tauri/Cargo.lock` — do NOT hand-edit; regenerate with:
  ```bash
  cargo update -p trmnl --manifest-path src-tauri/Cargo.toml --precise <new-version>
  ```

Re-run `npm run typecheck` and `npm run test:rust` after the bump (cheap
sanity check that nothing references the old version string in a way that
matters). Commit as `Bump to <version>`.

## 4. PR into main

```bash
git push -u origin <branch>
```

Open a PR (`mcp__github__create_pull_request`, base `main`) summarizing the
change and the verification that passed. This is outward-facing (visible to
collaborators) — proceed without asking, since opening a PR is not merging
one.

**Merging the PR is outward-facing and changes `main` — ask before merging**,
unless the user already said to merge without asking in this conversation.
After merge: `git checkout main && git pull && git branch -d <branch>` and
delete the remote branch.

## 5. Build, sign, notarize

```bash
npm run app:release
```

This is `scripts/release.sh`: builds, code-signs with
`APPLE_SIGNING_IDENTITY` (resolved by `scripts/signing-env.sh`), notarizes the
`.dmg` via the `TRMNL-notary` keychain profile (or `NOTARY_PROFILE`/`APPLE_ID`
+`APPLE_PASSWORD`+`APPLE_TEAM_ID` env vars), staples the ticket, and verifies
both the `.app` (`spctl -t exec`) and `.dmg` (`spctl -t install` +
`stapler validate`).

If it fails because the notary profile is missing or invalid, the script's own
error message says exactly how to create it
(`xcrun notarytool store-credentials TRMNL-notary --apple-id ... --team-id ...`)
— relay that to the user and stop; don't try to work around it.

If it fails because `bundle_dmg.sh` errors with no useful output, that's
almost always missing Finder Automation permission in the terminal actually
running the build. Check with:

```bash
osascript -e 'tell application "Finder" to get name of startup disk'
```

If that prompts or fails, tell the user to grant Automation permission under
System Settings → Privacy & Security → Automation, then retry.

Confirm the two verification lines both read `ok`:

```
  ok       src-tauri/target/release/bundle/macos/TRMNL.app
  ok       src-tauri/target/release/bundle/dmg/TRMNL_<version>_aarch64.dmg
```

**Stop here and tell the user the build is signed and notarized, ready to
publish.** Do not tag, push, or create the GitHub Release yet — that's the
confirmation gate the user asked for. Say what you're about to do next
(tag `v<version>`, publish a public GitHub Release with the DMG attached) so
the ask is concrete, not just "continue?".

## 6. On confirmation: tag and publish

Once the user confirms, finish the release:

```bash
git tag v<version>
git push origin v<version>
```

Write release notes in the style of prior releases (check
`gh release view <latest-tag>` for the format — a "What's in this release"
bullet list pitched at a user, not a commit log, plus the standard "macOS
arm64 only" / "signed and notarized" notes line). Then:

```bash
gh release create v<version> \
  "src-tauri/target/release/bundle/dmg/TRMNL_<version>_aarch64.dmg" \
  --repo MatthewRCrigger/TRMNL \
  --title "<version>" \
  --notes "<notes>"
```

This publishes a public release — it's the one step in this whole flow that
must not run before the explicit confirmation in step 5, even if everything
upstream of it was unattended.

Distribution is GitHub Releases only. Do not suggest Shopify Files, S3, or any
other host — that was retired.

## Notes

- Builds are arm64-only by decision — never offer a universal build or
  `x86_64-apple-darwin` as a fix for anything in this flow.
- `npm run app:build` (without `:release`) produces an ad-hoc-signed DMG that
  Gatekeeper rejects outright. Never attach that build to a release.
- See `CLAUDE.md`'s "Releases" section for the fuller why behind each of
  these steps.
