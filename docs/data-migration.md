# 本地数据迁移

ChatDesk 不会在启动时扫描或改写旧版数据目录。需要迁移时，从仓库根目录使用统一入口：

```sh
pnpm migrate
pnpm migrate <command> -- --apply
```

默认只预览，不会写入文件。确认输出后再加 `--apply`。请勿把含 API key 的数据目录提交到版本库。

## 命令

| 命令 | 作用 | 默认目标 |
| --- | --- | --- |
| `chatdesk` | 把旧版数据目录复制到当前布局 | `~/.chatdesk` |
| `jsonl` | 把存量 `session.json` 拆成 `meta.json` 与 `messages.jsonl` | `CHAT_SERVER_DATA_DIR` 或 `~/.chatdesk/chat-server` |
| `default-workspace` | 为无 `cwd` 的 Default 会话绑定独立工作目录 | 同上 |
| `dedupe` | 清理会话里重复的 assistant 消息 | 同上 |

查看某个命令的参数：

```sh
pnpm migrate chatdesk -- --help
```

## 推荐顺序

从更早的应用布局升级时，按这个顺序执行：

```sh
pnpm migrate chatdesk -- --apply
pnpm migrate jsonl -- --apply
pnpm migrate default-workspace -- --apply
```

`dedupe` 是可选的数据清理，不依赖前三步是否刚执行过：

```sh
pnpm migrate dedupe -- --apply
```

每一步都可以先不加 `--apply` 预览。目标目录已有不同内容时，`chatdesk` 会跳过冲突文件，不会覆盖现有数据。`chatdesk --apply` 会在目标目录写入 `.migration-v1.json`，记录本次新增文件和设置备份；重复执行不会再次改写数据。

## 各命令说明

### `chatdesk`

复制旧版目录到 `~/.chatdesk`，并规范化会话、归档和设置文件布局。默认会查找：

- 仓库内的 `.data/chat-server`
- macOS 旧版 `~/Library/Application Support/org.bohao.mdashboard`
- 环境变量 `M_DASHBOARD_LEGACY_CHAT_DIR` 指向的目录

也可以显式指定来源和目标：

```sh
pnpm migrate chatdesk -- --source <旧目录> --target ~/.chatdesk --apply
```

撤销最近一次由 `chatdesk` 脚本执行的迁移：

```sh
pnpm migrate chatdesk -- --target ~/.chatdesk --rollback
```

回滚只删除 manifest 中记录的本次新增文件，并恢复迁移前备份的设置。目标目录原有文件和迁移时跳过的冲突文件不会被删除。manifest 会记录内容哈希；本次新增文件或备份在迁移后发生变化时，回滚会在删除任何文件前停止。迁移异常中断时保留 `in-progress` manifest，修复磁盘或权限问题后先执行回滚，再重新迁移。

### `jsonl`

当前会话格式是每个会话目录一份 `meta.json`（不含消息）和一份 `messages.jsonl`（每行一条消息）。存量 `session.json` 需要拆分后删除原文件。已同时存在 `meta.json` 与 `messages.jsonl` 的目录会跳过。

```sh
pnpm migrate jsonl -- --target ~/.chatdesk/chat-server --apply
```

### `default-workspace`

没有 `workspaceId` / `cwd` 的 Default 会话会被绑定到 `~/.chatdesk/tasks/<session-id>`，并写入 `workspaces.json` 中的 Default Workspace。已绑定项目工作区的会话不会改动。

```sh
pnpm migrate default-workspace -- --target ~/.chatdesk/chat-server --apply
```

### `dedupe`

扫描 `messages.jsonl`，合并相邻的重复 assistant 回复。实际写入时会把变更前的文件备份为 `messages.jsonl.before-dedupe`。

```sh
pnpm migrate dedupe -- --target ~/.chatdesk/chat-server --apply
```

## 测试

迁移脚本使用 Node 自带的 test runner，由根目录的 `pnpm test` 一并执行：

```sh
node --test scripts/*.test.mjs
```
