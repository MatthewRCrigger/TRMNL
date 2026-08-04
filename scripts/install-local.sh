#!/usr/bin/env bash
#
# Install the release build into /Applications, for this machine.
#
# The distribution flow (scripts/release.sh) already produces exactly the app
# you want locally, so this deliberately does not build anything by default —
# it copies what is there. Pass --build to run a signed release build first.
#
#   ./scripts/install-local.sh            # install whatever is built
#   ./scripts/install-local.sh --build    # build, then install
#
# Notarization is not required to run an app you built yourself: a locally
# produced bundle carries no quarantine attribute, so Gatekeeper never
# challenges it. This is why the local path can skip the round trip to Apple
# that release.sh pays for.

set -euo pipefail

cd "$(dirname "$0")/.."

app="src-tauri/target/release/bundle/macos/TRMNL.app"
dest="/Applications/TRMNL.app"

if [[ "${1:-}" == "--build" ]]; then
  : "${APPLE_SIGNING_IDENTITY:=Developer ID Application: Matthew Crigger (QY69D89784)}"
  export APPLE_SIGNING_IDENTITY
  echo "==> Building"
  npm run tauri build
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--build]" >&2
  exit 1
fi

if [[ ! -d "$app" ]]; then
  echo "error: no build at $app — run with --build, or npm run app:release" >&2
  exit 1
fi

# Replacing a bundle out from under a running process leaves the copy half
# written and the running app pointing at files that no longer exist. Refuse
# rather than corrupt it; the version being replaced is usually the one the user
# is looking at.
if pgrep -f "^/Applications/TRMNL.app/Contents/MacOS/TRMNL$" >/dev/null 2>&1; then
  echo "error: TRMNL is running from /Applications — quit it first (⌘Q)" >&2
  exit 1
fi

from=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$app/Contents/Info.plist")
to="(none)"
if [[ -d "$dest" ]]; then
  to=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
    "$dest/Contents/Info.plist" 2>/dev/null || echo "unknown")
fi

echo "==> Installing $from over $to"

# ditto rather than cp: it preserves the bundle's extended attributes and
# resource forks, which a plain recursive copy can drop and which the code
# signature is computed over. Remove the old bundle first so files deleted
# between versions do not survive as strays inside the new one.
rm -rf "$dest"
ditto "$app" "$dest"

# A copied bundle should still satisfy its signature. If this fails the install
# is not trustworthy, so say so rather than leaving a broken app in place.
if ! codesign --verify --deep --strict "$dest" 2>/dev/null; then
  echo "error: signature does not verify after copy — $dest is suspect" >&2
  exit 1
fi

echo "==> Installed $dest ($from)"
