#!/usr/bin/env bash
#
# Resolve the code-signing identity for a release build. Sourced by release.sh
# and install-local.sh so both fail the same way with the same instructions.
#
# Nothing here is hardcoded on purpose. This repo is public, and a signing
# identity belongs to whoever is building rather than to the project — a
# hardcoded default is not a leak (a Team ID is readable out of any signed
# artifact with `codesign -dvvv`) but it does make a stranger's first build fail
# with someone else's name in the error, which reads as a broken repo.
#
# Order of resolution:
#   1. APPLE_SIGNING_IDENTITY already in the environment
#   2. .env.local at the repo root, if present — gitignored
#   3. error, with the command that lists the caller's own identities
#
# Expects to be sourced with the repo root as the working directory.

# Parsed line by line rather than `source`d. Every signing identity contains
# parentheses — "Developer ID Application: Your Name (TEAMID1234)" — and sourcing
# treats those as shell syntax, so an unquoted value is a syntax error rather
# than a value. Reading the text also means a dotfile cannot execute anything.
if [[ -f .env.local ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    key=${line%%=*}
    value=${line#*=}
    [[ "$key" == "$line" ]] && continue          # no '=' at all
    key=$(printf '%s' "$key" | tr -d '[:space:]')
    key=${key#export}
    # Tolerate quotes rather than require them; the value is the rest of the
    # line either way, so an identity needs no escaping.
    [[ "$value" == \"*\" || "$value" == \'*\' ]] && value=${value:1:${#value}-2}
    # The environment wins — an explicit export should override the dotfile.
    [[ -n "${!key:-}" ]] && continue
    case "$key" in
      APPLE_SIGNING_IDENTITY|NOTARY_PROFILE|APPLE_ID|APPLE_PASSWORD|APPLE_TEAM_ID)
        export "$key=$value" ;;
    esac
  done < .env.local
fi

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  cat >&2 <<'EOF'
error: APPLE_SIGNING_IDENTITY is not set.

Signing needs an Apple Developer ID certificate in your keychain. List the ones
you have with:

  security find-identity -v -p codesigning

Then either export the identity:

  export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)"

...or write it to .env.local at the repo root, which is gitignored:

  APPLE_SIGNING_IDENTITY=Developer ID Application: Your Name (TEAMID1234)

Signing is only needed for distributable builds. `npm run app` (tauri dev) and
`npm run app:build` need none of this.
EOF
  exit 1
fi

export APPLE_SIGNING_IDENTITY

if ! security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY"; then
  echo "error: signing identity not in keychain: $APPLE_SIGNING_IDENTITY" >&2
  echo "       list available identities with: security find-identity -v -p codesigning" >&2
  exit 1
fi
