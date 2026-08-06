use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::models::sandbox::{
    WorkspaceDirEntry, WorkspaceListDirResult, WorkspaceReadFileResult, WorkspaceWriteFileResult,
};

pub fn list_dir(cwd: String, path: Option<String>) -> Result<WorkspaceListDirResult, String> {
    let root = resolve_cwd(&cwd)?;
    let target = resolve_existing_path(&root, Some(path.as_deref().unwrap_or(".")))?;
    if !target.is_dir() {
        return Err(format!("路径不是目录：{}", display_relative(&root, &target)));
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
        return Err(format!("路径不是文件：{}", display_relative(&root, &target)));
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
    if path == root {
        return String::from(".");
    }
    path.strip_prefix(root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().into_owned())
}
