# Session 级工具权限规则设计

本文定义 ChatDesk 后续实现的 Session 级工具权限规则。它是目标设计，不代表当前版本已经支持这些行为。现有沙箱实现及当前行为见 [AI SDK 与 Seatbelt 沙箱](aisdk-seatbelt-sandbox.md)。

## 1. 目标与边界

权限规则用于回答“当前工具调用是否需要用户确认”，并为同一个 ChatDesk Session 记住用户明确允许或拒绝的操作。

权限规则不能替代操作系统沙箱：

- `allow` 只跳过应用层的人工审批，不放宽 Seatbelt 的文件系统或网络限制；
- 命令获准执行后，仍可能被 workspace 边界、Seatbelt、网络策略或操作系统拒绝；
- 普通命令失败不会被误判为权限拒绝，也不会自动扩大权限；
- `full` 模式仍是显式取消受限沙箱的独立选择，不能通过一条 `allow` 规则实现。

## 2. 权限文件

每个 Session 使用独立的权限文件：

```text
<chat-server-dataDir>/sessions/<session-id>/permission.json
```

macOS 生产环境的默认路径是：

```text
~/.chatdesk/chat-server/sessions/<session-id>/permission.json
```

如果设置了 `CHAT_SERVER_DATA_DIR`，则使用该目录作为 `<chat-server-dataDir>`。开发环境未覆盖数据目录时，对应路径通常是：

```text
<repository>/.data/chat-server/sessions/<session-id>/permission.json
```

权限文件与 `meta.json`、`messages.jsonl` 位于同一个 Session 目录。Session 删除时，现有 `SessionStore` 会递归删除整个目录，因此权限文件也随之删除。

文件只对路径中的 `<session-id>` 生效，不按 workspace 共享。重新打开应用或恢复同一个 Session 时继续使用；新建 Session 不继承旧 Session 的规则。

### 2.1 文件格式

```json
{
  "version": 1,
  "allow": [
    "Bash(npm run *)",
    "Bash(git commit *)",
    "Read(src/**)"
  ],
  "ask": ["Bash(git push *)"],
  "deny": [
    "Read(.env)",
    "Bash(rm -rf *)",
    "mcp__*"
  ]
}
```

缺少 `permission.json` 等价于三个规则数组均为空。读取到无法解析的 JSON、未知版本或非法规则时，应安全失败并提示用户修复配置，不能降级为自动放行。

写入应使用同目录临时文件加原子 `rename`，避免进程中断留下半写入文件。Session ID 必须复用 `SessionStore` 的安全 ID 校验，禁止通过路径片段逃逸出 `sessions` 目录。

## 3. 规则模型

规则分为三类：

- `allow`：跳过人工审批，直接进入受限工具执行；
- `ask`：必须进入当前模式对应的审批流程；
- `deny`：在工具执行前拒绝调用。

同一次工具调用可能匹配多条规则，固定优先级为：

```text
deny > ask > allow
```

规则的具体程度不能推翻优先级。例如 `Bash(git push origin main)` 即使出现在 `allow` 中，只要同时命中 `Bash(git push *)` 的 `deny`，仍必须拒绝。

规则采用 `Tool` 或 `Tool(specifier)` 形式。`*` 匹配任意长度文本；路径中的 `**` 可以跨目录层级。规则匹配必须由应用代码强制执行，不能依赖 System Prompt。

### 3.1 工具映射

| 规则工具 | ChatDesk 工具 | 匹配内容 |
| --- | --- | --- |
| `Bash(...)` | `bash` | 完整命令或拆分后的子命令 |
| `Read(...)` | `list_dir`、`search_files`、`read_file` | 规范化后的目标路径 |
| `Edit(...)` | `write_file`、`edit_file`、`apply_patch` | 规范化后的目标路径 |
| `WebSearch` | `web_search` | 整个工具调用 |
| `mcp__<server>__<tool>` | MCP 工具 | MCP canonical tool name |

`Read` 规则不授予写入权限，`Edit` 规则也不隐式授予读取敏感文件的权限。结构化文件工具必须在路径规范化和符号链接检查后再匹配规则。

Bash 复合命令应按 `&&`、`||`、`;`、管道和换行等 Shell 运算符拆分，并分别判断。任一子命令命中 `deny` 时，整次工具调用不得执行。不能只匹配命令字符串来替代 Seatbelt，因为脚本、解释器和子进程可以产生规则文本未直接表达的副作用。

## 4. 权限模式

### 4.1 Ask for approval (`ask`)

工具调用先匹配当前 Session 的 `permission.json`：

1. 命中 `deny`：立即拒绝，不提供临时绕过按钮；
2. 命中 `allow`：跳过人工审批，进入受限执行；
3. 命中 `ask` 或没有匹配规则：创建现有的 `approval-requested` 状态并等待用户选择。

审批界面提供三个主要操作：

| 操作 | 当前调用 | 写入 `permission.json` | 后续调用 |
| --- | --- | --- | --- |
| 单次允许 | 执行 | 否 | 重新判断 |
| Session 允许 | 执行 | 写入当前 Session 的 `allow` | 匹配调用直接执行 |
| 拒绝 | 不执行 | 否 | 重新判断 |

“Session 允许”跨应用重启保留，但只作用于同一个 Session ID。界面可另提供“拒绝并记住”，将规范化规则写入当前 Session 的 `deny`；它不是三个主要操作之一。

保存规则时应展示将要写入的确切规则，避免把一条具体命令无意扩展为过宽的通配规则。复合命令需要为各个获准子命令生成独立规则。

### 4.2 Approve for me (`auto`)

`auto` 模式的固定顺序是：

1. 读取当前 Session 的 `permission.json`；
2. 命中 `deny` 时直接拒绝；
3. 命中 `allow` 时直接进入受限执行；
4. 命中 `ask` 或没有匹配规则时，调用自动 Reviewer 判断当前 tool call；
5. Reviewer 批准时仅允许当前 tool call，Reviewer 拒绝、不可用或调用失败时返回权限错误。

Reviewer 的决定默认不写入 `permission.json`。只有用户主动选择持久化操作，才能建立跨调用权限。Reviewer 本身不能执行工具，相关模型调用必须通过既有 AI usage persistence 记录 provider、model 以及输入、输出、缓存和 reasoning token usage。

### 4.3 Full access (`full`)

`full` 保留当前完整访问模式语义，不触发 Session 权限审批，也不根据工具调用自动新增规则。界面必须继续明确提示该模式会取消受限沙箱，避免用户把它误解为普通 `allow`。

## 5. 权限拒绝与命令失败

权限判定发生在命令执行前；命令失败发生在用户或规则已经允许执行之后。两者必须使用不同状态和提示。

### 5.1 尚未获得权限

在 `ask` 模式中，`npm install` 没有匹配规则时显示：

```text
请求执行：npm install
该操作没有匹配的 Session 权限规则。

[单次允许] [Session 允许] [拒绝]
```

`Bash(git push *)` 位于 `ask` 时，`git push origin main` 显示相同的三个操作，并说明命中了哪条规则。

命中 `deny` 时显示拒绝原因和规则来源，例如：

```text
未执行：git push origin main
当前 Session 的权限规则拒绝了该操作：Bash(git push *)
```

### 5.2 获准后执行失败

用户允许 `npm install` 后，如果出现依赖冲突、registry 错误或普通非零退出码，应显示为命令失败：

```text
npm install 执行失败，退出码 1
npm error unable to resolve dependency tree
```

用户允许 `git push` 后，如果远端拒绝推送，应显示 Git 的执行错误：

```text
git push 执行失败，退出码 1
! [rejected] main -> main (non-fast-forward)
```

普通失败不再次弹出权限提示。只有错误被可靠分类为 Seatbelt、workspace 边界或网络沙箱拦截时，才进入现有的一次性沙箱升级审批或 Reviewer 流程。批准后的重试如果仍失败，应作为普通命令失败处理。

## 6. 与 Seatbelt 的协作

权限规则位于应用审批层，Seatbelt 位于系统执行层。完整顺序为：

```text
模型生成工具调用
  -> 匹配当前 Session 权限规则
  -> 人工审批或自动 Reviewer
  -> 路径与输入校验
  -> Seatbelt 受限执行
  -> 返回成功、普通失败或沙箱拒绝
```

`allow` 只能越过流程中的人工审批步骤。它不能：

- 访问 workspace 或只读白名单之外的文件；
- 自动开放网络；
- 修改 Seatbelt profile 中未放行的路径；
- 把普通命令失败重新解释为提权请求；
- 绕过工具输入 Schema、路径规范化或符号链接检查。

## 7. 后续实现契约

### 7.1 Agent Core

- 新增 Session 级 `PermissionStore`，通过 `dataDir + sessionId` 定位文件；
- 新增纯函数规则解析器和决策器，返回 `allow`、`ask`、`deny` 或 `unmatched`；
- 在所有 workspace、Bash 和 MCP 工具执行前统一判定；
- 将规则命中、人工决定和 Reviewer 决定写入现有可审计日志；
- 保持 Reviewer AI 调用的 token usage 完整记账。

### 7.2 Chat Server API

API 以 Session 为资源边界：

```text
GET    /v1/sessions/:sessionId/permissions
PUT    /v1/sessions/:sessionId/permissions
POST   /v1/sessions/:sessionId/permissions/rules
DELETE /v1/sessions/:sessionId/permissions/rules/:ruleId
```

服务端必须确认 Session 存在并校验 Session ID。API 返回规范化规则及格式错误，不能允许客户端提交任意文件路径。

### 7.3 Desktop UI

- 在当前 Session 的权限管理入口中区分 `allow`、`ask` 和 `deny`；
- 初次加载使用与规则列表布局匹配的 skeleton，并用 React Query 管理请求、缓存和 mutation；
- 审批条显示完整工具名、命令或目标路径，以及命中的规则；
- “Session 允许”保存成功后再恢复工具执行；保存失败时保持待审批状态并显示错误；
- 删除规则等破坏性操作使用共享 `AlertDialog`；
- 设置搜索必须包含新增权限页面的当前名称与关键词。

## 8. 验收标准

- 每个 Session 的规则只存在于自己的 `sessions/<session-id>/permission.json`；
- “单次允许”不写文件，“Session 允许”写入并在恢复同一 Session 后继续生效；
- 新 Session 不继承其他 Session 的规则，删除 Session 不留下权限文件；
- `deny > ask > allow` 在 Bash、文件工具和 MCP 工具中一致执行；
- `auto` 先查规则，未命中才调用 Reviewer，Reviewer 结果默认不落盘；
- `allow` 无法绕过 Seatbelt、workspace 边界或网络限制；
- 权限拒绝、普通命令失败和沙箱拒绝在协议、日志和 UI 中保持不同状态。
