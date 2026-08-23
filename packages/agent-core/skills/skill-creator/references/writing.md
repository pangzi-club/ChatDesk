# Skill 写法

## 目录

```
~/.agents/skills/<name>/
  SKILL.md
```

不要依赖 workspace 内的 `.agents/skills`，扫描只看用户主目录下的 `~/.agents/skills`。

## Frontmatter

只写这两行：

```yaml
---
name: invoice-extract
description: 从发票 PDF 或图片中抽取字段并输出表格。用户说提取发票、报销单、invoice 字段时使用。
---
```

- `name`：与目录名相同
- `description`：写清做什么，以及会说哪些话。触发信息只放这里，不要放正文

正文用祈使句，只写模型不知道的流程和约束。

## 篇幅

用户启用后全文进上下文。目标：SKILL.md 远小于 500 行，能压到一两屏最好。

## 不要做

- 不要加 `agents/openai.yaml` 或其它产品的 UI 元数据
- 不要为 ChatDesk 内置 skill（`chatdesk-doc` 等）写安装步骤
- 不要在 skill 里要求关闭安全、沙箱或审批
