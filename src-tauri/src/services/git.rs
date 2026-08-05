use std::path::Path;
use std::process::Command;

use crate::models::workspace::{WorkspaceCommit, WorkspaceGitInfo, WorkspaceGitStatus};

pub fn inspect_workspace(path: &str) -> WorkspaceGitInfo {
    let root = Path::new(path);
    if !root.is_dir() {
        return WorkspaceGitInfo {
            path_exists: false,
            is_repository: false,
            status: None,
            commits: Vec::new(),
            error: Some("项目目录不存在或不可访问".to_owned()),
        };
    }

    let status = Command::new("git")
        .args(["status", "--short", "--branch"])
        .current_dir(root)
        .output();
    let Ok(status_output) = status else {
        return unavailable("无法执行 git，请确认 Git 已安装", true);
    };
    if !status_output.status.success() {
        return WorkspaceGitInfo {
            path_exists: true,
            is_repository: false,
            status: None,
            commits: Vec::new(),
            error: None,
        };
    }

    let status = parse_status(&String::from_utf8_lossy(&status_output.stdout));
    let log_output = Command::new("git")
        .args([
            "log",
            "-10",
            "--date=iso-strict",
            "--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s",
        ])
        .current_dir(root)
        .output();
    let commits = log_output
        .ok()
        .filter(|output| output.status.success())
        .map(|output| parse_commits(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default();

    WorkspaceGitInfo {
        path_exists: true,
        is_repository: true,
        status: Some(status),
        commits,
        error: None,
    }
}

fn unavailable(message: &str, path_exists: bool) -> WorkspaceGitInfo {
    WorkspaceGitInfo {
        path_exists,
        is_repository: false,
        status: None,
        commits: Vec::new(),
        error: Some(message.to_owned()),
    }
}

fn parse_status(output: &str) -> WorkspaceGitStatus {
    let mut branch = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut staged = 0;
    let mut modified = 0;
    let mut untracked = 0;
    let mut conflicted = 0;

    for (index, line) in output.lines().enumerate() {
        if index == 0 && line.starts_with("## ") {
            let tracking = line.trim_start_matches("## ");
            let mut parts = tracking.split("...");
            branch = Some(
                parts
                    .next()
                    .unwrap_or(tracking)
                    .split(" [ahead")
                    .next()
                    .unwrap_or(tracking)
                    .to_owned(),
            );
            if let Some(details) = tracking
                .split_once(" [")
                .map(|(_, value)| value.trim_end_matches(']'))
            {
                for item in details.split(", ") {
                    let mut values = item.split_whitespace();
                    let kind = values.next().unwrap_or_default();
                    let count = values
                        .next()
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(0);
                    if kind == "ahead" {
                        ahead = count;
                    }
                    if kind == "behind" {
                        behind = count;
                    }
                }
            }
            continue;
        }
        let bytes = line.as_bytes();
        if bytes.len() < 2 {
            continue;
        }
        let index_status = bytes[0] as char;
        let worktree_status = bytes[1] as char;
        if index_status == '?' && worktree_status == '?' {
            untracked += 1;
            continue;
        }
        if index_status == 'U'
            || worktree_status == 'U'
            || (index_status == 'A' && worktree_status == 'A')
        {
            conflicted += 1;
            continue;
        }
        if index_status != ' ' {
            staged += 1;
        }
        if worktree_status != ' ' {
            modified += 1;
        }
    }

    WorkspaceGitStatus {
        is_repository: true,
        branch,
        ahead,
        behind,
        staged,
        modified,
        untracked,
        conflicted,
        clean: staged == 0 && modified == 0 && untracked == 0 && conflicted == 0,
    }
}

fn parse_commits(output: &str) -> Vec<WorkspaceCommit> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\u{1f}').collect();
            if fields.len() < 5 {
                return None;
            }
            Some(WorkspaceCommit {
                hash: fields[0].to_owned(),
                short_hash: fields[1].to_owned(),
                author: fields[2].to_owned(),
                date: fields[3].to_owned(),
                subject: fields[4..].join("\u{1f}"),
            })
        })
        .collect()
}
