#!/usr/bin/env bash
#
# Build, sign, and notarize a distributable CRGGR.sh release.
#
# Tauri notarizes and staples the .app, then builds the .dmg afterward — so the
# disk image itself ships un-notarized and Gatekeeper rejects it on download.
# This script runs the build, then notarizes and staples the .dmg separately.
#
# Signing and notarization credentials are yours, not the project's — nothing is
# hardcoded here. See scripts/signing-env.sh for how the identity is resolved,
# and the README's "Signing and notarization" section for the whole setup.
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

# Resolves APPLE_SIGNING_IDENTITY from the environment or .env.local, verifies
# it is in the keychain, and exits with instructions if it is neither.
source "$(dirname "$0")/signing-env.sh"

# The usual profile, so `npm run app:release` works with no environment at all.
# Deliberately a keychain profile rather than a dotenv file: the credential is an
# app-specific password, and the keychain keeps it encrypted where a .env would
# leave it in plaintext next to the source.
: "${NOTARY_PROFILE:=TRMNL-notary}"  # keychain profile name, not the product

# Resolve notarization credentials up front — failing here beats failing after a
# full Rust release build.
notary_auth=()
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  notary_auth=(--keychain-profile "$NOTARY_PROFILE")
  # A profile name that is merely set is not a profile that exists. Checking only
  # that the variable is non-empty let a typo — or a profile never created on
  # this machine — pass this gate and fail forty seconds later, after a full
  # release build. `notarytool history` is the cheapest call that resolves the
  # keychain item and actually reaches Apple with it.
  if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    echo "error: notary profile '$NOTARY_PROFILE' is unusable — not in the keychain," >&2
    echo "       or its stored credentials are no longer valid. Create it with:" >&2
    echo "         xcrun notarytool store-credentials $NOTARY_PROFILE \\" >&2
    echo "           --apple-id \"<your-apple-id>\" --team-id \"<your-team-id>\"" >&2
    exit 1
  fi
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  notary_auth=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  echo "error: set NOTARY_PROFILE, or all of APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID" >&2
  exit 1
fi

# The installer background is a flat PNG, so anything written on it is a claim
# the build cannot verify. Checked before the long build rather than after, so a
# stale version costs seconds instead of a full sign-and-notarize round trip.
./scripts/check-dmg-background.sh

echo "==> Building and signing"
# Tauri will warn here that it is "skipping app notarization, no APPLE_ID &
# APPLE_PASSWORD ... found". That is expected and wanted. Notarizing the .app
# would be a second round trip to Apple for an artifact that ships inside the
# .dmg and does not need a ticket of its own — Gatekeeper clears it through the
# disk image's. The credentials are withheld from Tauri on purpose; this script
# notarizes the thing that actually ships, below.
npm run tauri build

# Derived rather than hardcoded — see the same note in install-local.sh.
product="$(node -p "require('./src-tauri/tauri.conf.json').productName")"

app="src-tauri/target/release/bundle/macos/$product.app"
dmg=$(ls -t "src-tauri/target/release/bundle/dmg/$product"_*.dmg 2>/dev/null | head -1)

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

# What each artifact has to prove differs, and demanding the same of both is
# wrong in a way that reads as a broken release.
#
# The .dmg is what ships, so it carries the notarization ticket and must both
# pass Gatekeeper and validate as stapled. The .app inside it has no ticket of
# its own — Tauri only staples the .app when it notarized that .app itself,
# which is not this path — and it does not need one: Gatekeeper accepts it
# through the disk image's ticket, and that is exactly what a user's copy looks
# like after dragging it out. Requiring `stapler validate` on the .app failed
# every release while printing `accepted` directly underneath.
#
# The type flag differs too: `-t install` is for installers and disk images,
# `-t exec` for an application bundle.
check() { # <label> <spctl-type> <path> [require-staple]
  local label=$1 type=$2 target=$3 staple=${4:-no} ok=1
  spctl -a -t "$type" "$target" >/dev/null 2>&1 || ok=0
  if [[ "$staple" == staple ]]; then
    xcrun stapler validate "$target" >/dev/null 2>&1 || ok=0
  fi
  if (( ok )); then
    echo "  ok       $label"
  else
    echo "  FAILED   $label"
    spctl -a -vvv -t "$type" "$target" 2>&1 | sed 's/^/           /'
    [[ "$staple" == staple ]] &&
      xcrun stapler validate "$target" 2>&1 | tail -1 | sed 's/^/           /'
    failed=1
  fi
}

check "$app" exec    "$app"
check "$dmg" install "$dmg" staple

if (( failed )); then
  echo "==> Release NOT distributable — see failures above" >&2
  exit 1
fi

echo "==> Notarized and stapled:"
echo "    $app"
echo "    $dmg"
