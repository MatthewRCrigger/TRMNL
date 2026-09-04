//! OSC 133 shell integration.
//!
//! The block model depends on knowing exactly where a command starts and ends.
//! Guessing from prompt heuristics is unreliable, so we ship hook scripts that
//! make the shell announce those boundaries with OSC 133 semantic sequences:
//!
//! - `OSC 133 ; A ST` — prompt start
//! - `OSC 133 ; B ST` — command start (end of prompt)
//! - `OSC 133 ; C ST` — output start (command was submitted)
//! - `OSC 133 ; D ; <exit> ST` — command end, with exit code
//!
//! We additionally emit OSC 7 (`file://host/path`) so the UI can track cwd
//! without ever parsing the prompt.
//!
//! The scripts are written to the app's config dir on launch and sourced by the
//! user's rc file. Sessions where the hooks are absent — a remote host without
//! them installed — degrade to a single continuous block, which is the intended
//! behavior; a wrong boundary is worse than none.

use std::path::{Path, PathBuf};

use anyhow::Result;

/// Shell-integration protocol version.
///
/// Bump this whenever the hook scripts change in a way the frontend must know
/// about. Each hook announces it once at startup via `OSC 1337 ; crggr-hooks=N`,
/// a private sequence that leaves the standard OSC 133 markers untouched.
///
/// A shell that announces nothing, or announces a version the frontend does not
/// recognise, is treated as unintegrated: the session degrades to a single
/// continuous block rather than waiting forever for a `D` that will never
/// arrive. This is the same path remote hosts without hooks already take.
pub const HOOK_VERSION: u32 = 1;

pub const ZSH_HOOK: &str = r#"# CRGGR.sh shell integration (zsh) — OSC 133 semantic prompts.
# Sourced automatically by CRGGR.sh. Safe to source twice.
if [[ -n "$CRGGR_INTEGRATION_LOADED" ]]; then
  return 0
fi
CRGGR_INTEGRATION_LOADED=1

# Announce the protocol version so the frontend knows these hooks are live and
# speaks the same dialect. Emitted once, at load.
printf '\033]1337;crggr-hooks=__CRGGR_HOOK_VERSION__\a'

__crggr_osc() { printf '\033]133;%s\a' "$1"; }

# Report cwd via OSC 7 so the UI never has to parse the prompt.
__crggr_cwd() { printf '\033]7;file://%s%s\a' "$HOST" "$PWD"; }

# zsh marks output that lacks a trailing newline with a reverse-video '%', pads
# to the line width, then erases it with CR-space-CR. A cursor-addressed
# terminal wipes it; the block stream has no cursor, so the marker would survive
# as visible text. The block model already delimits output, so the mark is
# redundant here.
unsetopt PROMPT_SP 2>/dev/null
PROMPT_EOL_MARK=''

# Marks the end of output for the previous command, carrying its exit status.
__crggr_precmd() {
  local ret=$?
  if [[ -n "$__crggr_running" ]]; then
    __crggr_osc "D;$ret"
    unset __crggr_running
  fi
  __crggr_cwd
  __crggr_osc "A"
}

# Marks the transition from prompt to running command.
__crggr_preexec() {
  __crggr_running=1
  __crggr_osc "C"
}

# `B` closes the prompt region; PS1 ends with it.
PS1="$PS1"$'%{\033]133;B\a%}'

autoload -Uz add-zsh-hook 2>/dev/null
if (( $+functions[add-zsh-hook] )); then
  add-zsh-hook precmd __crggr_precmd
  add-zsh-hook preexec __crggr_preexec
fi
"#;

pub const BASH_HOOK: &str = r#"# CRGGR.sh shell integration (bash) — OSC 133 semantic prompts.
# Sourced automatically by CRGGR.sh. Safe to source twice.
if [ -n "$CRGGR_INTEGRATION_LOADED" ]; then
  return 0
fi
CRGGR_INTEGRATION_LOADED=1

# Announce the protocol version; see the zsh hook for why.
printf '\033]1337;crggr-hooks=__CRGGR_HOOK_VERSION__\a'

__crggr_osc() { printf '\033]133;%s\a' "$1"; }
__crggr_cwd() { printf '\033]7;file://%s%s\a' "${HOSTNAME:-localhost}" "$PWD"; }

# bash has no preexec, so DEBUG stands in for it. Guarded so it fires once per
# command rather than once per expression in a compound statement.
__crggr_preexec() {
  [ -n "$COMP_LINE" ] && return
  [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return
  if [ -z "$__crggr_running" ]; then
    __crggr_running=1
    __crggr_osc "C"
  fi
}

__crggr_precmd() {
  local ret=$?
  if [ -n "$__crggr_running" ]; then
    __crggr_osc "D;$ret"
    unset __crggr_running
  fi
  __crggr_cwd
  __crggr_osc "A"
}

trap '__crggr_preexec' DEBUG
case "$PROMPT_COMMAND" in
  *__crggr_precmd*) ;;
  "") PROMPT_COMMAND="__crggr_precmd" ;;
  *) PROMPT_COMMAND="__crggr_precmd;$PROMPT_COMMAND" ;;
esac

PS1="$PS1\[\033]133;B\a\]"
"#;

pub const FISH_HOOK: &str = r#"# CRGGR.sh shell integration (fish) — OSC 133 semantic prompts.
# Sourced automatically by CRGGR.sh. Safe to source twice.
if set -q CRGGR_INTEGRATION_LOADED
    exit 0
end
set -g CRGGR_INTEGRATION_LOADED 1

# Announce the protocol version; see the zsh hook for why.
printf '\033]1337;crggr-hooks=__CRGGR_HOOK_VERSION__\a'

function __crggr_osc
    printf '\033]133;%s\a' $argv[1]
end

function __crggr_cwd
    printf '\033]7;file://%s%s\a' (hostname) $PWD
end

function __crggr_preexec --on-event fish_preexec
    set -g __crggr_running 1
    __crggr_osc "C"
end

function __crggr_postexec --on-event fish_postexec
    set -l ret $status
    if set -q __crggr_running
        __crggr_osc "D;$ret"
        set -e __crggr_running
    end
end

function __crggr_prompt --on-event fish_prompt
    __crggr_cwd
    __crggr_osc "A"
end
"#;

/// Write the hook scripts into `<config>/shell-integration/` and return that dir.
///
/// Rewritten on every launch so an upgraded build ships updated hooks without
/// the user having to do anything.
pub fn install(config_dir: &Path) -> Result<PathBuf> {
    let dir = config_dir.join("shell-integration");
    std::fs::create_dir_all(&dir)?;

    // bash is launched with `--rcfile`, which REPLACES the user's rc file rather
    // than adding to it, so the shim has to source theirs explicitly first.
    let bash_rc = format!(
        r#"# Generated by CRGGR.sh. Do not edit — rewritten on every launch.
# Passed to bash via --rcfile, which replaces the default rc file, so the user's
# own config is sourced here before our hooks load.
for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -f "$f" ]; then . "$f"; break; fi
done
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
. "{hook}"
"#,
        hook = dir.join("crggr.bash").to_string_lossy(),
    );

    let version = HOOK_VERSION.to_string();
    // The pre-rename hook files, if this config directory was migrated from
    // ~/.config/trmnl. They are never sourced again — the app writes and points
    // at the crggr.* names — but leaving them makes the directory read as
    // though two integrations are installed. Best-effort: a file that will not
    // delete is inert, not a failure worth surfacing.
    for stale in ["trmnl.zsh", "trmnl.bash", "trmnl.fish", "trmnl.bashrc"] {
        let _ = std::fs::remove_file(dir.join(stale));
    }

    for (name, template) in [
        ("crggr.zsh", ZSH_HOOK),
        ("crggr.bash", BASH_HOOK),
        ("crggr.fish", FISH_HOOK),
        ("crggr.bashrc", bash_rc.as_str()),
    ] {
        // HOOK_VERSION is the single source of truth; the scripts carry a
        // placeholder so the constant cannot drift from what they announce.
        let owned = template.replace("__CRGGR_HOOK_VERSION__", &version);
        let contents = owned.as_str();
        let path = dir.join(name);
        // Only rewrite when the content actually differs, so we don't churn
        // mtimes (and any file watchers) on every launch.
        let needs_write = match std::fs::read_to_string(&path) {
            Ok(existing) => existing != contents,
            Err(_) => true,
        };
        if needs_write {
            std::fs::write(&path, contents)?;
        }
    }

    Ok(dir)
}

/// The line a user adds to their rc file to enable integration.
pub fn source_line(dir: &Path, shell: &str) -> String {
    let file = match shell {
        "bash" => "crggr.bash",
        "fish" => "crggr.fish",
        _ => "crggr.zsh",
    };
    let path = dir.join(file).to_string_lossy().to_string();
    if shell == "fish" {
        format!("test -f \"{path}\" && source \"{path}\"")
    } else {
        format!("[ -f \"{path}\" ] && . \"{path}\"")
    }
}
