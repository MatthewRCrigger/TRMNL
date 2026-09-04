//! PTY session management.
//!
//! Each `Session` owns one pseudoterminal running a real shell. Bytes read from
//! the PTY are forwarded to the frontend verbatim as `pty://data` events — this
//! layer does not interpret them. Block boundaries come from OSC 133 sequences
//! that the shell integration emits, and those are parsed on the frontend where
//! the xterm parser already lives.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

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
    /// Shared with the reader thread so it can `wait()` for the real exit
    /// status once it sees EOF, without needing to reach back through the
    /// session map (whose lifetime it cannot statically outlive).
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    /// The shell's PID, kept so the process-tree scan has a root to walk from.
    /// See `proctree`: what a session is *really* running is only visible by
    /// descending from here, not by reading the command the user typed.
    pid: Option<u32>,
    /// Label of the window this session belongs to.
    ///
    /// This is what replaced `kill_all`. A reload used to be indistinguishable
    /// from a window closing — both left sessions in this map with nothing able
    /// to reach them — so the reloading page reaped *everything*, which under
    /// multiple windows would mean one window's reload killing another's shells.
    /// Recording the owner makes the two cases distinguishable: a reload
    /// re-attaches to its own sessions, and only a real close reaps them.
    window: String,
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
    ///
    /// `window` is the label of the window that will own the session; see
    /// `Session::window` for why ownership is recorded rather than inferred.
    pub fn spawn(
        &self,
        app: &AppHandle,
        window: &str,
        id: String,
        opts: SpawnOptions,
    ) -> Result<()> {
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
        cmd.env("TERM_PROGRAM", "CRGGR.sh");
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
        let pid = child.process_id();
        // Drop the slave handle so the PTY reports EOF when the child exits.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>> =
            Arc::new(Mutex::new(child));

        self.sessions.lock().insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                child: child.clone(),
                pid,
                window: window.to_string(),
            },
        );

        // One reader thread per session. Blocking reads are fine here; the thread
        // ends when the PTY hits EOF after the shell exits.
        //
        // Output goes to the owning window with `emit_to`, not app-wide: a
        // broadcast would hand every window every other window's output, and
        // each of those windows has a session table that would happily match the
        // id and append it. The listener side cannot tell the difference, so the
        // filtering has to happen here.
        let app = app.clone();
        let read_id = id.clone();
        let read_window = window.to_string();
        let child_for_wait = child;
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
                                .emit_to(
                                    read_window.as_str(),
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
                // EOF means the shell already exited; `wait()` here just reaps the
                // zombie and reads the status the OS already recorded rather than
                // blocking on a process that is (or is about to be) done. Holding
                // the `Arc` directly (rather than looking the session back up by
                // id) is what lets this run even after `kill()` has already
                // removed the session from the map — `wait()` is safe to call more
                // than once and only the first caller sees a real status.
                let code = child_for_wait
                    .lock()
                    .wait()
                    .ok()
                    .map(|status| status.exit_code() as i32);
                let _ = app.emit_to(
                    read_window.as_str(),
                    "pty://exit",
                    PtyExit { id: read_id, code },
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
        if let Some(session) = self.sessions.lock().remove(id) {
            let mut child = session.child.lock();
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }

    pub fn exists(&self, id: &str) -> bool {
        self.sessions.lock().contains_key(id)
    }

    /// Ids of a window's sessions, oldest first.
    ///
    /// This is what a reloading page calls instead of the old `kill_all`. The
    /// sessions are still alive and still owned by this window, so the page can
    /// re-attach to them rather than reap them and spawn replacements — the
    /// shell, its scrollback and its running command all survive the reload.
    pub fn ids_for_window(&self, window: &str) -> Vec<String> {
        let sessions = self.sessions.lock();
        let mut ids: Vec<&String> = sessions
            .iter()
            .filter(|(_, s)| s.window == window)
            .map(|(id, _)| id)
            .collect();
        // Insertion order is not preserved by HashMap, but session ids are
        // allocated in creation order, so sorting restores the order the window
        // laid its sessions out in.
        ids.sort();
        ids.into_iter().cloned().collect()
    }

    /// Kill every session owned by one window. Returns how many were killed.
    ///
    /// Called when a window really closes, which is the only moment its sessions
    /// become genuinely unreachable. A reload must *not* call this: see
    /// `ids_for_window`.
    pub fn kill_for_window(&self, window: &str) -> usize {
        let doomed: Vec<Session> = {
            let mut sessions = self.sessions.lock();
            let ids: Vec<String> = sessions
                .iter()
                .filter(|(_, s)| s.window == window)
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| sessions.remove(id)).collect()
        };

        let count = doomed.len();
        for session in doomed {
            let mut child = session.child.lock();
            let _ = child.kill();
            let _ = child.wait();
        }
        count
    }

    /// The shell PID for a session, or None if it never started.
    pub fn pid(&self, id: &str) -> Option<u32> {
        self.sessions.lock().get(id).and_then(|s| s.pid)
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
                        cmd.env("CRGGR_USER_ZDOTDIR", existing);
                    }
                }
            }
            "bash" => {
                let rcfile = std::path::Path::new(dir).join("crggr.bashrc");
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

    let hook = std::path::Path::new(integration_dir).join("crggr.zsh");
    let contents = format!(
        r#"# Generated by CRGGR.sh. Do not edit — rewritten on every launch.
# Chains the user's real zsh config, then loads the OSC 133 hooks last so our
# precmd/preexec run after anything the user's config installs.
CRGGR_ZDOTDIR="$ZDOTDIR"
if [ -n "$CRGGR_USER_ZDOTDIR" ]; then
  ZDOTDIR="$CRGGR_USER_ZDOTDIR"
else
  ZDOTDIR="$HOME"
fi
[ -f "$ZDOTDIR/.zshrc" ] && . "$ZDOTDIR/.zshrc"
unset CRGGR_USER_ZDOTDIR
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
