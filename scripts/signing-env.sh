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
      APPLE_SIGNING_IDENTITY|NOTARY_PROFILE|APPLE_ID|APPLE_TEAM_ID)
        export "$key=$value" ;;
      APPLE_PASSWORD)
        # Deliberately not honoured from a dotfile. This is an app-specific
        # password that can act on an Apple account, and reading it here would
        # move it from encrypted keychain storage into plaintext beside the
        # source of a public repo — the one value in this file where a
        # .gitignore mistake actually costs something. NOTARY_PROFILE already
        # holds it encrypted, and release.sh prefers the profile, so a password
        # here would sit in plaintext and never even be read.
        echo "warning: ignoring APPLE_PASSWORD in .env.local — keep it in the" >&2
        echo "         keychain instead: xcrun notarytool store-credentials" >&2
        echo "         (export it in your shell if you truly need the env path)" >&2 ;;
      *)
        # A silently-ignored key is how a typo costs an afternoon: the value
        # looks set, and the failure arrives later as "not set".
        echo "warning: .env.local: unrecognized key '$key' (ignored)" >&2 ;;
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
