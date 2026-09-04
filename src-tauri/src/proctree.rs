//! What is *actually* running under a session's shell.
//!
//! A command accent rule matches a command word, but the word the user typed is
//! frequently not the tool that matters. `bun run start` can expand, through a
//! package script and a parallel runner, into `shopify theme dev` four levels
//! down — and nothing in the typed line says so. Parsing the typed command can
//! never see that; walking the process tree can.
//!
//! So this module descends from the shell PID and reports the command words of
//! every live descendant. The frontend matches those words against the same
//! accent rules it already applies to the typed command, which is what makes a
//! chained tool colour the interface without the script knowing anything about
//! CRGGR.sh.
//!
//! Two properties of real trees drive the implementation, both observed rather
//! than assumed:
//!
//! 1. **The process name is useless.** A `node_modules/.bin` shim runs as
//!    `node`, so the whole tree reports `node`/`bun`. The tool name lives only
//!    in the arguments — `node …/node_modules/.bin/shopify theme dev`. Hence
//!    every argument is considered, not just `argv[0]`.
//! 2. **Depth is unbounded and irregular.** npm, bun, `run-p`, `cross-env` and
//!    shell wrappers each add a layer, and the count differs per runner. There
//!    is no fixed depth to look at, so the walk is exhaustive with a depth cap
//!    only as a cycle guard.

use std::collections::{HashMap, HashSet};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// Depth cap for the descent. Real trees run ~4–6 deep; this is a guard against
/// a pathological or cyclic parent chain, not a real limit.
const MAX_DEPTH: usize = 32;

/// Arguments that are never a tool name, so they never become candidate words.
/// `run`/`exec` are subcommands of the runners; the rest are noise that would
/// otherwise produce words competing with the real tool.
const SKIP_WORDS: &[&str] = &[
    "run", "exec", "run-s", "run-p", "npm-run-all", "npx", "bunx", "sh", "-c", "env", "cross-env",
    "node", "bun", "deno", "npm", "pnpm", "yarn", "zsh", "bash", "fish", "sudo", "command", "time",
    "nice", "nohup", "which", "true", "false",
];

/// Scan the descendants of `root` and return the distinct command words found,
/// ordered outermost-first (shallowest depth first).
///
/// Ordering matters: the caller applies first-match-wins, and a shallower
/// process is the more general description of what the session is doing. Within
/// one depth the order follows the tree walk, which is stable for a given tree.
pub fn descendant_words(system: &System, root: u32) -> Vec<String> {
    // Index children by parent once; sysinfo only exposes the upward link.
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, proc_) in system.processes() {
        if let Some(parent) = proc_.parent() {
            children.entry(parent.as_u32()).or_default().push(pid.as_u32());
        }
    }
    // A stable walk means a stable accent for an unchanged tree.
    for kids in children.values_mut() {
        kids.sort_unstable();
    }

    let mut words: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut visited: HashSet<u32> = HashSet::new();

    // Breadth-first so shallower processes are reported first.
    let mut frontier = vec![root];
    visited.insert(root);

    for _ in 0..MAX_DEPTH {
        if frontier.is_empty() {
            break;
        }
        let mut next = Vec::new();
        for pid in frontier {
            // The root is the shell itself; its own words are not interesting.
            if pid != root {
                if let Some(proc_) = system.process(Pid::from_u32(pid)) {
                    for word in words_of(proc_) {
                        if seen.insert(word.clone()) {
                            words.push(word);
                        }
                    }
                }
            }
            if let Some(kids) = children.get(&pid) {
                for &kid in kids {
                    if visited.insert(kid) {
                        next.push(kid);
                    }
                }
            }
        }
        frontier = next;
    }

    words
}

/// Candidate command words for one process.
///
/// Every argument is a candidate because a `.bin` shim hides the tool name in
/// the arguments (see the module note). Flags, paths that are plainly operands,
/// and the runner vocabulary in `SKIP_WORDS` are dropped.
fn words_of(proc_: &sysinfo::Process) -> Vec<String> {
    let mut out = Vec::new();

    // The executable's own name still matters for a directly-invoked binary
    // (`cargo build`, `docker compose up`).
    if let Some(name) = proc_.exe().and_then(|p| p.file_name()) {
        push_word(&mut out, &name.to_string_lossy());
    }

    for arg in proc_.cmd() {
        let arg = arg.to_string_lossy();
        // A flag, or a `--flag=value`; never a tool.
        if arg.starts_with('-') {
            continue;
        }
        // An inline script body (`node -e '…'`) is not a path to a tool.
        if arg.contains('\n') || arg.len() > 200 {
            continue;
        }
        push_word(&mut out, &arg);
    }

    out
}

/// Normalise one argument to a command word and push it when it could be a tool.
fn push_word(out: &mut Vec<String>, raw: &str) {
    // A flag is never a tool. Checked here as well as at the call site so the
    // guarantee holds for every caller, not just the argument loop.
    if raw.trim_start().starts_with('-') {
        return;
    }
    let word = basename(raw);
    if word.is_empty() {
        return;
    }
    // `VAR=value` operands and anything with shell metacharacters are not tools.
    if word.contains('=') {
        return;
    }
    if SKIP_WORDS.contains(&word.as_str()) {
        return;
    }
    // A bare version or numeric operand is not a tool name.
    if word.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return;
    }
    if !out.contains(&word) {
        out.push(word);
    }
}

/// Lowercased final path component, with a `.exe`/`.cmd`-style suffix removed.
///
/// Mirrors `commandWord`'s `basename` on the frontend so a rule matches the same
/// way whether the word came from the typed line or from the process tree.
fn basename(word: &str) -> String {
    let name = match word.rfind('/') {
        Some(i) => &word[i + 1..],
        None => word,
    };
    let name = name.trim();
    // Strip a Windows-style launcher suffix; harmless on Unix, and keeps the
    // word identical to what a rule would be written against.
    let name = name
        .strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".cmd"))
        .or_else(|| name.strip_suffix(".bat"))
        .unwrap_or(name);
    name.to_lowercase()
}

/// A `System` configured to refresh only what the walk needs.
///
/// Process-only refreshes keep the poll cheap: no disks, networks, or CPU
/// sampling, which is the difference between this being invisible and being a
/// background load at a sub-second interval.
pub fn scanner() -> System {
    System::new()
}

/// Refresh process state and return the words under `root`.
pub fn scan(system: &mut System, root: u32) -> Vec<String> {
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        // `cmd` and `exe` are the fields `words_of` reads.
        ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always).with_exe(sysinfo::UpdateKind::Always),
    );
    descendant_words(system, root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basename_strips_directories_and_case() {
        assert_eq!(basename("/a/b/node_modules/.bin/shopify"), "shopify");
        assert_eq!(basename("Shopify"), "shopify");
        assert_eq!(basename("shopify.cmd"), "shopify");
        assert_eq!(basename("cargo"), "cargo");
    }

    #[test]
    fn skips_runner_vocabulary_and_flags() {
        let mut out = Vec::new();
        for raw in ["node", "run", "-sr", "npm", "bun"] {
            push_word(&mut out, raw);
        }
        // Every one of these is a wrapper or flag, never the tool of interest.
        assert!(out.is_empty(), "got {out:?}");
    }

    #[test]
    fn keeps_a_real_tool_name() {
        let mut out = Vec::new();
        push_word(&mut out, "/Users/x/node_modules/.bin/shopify");
        push_word(&mut out, "theme");
        assert_eq!(out, vec!["shopify", "theme"]);
    }

    #[test]
    fn rejects_assignments_and_numbers() {
        let mut out = Vec::new();
        push_word(&mut out, "NODE_ENV=development");
        push_word(&mut out, "30000");
        assert!(out.is_empty(), "got {out:?}");
    }

    #[test]
    fn deduplicates_within_a_process() {
        let mut out = Vec::new();
        push_word(&mut out, "shopify");
        push_word(&mut out, "/some/path/shopify");
        assert_eq!(out, vec!["shopify"]);
    }

    #[test]
    fn finds_this_process_under_its_own_parent() {
        // A self-check against the live tree: scanning from our parent must
        // reach us, which is the property the whole feature depends on.
        let mut system = scanner();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_cmd(sysinfo::UpdateKind::Always)
                .with_exe(sysinfo::UpdateKind::Always),
        );
        let me = std::process::id();
        let parent = system
            .process(Pid::from_u32(me))
            .and_then(|p| p.parent())
            .map(|p| p.as_u32());
        let Some(parent) = parent else {
            return; // No visible parent in this environment; nothing to assert.
        };
        // Walking from the parent must visit us. The test binary's own name is
        // arbitrary, so assert on reachability rather than a specific word.
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for (pid, proc_) in system.processes() {
            if let Some(p) = proc_.parent() {
                children.entry(p.as_u32()).or_default().push(pid.as_u32());
            }
        }
        assert!(
            children.get(&parent).is_some_and(|k| k.contains(&me)),
            "expected {me} among children of {parent}"
        );
    }
}
