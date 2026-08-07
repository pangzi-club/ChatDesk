use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::models::sandbox::{
    WorkspaceDirEntry, WorkspaceEditFileResult, WorkspaceListDirResult, WorkspaceReadFileResult,
    WorkspaceSearchFilesResult, WorkspaceWriteFileResult,
};

pub fn list_dir(cwd: String, path: Option<String>) -> Result<WorkspaceListDirResult, String> {
    let root = resolve_cwd(&cwd)?;
    let target = resolve_existing_path(&root, Some(path.as_deref().unwrap_or(".")))?;
    if !target.is_dir() {
        return Err(format!(
            "路径不是目录：{}",
            display_relative(&root, &target)
        ));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&target).map_err(|error| format!("无法读取目录：{error}"))?;
    for entry in read_dir {
        let entry = entry.map_err(|error| format!("无法读取目录项：{error}"))?;
        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法读取文件类型：{error}"))?;
        let kind = if file_type.is_dir() {
            "dir"
        } else if file_type.is_file() {
            "file"
        } else {
            "other"
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        entries.push(WorkspaceDirEntry {
            name,
            path: display_relative(&root, &entry_path),
            kind: kind.to_string(),
        });
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(WorkspaceListDirResult {
        path: display_relative(&root, &target),
        entries,
    })
}

pub fn read_file(cwd: String, path: String) -> Result<WorkspaceReadFileResult, String> {
    let root = resolve_cwd(&cwd)?;
    let target = resolve_existing_path(&root, Some(&path))?;
    if !target.is_file() {
        return Err(format!(
            "路径不是文件：{}",
            display_relative(&root, &target)
        ));
    }

    let content = fs::read_to_string(&target).map_err(|error| format!("无法读取文件：{error}"))?;
    Ok(WorkspaceReadFileResult {
        path: display_relative(&root, &target),
        content,
    })
}

pub fn write_file(
    cwd: String,
    path: String,
    content: String,
) -> Result<WorkspaceWriteFileResult, String> {
    let root = resolve_cwd(&cwd)?;
    let target = resolve_writable_path(&root, &path)?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建父目录：{error}"))?;
    }

    fs::write(&target, content.as_bytes()).map_err(|error| format!("无法写入文件：{error}"))?;

    Ok(WorkspaceWriteFileResult {
        path: display_relative(&root, &target),
        bytes_written: content.len(),
    })
}

pub fn edit_file(
    cwd: String,
    path: String,
    old_text: String,
    new_text: String,
) -> Result<WorkspaceEditFileResult, String> {
    let root = resolve_cwd(&cwd)?;
    let target = resolve_existing_path(&root, Some(&path))?;
    if !target.is_file() {
        return Err(format!(
            "路径不是文件：{}",
            display_relative(&root, &target)
        ));
    }
    let content = fs::read_to_string(&target).map_err(|error| format!("无法读取文件：{error}"))?;
    let count = content.match_indices(&old_text).count();
    if count != 1 {
        return Err(format!("精确替换要求匹配 1 次，实际匹配 {count} 次"));
    }
    let next = content.replacen(&old_text, &new_text, 1);
    fs::write(&target, next.as_bytes()).map_err(|error| format!("无法写入文件：{error}"))?;
    Ok(WorkspaceEditFileResult {
        path: display_relative(&root, &target),
        replacements: 1,
        bytes_written: next.len(),
    })
}

pub fn search_files(
    cwd: String,
    path: Option<String>,
    pattern: Option<String>,
    query: Option<String>,
    max_results: Option<usize>,
) -> Result<WorkspaceSearchFilesResult, String> {
    let root = resolve_cwd(&cwd)?;
    let start = resolve_existing_path(&root, Some(path.as_deref().unwrap_or(".")))?;
    if !start.is_dir() {
        return Err(format!("路径不是目录：{}", display_relative(&root, &start)));
    }
    let limit = max_results.unwrap_or(100).clamp(1, 500);
    let query = query.filter(|value| !value.trim().is_empty());
    let pattern = pattern.filter(|value| !value.trim().is_empty());
    let mut matches = Vec::new();
    let mut truncated = false;
    collect_search_matches(
        &root,
        &start,
        pattern.as_deref(),
        query.as_deref(),
        limit,
        &mut matches,
        &mut truncated,
    )?;
    matches.sort();
    Ok(WorkspaceSearchFilesResult {
        query,
        pattern,
        matches,
        truncated,
    })
}

fn collect_search_matches(
    root: &Path,
    directory: &Path,
    pattern: Option<&str>,
    query: Option<&str>,
    limit: usize,
    matches: &mut Vec<String>,
    truncated: &mut bool,
) -> Result<(), String> {
    if matches.len() >= limit {
        *truncated = true;
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(|error| format!("无法读取目录：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取目录项：{error}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if matches!(name.as_str(), ".git" | "node_modules" | "target" | "dist") {
                continue;
            }
            collect_search_matches(root, &path, pattern, query, limit, matches, truncated)?;
            if *truncated {
                return Ok(());
            }
            continue;
        }
        if !path.is_file() || !matches_pattern(&name, pattern) {
            continue;
        }
        if let Some(needle) = query {
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            if !content.contains(needle) {
                continue;
            }
        }
        matches.push(display_relative(root, &path));
    }
    Ok(())
}

fn matches_pattern(name: &str, pattern: Option<&str>) -> bool {
    let Some(pattern) = pattern else {
        return true;
    };
    let pattern = pattern.trim();
    if pattern == "*" {
        return true;
    }
    if let Some(extension) = pattern.strip_prefix("*.") {
        return name.ends_with(&format!(".{extension}"));
    }
    name == pattern
}

fn resolve_cwd(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err(String::from("工作目录不能为空"));
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!("工作目录不存在：{trimmed}"));
    }
    if !path.is_dir() {
        return Err(format!("工作目录不是文件夹：{trimmed}"));
    }
    fs::canonicalize(&path).map_err(|error| format!("无法解析工作目录：{error}"))
}

fn resolve_existing_path(root: &Path, relative: Option<&str>) -> Result<PathBuf, String> {
    let candidate = join_within(root, relative.unwrap_or("."))?;
    if !candidate.exists() {
        return Err(format!(
            "路径不存在：{}",
            display_relative(root, &candidate)
        ));
    }
    let canonical =
        fs::canonicalize(&candidate).map_err(|error| format!("无法解析路径：{error}"))?;
    ensure_within(root, &canonical)?;
    Ok(canonical)
}

fn resolve_writable_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = join_within(root, relative)?;
    if candidate.exists() {
        let canonical =
            fs::canonicalize(&candidate).map_err(|error| format!("无法解析路径：{error}"))?;
        ensure_within(root, &canonical)?;
        return Ok(canonical);
    }

    // Walk up to the nearest existing ancestor, then rebuild the path under cwd.
    let mut ancestor = candidate
        .parent()
        .ok_or_else(|| String::from("无效的文件路径"))?
        .to_path_buf();
    let mut suffix = vec![candidate
        .file_name()
        .ok_or_else(|| String::from("无效的文件名"))?
        .to_os_string()];

    while !ancestor.exists() {
        ensure_lexical_within(root, &ancestor)?;
        let name = ancestor
            .file_name()
            .ok_or_else(|| String::from("路径越出工作区"))?
            .to_os_string();
        suffix.push(name);
        ancestor = ancestor
            .parent()
            .ok_or_else(|| String::from("路径越出工作区"))?
            .to_path_buf();
    }

    let ancestor_canon =
        fs::canonicalize(&ancestor).map_err(|error| format!("无法解析父目录：{error}"))?;
    ensure_within(root, &ancestor_canon)?;

    let mut resolved = ancestor_canon;
    for part in suffix.into_iter().rev() {
        resolved.push(part);
    }
    ensure_lexical_within(root, &resolved)?;
    Ok(resolved)
}

fn join_within(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let trimmed = relative.trim();
    if trimmed.is_empty() || trimmed == "." {
        return Ok(root.to_path_buf());
    }

    let relative_path = Path::new(trimmed);
    if relative_path.is_absolute() {
        if root == Path::new("/") {
            return Ok(relative_path.to_path_buf());
        }
        return Err(String::from("不允许使用绝对路径，请传入相对工作区的路径"));
    }

    let mut normalized = root.to_path_buf();
    for component in relative_path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() || !normalized.starts_with(root) {
                    return Err(String::from("路径越出工作区"));
                }
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => {
                return Err(String::from("不允许使用绝对路径，请传入相对工作区的路径"));
            }
        }
    }

    ensure_lexical_within(root, &normalized)?;
    Ok(normalized)
}

fn ensure_within(root: &Path, path: &Path) -> Result<(), String> {
    if path == root || path.starts_with(root) {
        return Ok(());
    }
    Err(format!("路径越出工作区：{}", path.display()))
}

fn ensure_lexical_within(root: &Path, path: &Path) -> Result<(), String> {
    if path == root || path.starts_with(root) {
        return Ok(());
    }
    Err(format!("路径越出工作区：{}", path.display()))
}

fn display_relative(root: &Path, path: &Path) -> String {
    if root == Path::new("/") {
        return path.to_string_lossy().replace('\\', "/");
    }
    if path == root {
        return String::from(".");
    }
    path.strip_prefix(root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
}
