#!/usr/bin/env bash
#
# Guard the installer background against drifting out of step with the build.
#
# The background is a flat PNG, so anything written on it is a claim the build
# cannot verify and nothing corrects. Two ways that goes wrong, neither of which
# fails loudly — the DMG still mounts, still installs, and still looks fine:
#
#   1. A baked-in version goes stale on the *next* release.
#   2. Text under a drop zone lands in the band where Finder draws its own
#      label, and the two smear over each other.
#
# Both are checked by reading the artwork back with the OS's own OCR (Vision,
# via the Swift shim beside this script). Every check runs before anything
# exits, so one re-export can fix all of the problems rather than uncovering
# them one release at a time.
#
# Run from `release.sh` before bundling, and by hand after re-exporting the
# background.

set -euo pipefail

cd "$(dirname "$0")/.."

BACKGROUND="src-tauri/dmg/dmg-background.png"
BACKGROUND_2X="src-tauri/dmg/dmg-background@2x.png"
VERSION="$(node -p "require('./package.json').version")"

failed=0

fail() {
  printf '\ncheck-dmg-background: %s\n' "$1" >&2
  failed=1
}

for f in "$BACKGROUND" "$BACKGROUND_2X"; do
  if [[ ! -f "$f" ]]; then
    echo "check-dmg-background: $f is missing" >&2
    exit 1
  fi
done

# The geometry has to match `bundle.macOS.dmg` in tauri.conf.json, because the
# artwork's corner notches frame the icon boxes — a background at the wrong size
# puts the notches somewhere the icons are not.
check_size() {
  local file="$1" want_w="$2" want_h="$3" w h
  w="$(sips -g pixelWidth "$file" | awk '/pixelWidth/{print $2}')"
  h="$(sips -g pixelHeight "$file" | awk '/pixelHeight/{print $2}')"
  if [[ "$w" != "$want_w" || "$h" != "$want_h" ]]; then
    fail "$file is ${w}x${h}, expected ${want_w}x${want_h}"
  fi
}

check_size "$BACKGROUND" 640 400
check_size "$BACKGROUND_2X" 1280 800

# Vision is only on macOS, and the DMG is a macOS artifact — but a contributor
# running the checks on another platform should get a skip, not a failure.
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "check-dmg-background: text checks skipped (not macOS)"
  exit "$failed"
fi

TEXT="$(swift "$(dirname "$0")/read-image-text.swift" "$BACKGROUND" 2>/dev/null || true)"

if [[ -z "$TEXT" ]]; then
  # OCR is best-effort: a Vision failure must not block a release, and artwork
  # carrying no text at all is the low-maintenance ideal rather than a problem.
  echo "check-dmg-background: no text recognised; skipping the text checks"
  exit "$failed"
fi

# --- 1. a version that will expire ------------------------------------------
STAMPED="$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<<"$TEXT" | sort -u || true)"

if [[ -z "$STAMPED" ]]; then
  echo "check-dmg-background: no version in the artwork — nothing to go stale"
else
  while read -r found; do
    [[ -z "$found" ]] && continue
    if [[ "$found" != "$VERSION" ]]; then
      fail "$(cat <<EOF
the artwork says $found, this build is $VERSION.

  $BACKGROUND

Either re-export for $VERSION, or — better — drop the version from the artwork.
It is the only line on it that expires, and the row already carries ARM64, which
is true for every build.
EOF
)"
    else
      echo "check-dmg-background: artwork version $found matches the build"
    fi
  done <<<"$STAMPED"
fi

# --- 2. a label Finder will draw over ---------------------------------------
# Icons are 128px centred at y 196, so their boxes end at y 260 and Finder's own
# label occupies roughly y 260-290 at text size 16. The artwork cannot move it.
if grep -qiE '(^|[^a-z])(crggr[ .]?sh|applications)([^a-z]|$)' <<<"$TEXT"; then
  fail "$(cat <<'EOF'
the artwork appears to label the drop zones.

Finder writes the real filename under each icon, around y 260-290 for a 128px
icon centred at y 196, and a label in that band ends up smeared under it.
Either move the artwork labels below y 300, or drop them — Finder already names
both, so they duplicate it.
EOF
)"
else
  echo "check-dmg-background: no drop-zone labels in Finder's own band"
fi

exit "$failed"
