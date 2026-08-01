//! PTY session management.
//!
//! Each `Session` owns one pseudoterminal running a real shell. Bytes read from
//! the PTY are forwarded to the frontend verbatim as `pty://data` events — this
//! layer does not interpret them. Block boundaries come from OSC 133 sequences
//! that the shell integration emits, and those are parsed on the frontend where
//! the xterm parser already lives.

use std::collections::HashMap;
use std::io::{Read, Write};

use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Payload for `pty://data`. `data` is a lossy-UTF8 chunk straight off the PTY.
#[derive(Clone, Serialize)]
pub struct PtyOutput {
    pub id: String,
    pub data: String,
}

/// Payload for `pty://exit`, emitted once when the shell process ends.
#[derive(Clone, Serialize)]
pub struct PtyExit {
    pub id: String,
    pub code: Option<i32>,
}

/// Options for spawning a session. Mirrors the fields a profile can set.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOptions {
    /// Shell binary. Defaults to `$SHELL`, then `/bin/zsh`.
    pub shell: Option<String>,
    /// Working directory for the shell.
    pub cwd: Option<String>,
    /// Extra environment variables layered over the inherited environment.
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// An ssh target. When set, the shell is `ssh <target>` instead of a local shell.
    pub connect_via: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    /// Directory holding the shell-integration hooks, injected at spawn.
    pub integration_dir: Option<String>,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn a shell attached to a new PTY and start streaming its output.
    pub fn spawn(&self, app: &AppHandle, id: String, opts: SpawnOptions) -> Result<()> {
        if self.sessions.lock().contains_key(&id) {
            return Err(anyhow!("session {id} already exists"));
        }

        let pty_system = NativePtySystem::default();
        let size = PtySize {
            rows: opts.rows.unwrap_or(24),
            cols: opts.cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system.openpty(size)?;

        let mut cmd = build_command(&opts)?;
        // A login shell so the user's profile (and our OSC 133 hooks) load.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "TRMNL");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        for (k, v) in &opts.env {
            cmd.env(k, v);
        }
        if let Some(cwd) = &opts.cwd {
            let expanded = expand_tilde(cwd);
            if std::path::Path::new(&expanded).is_dir() {
                cmd.cwd(expanded);
            }
        }

        let child = pair.slave.spawn_command(cmd)?;
        // Drop the slave handle so the PTY reports EOF when the child exits.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        self.sessions.lock().insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                child,
            },
        );

        // One reader thread per session. Blocking reads are fine here; the thread
        // ends when the PTY hits EOF after the shell exits.
        let app = app.clone();
        let read_id = id.clone();
        std::thread::Builder::new()
            .name(format!("pty-read-{read_id}"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let data = String::from_utf8_lossy(&buf[..n]).to_string();
                            if app
                                .emit(
                                    "pty://data",
                                    PtyOutput {
                                        id: read_id.clone(),
                                        data,
                                    },
                                )
                                .is_err()
                            {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let _ = app.emit(
                    "pty://exit",
                    PtyExit {
                        id: read_id,
                        code: None,
                    },
                );
            })?;

        Ok(())
    }

    /// Forward keystrokes (or any bytes) to the shell.
    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| anyhow!("no such session: {id}"))?;
        session.writer.write_all(data.as_bytes())?;
        session.writer.flush()?;
        Ok(())
    }

    /// Tell the PTY its new dimensions so the shell can reflow (SIGWINCH).
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(id)
            .ok_or_else(|| anyhow!("no such session: {id}"))?;
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    /// Kill the shell and forget the session.
    pub fn kill(&self, id: &str) -> Result<()> {
        if let Some(mut session) = self.sessions.lock().remove(id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
        Ok(())
    }

    pub fn exists(&self, id: &str) -> bool {
        self.sessions.lock().contains_key(id)
    }
}

/// Shell kind, for choosing how to inject the integration hooks.
fn shell_kind(shell: &str) -> &'static str {
    let name = std::path::Path::new(shell)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.contains("fish") {
        "fish"
    } else if name.contains("bash") {
        "bash"
    } else {
        "zsh"
    }
}

fn build_command(opts: &SpawnOptions) -> Result<CommandBuilder> {
    // A remote profile runs ssh in the PTY; everything else runs a local shell.
    if let Some(target) = opts.connect_via.as_deref() {
        let target = target.trim();
        if !target.is_empty() && target != "local" {
            let mut cmd = CommandBuilder::new("/usr/bin/ssh");
            // Request a TTY so the remote shell behaves interactively.
            cmd.arg("-t");
            cmd.arg(target);
            return Ok(cmd);
        }
    }

    let shell = opts
        .shell
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    let kind = shell_kind(&shell);

    // Load the OSC 133 hooks without touching the user's dotfiles.
    //
    // zsh: point ZDOTDIR at a generated directory whose .zshrc sources the real
    // one first, then our hooks. This is how iTerm2 and VS Code do it, and it
    // guarantees our precmd/preexec hooks are registered last.
    //
    // bash: --rcfile does the same job in one flag.
    //
    // fish has no equivalent hook, so it relies on the user sourcing the script
    // from config.fish; without it the session degrades to a single block, which
    // is the intended fallback.
    if let Some(dir) = opts.integration_dir.as_deref() {
        match kind {
            "zsh" => {
                if let Ok(zdotdir) = prepare_zdotdir(dir) {
                    cmd.env("ZDOTDIR", zdotdir);
                    // Carry the user's real ZDOTDIR through for our .zshrc to chain to.
                    if let Ok(existing) = std::env::var("ZDOTDIR") {
                        cmd.env("TRMNL_USER_ZDOTDIR", existing);
                    }
                }
            }
            "bash" => {
                let rcfile = std::path::Path::new(dir).join("trmnl.bashrc");
                if rcfile.is_file() {
                    cmd.arg("--rcfile");
                    cmd.arg(rcfile.to_string_lossy().to_string());
                }
            }
            _ => {}
        }
    }

    // `-l` so the login profile runs. zsh reads .zshrc from ZDOTDIR either way.
    cmd.arg("-l");
    Ok(cmd)
}

/// Write the shim `.zshrc` that chains the user's config then our hooks.
fn prepare_zdotdir(integration_dir: &str) -> Result<String> {
    let dir = std::path::Path::new(integration_dir).join("zdotdir");
    std::fs::create_dir_all(&dir)?;

    let hook = std::path::Path::new(integration_dir).join("trmnl.zsh");
    let contents = format!(
        r#"# Generated by TRMNL. Do not edit — rewritten on every launch.
# Chains the user's real zsh config, then loads the OSC 133 hooks last so our
# precmd/preexec run after anything the user's config installs.
TRMNL_ZDOTDIR="$ZDOTDIR"
if [ -n "$TRMNL_USER_ZDOTDIR" ]; then
  ZDOTDIR="$TRMNL_USER_ZDOTDIR"
else
  ZDOTDIR="$HOME"
fi
[ -f "$ZDOTDIR/.zshrc" ] && . "$ZDOTDIR/.zshrc"
unset TRMNL_USER_ZDOTDIR
. "{hook}"
"#,
        hook = hook.to_string_lossy(),
    );

    let path = dir.join(".zshrc");
    let needs_write = match std::fs::read_to_string(&path) {
        Ok(existing) => existing != contents,
        Err(_) => true,
    };
    if needs_write {
        std::fs::write(&path, contents)?;
    }

    Ok(dir.to_string_lossy().to_string())
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix('~') {
        if let Some(home) = std::env::var_os("HOME") {
            let home = home.to_string_lossy().to_string();
            let rest = rest.strip_prefix('/').unwrap_or(rest);
            if rest.is_empty() {
                return home;
            }
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}
