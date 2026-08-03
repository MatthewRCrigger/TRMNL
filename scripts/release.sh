#!/usr/bin/env bash
#
# Build, sign, and notarize a distributable TRMNL release.
#
# Tauri notarizes and staples the .app, then builds the .dmg afterward — so the
# disk image itself ships un-notarized and Gatekeeper rejects it on download.
# This script runs the build, then notarizes and staples the .dmg separately.
#
# Credentials come from the environment or a notarytool keychain profile:
#
#   NOTARY_PROFILE=TRMNL-notary ./scripts/release.sh
#
#   ...or:
#   APPLE_ID=you@example.com APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx \
#     APPLE_TEAM_ID=TEAMID1234 ./scripts/release.sh
#
# Create a keychain profile once with:
#   xcrun notarytool store-credentials TRMNL-notary \
#     --apple-id "you@example.com" --team-id "TEAMID1234"

set -euo pipefail

cd "$(dirname "$0")/.."

: "${APPLE_SIGNING_IDENTITY:=Developer ID Application: Your Name (TEAMID1234)}"
export APPLE_SIGNING_IDENTITY

# Resolve notarization credentials up front — failing here beats failing after a
# full Rust release build.
notary_auth=()
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  notary_auth=(--keychain-profile "$NOTARY_PROFILE")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  notary_auth=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  echo "error: set NOTARY_PROFILE, or all of APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID" >&2
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY"; then
  echo "error: signing identity not in keychain: $APPLE_SIGNING_IDENTITY" >&2
  exit 1
fi

echo "==> Building and signing"
npm run tauri build

app="src-tauri/target/release/bundle/macos/TRMNL.app"
dmg=$(ls -t src-tauri/target/release/bundle/dmg/TRMNL_*.dmg 2>/dev/null | head -1)

if [[ ! -d "$app" ]]; then
  echo "error: no .app produced at $app" >&2
  exit 1
fi
if [[ -z "$dmg" ]]; then
  echo "error: no .dmg produced under src-tauri/target/release/bundle/dmg/" >&2
  exit 1
fi

# Tauri already notarized the .app when APPLE_* env vars were set, but it never
# touches the .dmg.
echo "==> Notarizing $(basename "$dmg")"
xcrun notarytool submit "$dmg" "${notary_auth[@]}" --wait
xcrun stapler staple "$dmg"

echo "==> Verifying"
failed=0
for target in "$app" "$dmg"; do
  if spctl -a -t install "$target" >/dev/null 2>&1 && \
     xcrun stapler validate "$target" >/dev/null 2>&1; then
    echo "  ok       $target"
  else
    echo "  FAILED   $target"
    spctl -a -vvv -t install "$target" 2>&1 | sed 's/^/           /'
    failed=1
  fi
done

if (( failed )); then
  echo "==> Release NOT distributable — see failures above" >&2
  exit 1
fi

echo "==> Notarized and stapled:"
echo "    $app"
echo "    $dmg"
