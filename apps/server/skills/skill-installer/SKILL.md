---
name: skill-installer
description: 把外部 skill 安装到本机供 ChatDesk 扫描。用户说安装 skill、从 GitHub 装技能、skill-installer、克隆 SKILL.md、列出某个仓库里的 skill 时使用。
---

# 安装本机 Skill

先读本文件。解析 GitHub 地址或下载方式时再读 `references/github.md`。

## 目标位置

默认：`$HOME/.agents/skills/<name>/`

ChatDesk 也会扫描 `~/.codex/skills` 和 `~/.claude/skills`。用户指定了其中之一就用用户的。

## 流程

1. 确认来源：GitHub 目录 URL、`owner/repo` + 路径，或本地文件夹。没有来源就问，不要猜测 curated 目录。
2. 预览 `SKILL.md` 的 `name` / `description`，让用户确认后再写入。
3. 目标目录已存在则停止，除非用户明确要求覆盖。
4. 只复制 skill 目录（必须含 `SKILL.md`）。不要执行其中的 `scripts/`。
5. 装完后 **不要** 改 ChatDesk 的安装/启用开关。告诉用户：Settings → Skills → 刷新 → 安装 → Chat 工具栏启用。

第三方 skill 启用后会把整份 SKILL.md 注入对话。来源不明时先警告再装。

内置 skill（`chatdesk-doc`、`skill-creator`、`skill-installer`）已经随应用提供，不必安装。

若沙箱拦住写入家目录，申请批准或改让用户自己保存。

## 参考

- GitHub 拉取：`read_skill`，`skillId` 为 `builtin:skill-installer`，`path` 为 `references/github.md`
