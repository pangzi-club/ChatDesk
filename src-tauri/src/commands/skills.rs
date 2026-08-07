use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const MAX_SKILL_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: String,
    pub content: String,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn skill_roots() -> Vec<(String, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir() {
        for (source, directory) in [
            ("agents", ".agents/skills"),
            ("agent", ".agent/skills"),
            ("codex", ".codex/skills"),
            ("claude", ".claude/skills"),
        ] {
            roots.push((source.to_string(), home.join(directory)));
        }
    }
    if let Ok(workspace) = std::env::current_dir() {
        for (source, directory) in [
            ("workspace-agents", ".agents/skills"),
            ("workspace-agent", ".agent/skills"),
            ("workspace-codex", ".codex/skills"),
            ("workspace-claude", ".claude/skills"),
        ] {
            roots.push((source.to_string(), workspace.join(directory)));
        }
    }
    roots
}

fn clean_frontmatter_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn parse_skill(path: &Path, source: &str) -> Option<SkillDefinition> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_SKILL_FILE_BYTES {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let directory = path.parent()?.file_name()?.to_str()?.trim();
    if directory.is_empty() {
        return None;
    }
    let mut name = directory.to_string();
    let mut description = String::new();
    let mut in_frontmatter = false;
    for line in content.lines().take(80) {
        let trimmed = line.trim();
        if trimmed == "---" {
            in_frontmatter = !in_frontmatter;
            continue;
        }
        if in_frontmatter {
            if let Some(value) = trimmed.strip_prefix("name:") {
                let value = clean_frontmatter_value(value);
                if !value.is_empty() {
                    name = value;
                }
            } else if let Some(value) = trimmed.strip_prefix("description:") {
                description = clean_frontmatter_value(value);
            }
        } else if name == directory && trimmed.starts_with('#') {
            let heading = trimmed.trim_start_matches('#').trim();
            if !heading.is_empty() {
                name = heading.to_string();
                break;
            }
        }
    }
    if description.is_empty() {
        description = content
            .lines()
            .skip_while(|line| line.trim().is_empty() || line.trim() == "---")
            .find(|line| !line.trim().is_empty() && !line.trim().starts_with('#'))
            .map(|line| line.trim().chars().take(180).collect())
            .unwrap_or_default();
    }
    let id = format!("{source}:{}", directory.to_ascii_lowercase());
    Some(SkillDefinition {
        id,
        name,
        description,
        source: source.to_string(),
        path: path.to_string_lossy().to_string(),
        content,
    })
}

fn find_skill_files(root: &Path) -> Vec<PathBuf> {
    if !root.is_dir() {
        return Vec::new();
    }
    let mut files = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skill_file = path.join("SKILL.md");
            if skill_file.is_file() {
                files.push(skill_file);
            }
        }
    }
    files
}

#[tauri::command]
pub fn scan_skills() -> Result<Vec<SkillDefinition>, String> {
    let mut skills = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (source, root) in skill_roots() {
        for path in find_skill_files(&root) {
            let canonical = path.canonicalize().unwrap_or(path.clone());
            if !seen.insert(canonical.clone()) {
                continue;
            }
            if let Some(skill) = parse_skill(&canonical, &source) {
                skills.push(skill);
            }
        }
    }
    skills.sort_by_key(|skill| skill.name.to_lowercase());
    Ok(skills)
}
