//! Working-directory inspection for the fresh-session (welcome) state.
//!
//! The handoff is explicit that the DETECTED line and SUGGESTED commands are
//! real product behavior, not decoration: inspect the cwd and surface actual
//! entrypoints. The hard rule is **never show a suggestion that would fail** —
//! every suggestion here is derived from a file we just read, so a script we
//! offer is a script that exists.

use std::path::Path;

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub cmd: String,
    /// Short trailing note shown dim next to the command.
    pub note: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    /// The `DETECTED` line, e.g. `next 16 · shopify cli · pnpm`.
    pub stack: String,
    /// Where the suggestions came from, e.g. `from package.json + shopify.app.toml`.
    pub source: String,
    /// At most three, per the spec.
    pub suggestions: Vec<Suggestion>,
    pub branch: Option<String>,
}

/// Inspect `dir` and produce the welcome-state content.
pub fn detect(dir: &Path) -> Detection {
    let mut stack: Vec<String> = Vec::new();
    let mut sources: Vec<String> = Vec::new();
    let mut suggestions: Vec<Suggestion> = Vec::new();

    let pkg_path = dir.join("package.json");
    let pkg = std::fs::read_to_string(&pkg_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());

    if let Some(pkg) = &pkg {
        sources.push("package.json".to_string());

        // Framework and tooling versions come from the declared dependencies, so
        // we report what the project actually pins rather than what's installed.
        let deps = ["dependencies", "devDependencies"]
            .iter()
            .filter_map(|k| pkg.get(*k))
            .filter_map(|d| d.as_object())
            .flat_map(|d| d.iter())
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
            .collect::<Vec<_>>();

        for (name, label) in [
            ("next", "next"),
            ("react", "react"),
            ("vue", "vue"),
            ("svelte", "svelte"),
            ("vite", "vite"),
            ("tailwindcss", "tailwind"),
            ("typescript", "typescript"),
        ] {
            if let Some((_, ver)) = deps.iter().find(|(k, _)| k == name) {
                match major(ver) {
                    Some(m) => stack.push(format!("{label} {m}")),
                    None => stack.push(label.to_string()),
                }
            }
        }

        if let Some(pm) = package_manager(dir) {
            stack.push(pm);
        }

        // Offer real scripts only, in a sensible priority order.
        if let Some(scripts) = pkg.get("scripts").and_then(|s| s.as_object()) {
            for name in ["dev", "build", "test", "start", "lint"] {
                if scripts.contains_key(name) && suggestions.len() < 3 {
                    let runner = package_manager(dir).unwrap_or_else(|| "npm".into());
                    let cmd = if runner == "npm" {
                        format!("npm run {name}")
                    } else {
                        format!("{runner} {name}")
                    };
                    suggestions.push(Suggestion {
                        cmd,
                        note: name.to_string(),
                    });
                }
            }
        }
    }

    if dir.join("shopify.app.toml").exists() {
        sources.push("shopify.app.toml".to_string());
        stack.push("shopify cli".to_string());
    }

    if dir.join("Cargo.toml").exists() {
        sources.push("Cargo.toml".to_string());
        stack.push("cargo".to_string());
        if suggestions.len() < 3 {
            suggestions.push(Suggestion {
                cmd: "cargo build".into(),
                note: "build".into(),
            });
        }
    }

    // Makefile targets are real entrypoints too.
    if let Some(target) = first_make_target(dir) {
        sources.push("Makefile".to_string());
        stack.push("make".to_string());
        if suggestions.len() < 3 {
            suggestions.push(Suggestion {
                cmd: format!("make {target}"),
                note: "make".into(),
            });
        }
    }

    if dir.join("pyproject.toml").exists() {
        sources.push("pyproject.toml".to_string());
        stack.push("python".to_string());
    }

    let branch = git_branch(dir);
    if branch.is_some() && suggestions.len() < 3 {
        suggestions.push(Suggestion {
            cmd: "git status".into(),
            note: "repository state".into(),
        });
    }

    // Fallbacks that are always safe to run.
    if suggestions.is_empty() {
        suggestions.push(Suggestion {
            cmd: "ls -la".into(),
            note: "list".into(),
        });
    }

    if stack.is_empty() {
        if let Some(v) = node_version() {
            stack.push(format!("node {v}"));
        }
        if let Some(s) = shell_name() {
            stack.push(s);
        }
    }

    let source = if sources.is_empty() {
        "from $SHELL".to_string()
    } else {
        format!("from {}", sources.join(" + "))
    };

    suggestions.truncate(3);

    Detection {
        stack: stack.join(" · "),
        source,
        suggestions,
        branch,
    }
}

fn major(version: &str) -> Option<u32> {
    let cleaned = version.trim_start_matches(['^', '~', '>', '=', '<', 'v', ' ']);
    cleaned
        .split(['.', '-'])
        .next()
        .and_then(|s| s.parse().ok())
}

fn package_manager(dir: &Path) -> Option<String> {
    if dir.join("pnpm-lock.yaml").exists() {
        Some("pnpm".into())
    } else if dir.join("yarn.lock").exists() {
        Some("yarn".into())
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        Some("bun".into())
    } else if dir.join("package-lock.json").exists() {
        Some("npm".into())
    } else {
        None
    }
}

fn first_make_target(dir: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(dir.join("Makefile")).ok()?;
    for line in contents.lines() {
        // A target line looks like `name:` and isn't indented, a comment, or a
        // variable assignment.
        if line.starts_with([' ', '\t', '#', '.']) {
            continue;
        }
        if let Some((name, rest)) = line.split_once(':') {
            if rest.starts_with('=') {
                continue;
            }
            let name = name.trim();
            if !name.is_empty() && !name.contains(['=', '$', ' ']) {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn git_branch(dir: &Path) -> Option<String> {
    // Walk up looking for a .git, then read HEAD directly — no git subprocess.
    let mut cur = Some(dir);
    while let Some(d) = cur {
        let git = d.join(".git");
        let head_path = if git.is_dir() {
            git.join("HEAD")
        } else if git.is_file() {
            // A worktree or submodule: .git is a file pointing at the real dir.
            let contents = std::fs::read_to_string(&git).ok()?;
            let path = contents.strip_prefix("gitdir:")?.trim();
            Path::new(path).join("HEAD")
        } else {
            cur = d.parent();
            continue;
        };

        let head = std::fs::read_to_string(head_path).ok()?;
        let head = head.trim();
        return if let Some(r) = head.strip_prefix("ref: refs/heads/") {
            Some(r.to_string())
        } else {
            // Detached HEAD — show the short sha.
            Some(head.chars().take(7).collect())
        };
    }
    None
}

fn node_version() -> Option<String> {
    let out = std::process::Command::new("node").arg("-v").output().ok()?;
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let v = v.trim_start_matches('v').to_string();
    v.split('.').next().map(|m| m.to_string())
}

fn shell_name() -> Option<String> {
    let shell = std::env::var("SHELL").ok()?;
    let name = Path::new(&shell).file_name()?.to_string_lossy().to_string();
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("trmnl-detect-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reports_only_declared_dependencies() {
        let dir = tmpdir("declared");
        std::fs::write(
            dir.join("package.json"),
            r#"{"dependencies":{"next":"^16.0.1"},"scripts":{"build":"next build"}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("package-lock.json"), "{}").unwrap();

        let d = detect(&dir);
        assert!(d.stack.contains("next 16"), "stack was {}", d.stack);
        // tailwind is not a dependency here and must not be invented.
        assert!(!d.stack.contains("tailwind"), "stack was {}", d.stack);
        // The lockfile is npm's, so the runner must not claim pnpm/bun/yarn.
        assert!(d.stack.contains("npm"), "stack was {}", d.stack);
        assert!(!d.stack.contains("bun"), "stack was {}", d.stack);
        assert_eq!(d.suggestions[0].cmd, "npm run build");
    }

    #[test]
    fn never_suggests_a_script_that_does_not_exist() {
        let dir = tmpdir("noscripts");
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"lint":"eslint ."}}"#).unwrap();

        let d = detect(&dir);
        let cmds: Vec<_> = d.suggestions.iter().map(|s| s.cmd.as_str()).collect();
        // Only `lint` is declared, so `dev`/`build`/`test` must not appear.
        assert!(cmds.contains(&"npm run lint"), "got {cmds:?}");
        assert!(!cmds.iter().any(|c| c.contains("run dev")), "got {cmds:?}");
        assert!(!cmds.iter().any(|c| c.contains("run build")), "got {cmds:?}");
    }

    #[test]
    fn detects_package_manager_from_lockfile() {
        let dir = tmpdir("pnpm");
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();

        let d = detect(&dir);
        assert_eq!(d.suggestions[0].cmd, "pnpm dev");
    }

    #[test]
    fn caps_suggestions_at_three() {
        let dir = tmpdir("cap");
        std::fs::write(
            dir.join("package.json"),
            r#"{"scripts":{"dev":"x","build":"x","test":"x","start":"x","lint":"x"}}"#,
        )
        .unwrap();

        assert!(detect(&dir).suggestions.len() <= 3);
    }

    #[test]
    fn falls_back_when_directory_is_bare() {
        let dir = tmpdir("bare");
        let d = detect(&dir);
        // A bare directory still needs a safe, runnable suggestion.
        assert_eq!(d.suggestions.len(), 1);
        assert_eq!(d.suggestions[0].cmd, "ls -la");
        assert_eq!(d.source, "from $SHELL");
    }

    #[test]
    fn reads_makefile_target() {
        let dir = tmpdir("make");
        std::fs::write(
            dir.join("Makefile"),
            "CC=gcc\n.PHONY: all\n\nall: deps\n\tcargo build\n",
        )
        .unwrap();

        let d = detect(&dir);
        // `CC=gcc` is an assignment and `.PHONY` a directive; neither is a target.
        assert_eq!(first_make_target(&dir).as_deref(), Some("all"));
        assert!(d.stack.contains("make"), "stack was {}", d.stack);
    }

    #[test]
    fn parses_version_majors() {
        assert_eq!(major("^19.2.0"), Some(19));
        assert_eq!(major("~5.9.3"), Some(5));
        assert_eq!(major("4"), Some(4));
        assert_eq!(major("workspace:^"), None);
        assert_eq!(major(""), None);
    }
}
