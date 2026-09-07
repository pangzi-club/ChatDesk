---
name: skill-creator
description: 为 ChatDesk 创建或改写本机 SKILL.md。用户说要写 skill、新建技能、改现有 skill、skill-creator、如何编写 SKILL.md、把工作流做成可复用 skill 时使用。
---

# 创建 ChatDesk Skill

先读本文件。写 frontmatter 或目录约定时再读 `references/writing.md`。

## ChatDesk 约束

- 本机 skill 启用后，**整份 SKILL.md 会注入每一轮对话**。保持精简；能不写的不要写。
- ChatDesk 只把 `SKILL.md` 注入上下文，不会自动加载 `references/`。核心流程写进 SKILL.md。
- 不要写 README、changelog、安装说明。
- 不要把已有工具（Plan Mode、终端、生图、浏览器）再包成 skill。

## 流程

1. 用 1–2 个问题确认：做什么、用户会怎么说、要不要改现有 skill。
2. 目录名：小写字母、数字、连字符，与 `name` 一致。
3. 调用 `create_skill`，传入 `name`、`description` 和不含 frontmatter 的 Markdown `body`。工具固定写到 `$HOME/.agents/skills/<name>/SKILL.md`，自动生成 frontmatter。
4. `description` 必须包含用途和触发语。同名目录会报冲突，不会覆盖；与用户确认新名称。修改已有 skill 不属于该工具能力，不要用创建操作覆盖。
5. 告诉用户启用步骤，不要代为打开开关：Settings → Skills → 刷新。新 skill 默认启用，可在 Chat 工具栏按会话临时关闭。

Ask 模式的创建操作走工具审批，计划模式不提供创建工具。不要通过普通文件工具或 Bash 重试被拒绝的创建操作。

## 参考

- 写法与模板：`read_skill`，`skillId` 为 `builtin:skill-creator`，`path` 为 `references/writing.md`
