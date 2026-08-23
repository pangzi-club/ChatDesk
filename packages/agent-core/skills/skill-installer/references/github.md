# 从 GitHub 拉取 Skill

## 识别目录

Skill 是「含 `SKILL.md` 的文件夹」，不是整个仓库根。

支持的输入：

- `https://github.com/owner/repo/tree/<ref>/<path-to-skill>`
- `owner/repo` 加上仓库内路径
- 用户给出的本地目录

列出某路径下的 skill：用 GitHub Contents API 看子目录，再检查是否有 `SKILL.md`。

```text
https://api.github.com/repos/<owner>/<repo>/contents/<path>?ref=<ref>
```

## 下载

公开库优先：

1. 下载该目录的 `SKILL.md`（及同目录的 `references/`、`scripts/`、`assets/`）
2. 或 `git clone --depth 1 --filter=blob:none --sparse` 后 checkout 该路径

不要 `git clone` 整个大仓库除非用户同意。私有库用已有 git 凭证或 `GH_TOKEN`；失败就说明缺权限。

## 校验

复制前确认：

- 存在 `SKILL.md`
- 有 `name:` 和 `description:`
- 目录名是小写、数字、连字符

写入 `$HOME/.agents/skills/<name>/`。`<name>` 默认用源目录名，用户指定了再用指定名。
