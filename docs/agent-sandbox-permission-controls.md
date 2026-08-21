# Agent 执行任意命令时，沙箱应该限制什么

当 Agent 获得执行 Bash 命令的能力后，安全设计的重点不应是判断某条命令“是否危险”，而应是限制命令执行后能够访问的资源。可靠的方案通常由工具权限、操作系统沙箱、用户审批和资源限制共同组成。

## 1. Seatbelt 可以限制哪些权限

Seatbelt 是 macOS 的系统级沙箱机制，可以针对子进程限制多类操作：

- 文件系统：读取、写入、创建和删除文件，以及可访问的目录范围；
- 网络：建立出站连接、监听端口和接受入站连接；
- 进程：启动程序、派生子进程，以及部分进程间操作；
- 系统接口：Mach 服务、IOKit、部分设备和系统服务；
- IPC：部分 Unix Socket 和进程间通信。

实际可用的操作名称和过滤条件取决于系统版本，而且 Apple 没有提供完整、稳定的公开接口文档。`sandbox-exec` 也已被标记为 deprecated，因此它适合特定的 macOS 本地隔离场景，但不应被当作跨平台沙箱方案。

一种常见策略是默认允许一般操作，只收紧文件写入和网络：

```text
(version 1)
(allow default)

(deny file-write*
  (require-not
    (require-any
      (subpath "<workspace>")
      (subpath "<private-tmp>")
      (subpath "/dev/null"))))

(deny network*)
```

这类策略可以阻止命令写入工作区之外的位置，并在需要时关闭网络。但由于 `(allow default)` 仍允许较广泛的文件读取，它不适合直接处理高度不可信的代码。更严格的场景还需要限制读取范围，只放行工作区、必要的系统二进制、动态链接库和私有临时目录。

## 2. 如何安全地执行任意 Bash 命令

“任意 Bash 命令”只能表示命令语法和程序选择不受限制，不能表示命令拥有任意权限。推荐的执行链路是：

```text
Agent
  → run_shell 工具
  → 必要时请求用户确认
  → 启动受限的 Bash 子进程
  → 操作系统沙箱限制文件和网络
  → 超时与资源限制
  → 返回退出码、标准输出和标准错误
```

启动进程时，应通过参数传递命令，避免将整个 `sandbox-exec` 调用再次拼接到外层 Shell：

```bash
sandbox-exec -p "$PROFILE" \
  /bin/bash --noprofile --norc -c "$COMMAND"
```

除了 Seatbelt，还需要补充以下限制：

- 设置执行超时，超时后终止整个进程组；
- 限制 CPU、内存、进程数和打开文件数；
- 限制 stdout 与 stderr 的最大长度；
- 使用每次执行独立的临时目录；
- 清理 API Key、Token、代理地址等环境变量；
- 保留真实 `HOME`；默认沙箱靠 Seatbelt 限制家目录读写，不另造隔离主目录；
- 把包管理器缓存指到系统临时目录下的隔离路径，避免写入失败或弄脏工作区；
- 固定 `PATH`；
- 使用 `--noprofile --norc`，避免加载 Shell 启动文件；
- 对高风险操作展示完整命令并请求确认。

例如，可以为子进程设置最小化环境：

```text
HOME=<real-home>
TMPDIR=$TMPDIR/chatdesk-sandbox-cache-<workspace-hash>/tmp
npm_config_cache=$TMPDIR/chatdesk-sandbox-cache-<workspace-hash>/npm
PATH=/usr/bin:/bin
```

### 本地开发工具的按需引导

ChatDesk 不应在启动时静默读取用户的完整登录 Shell 环境。受限终端实际返回
`command not found`，且缺失命令属于开发工具白名单时，聊天界面才显示环境引导。

用户可以关闭提示或前往“设置 > 环境”手动配置。选择导入时必须先确认一次；确认后才启动一次
登录 Shell。导入过程只提取白名单工具的绝对可执行路径，不持久化其他环境变量、Token 或 API
Key。导入的目录只作为只读执行路径加入沙箱，不能扩大 workspace 的写入范围，也不能隐式开放网络。

仅过滤 `rm`、`curl`、`sudo` 等命令名称并不可靠。命令可以通过脚本、解释器、符号链接或其他工具产生相同的副作用，真正的边界必须由操作系统强制执行。

## 3. AI SDK 应该负责什么

AI SDK 的工具系统适合定义 Agent 的能力边界：

- 只注册必要的工具，例如 `list_dir`、`read_file`、`write_file` 和 `run_shell`；
- 用输入 Schema 限制工具参数；
- 对相对路径做规范化，阻止 `..` 和符号链接逃逸；
- 在写文件或运行高风险命令前暂停工具调用，等待用户审批；
- 设置工具调用步数上限，避免模型陷入循环；
- 将明确的失败原因返回给模型，使其能够调整执行方式。

工具审批与操作系统沙箱解决的是不同问题：

- 审批决定某项操作是否应该开始；
- 沙箱限制操作开始后实际能够影响的范围。

即使用户批准了一条命令，命令也不应因此获得宿主机的完全权限。

## 4. Codex 和 Claude Code 的典型做法

### Codex

Codex 本地 Agent 默认采用工作区写入模式：

- 可以读取文件、执行本地命令；
- 写入通常限制在当前工作区和指定的可写目录；
- `.git`、`.agents`、`.codex` 等敏感路径保持只读；
- 命令及其子进程默认不能访问网络；
- 网络开启后，可以通过代理按目标域名进一步限制；
- 写入工作区之外或访问网络时，需要申请提升权限；
- 还提供只读模式和取消沙箱限制的完全访问模式。

Codex 将沙箱边界和审批策略分开：前者决定操作在技术上能做什么，后者决定何时必须暂停并征求用户同意。

本地实现根据平台使用不同的系统机制：

- macOS：Seatbelt；
- Linux：Bubblewrap 与 seccomp；
- Windows：受限令牌等原生机制。

参考：[Codex Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)

### Claude Code

Claude Code 的内置 Bash 沙箱主要限制 Bash 命令及其子进程：

- 默认只能写当前工作目录和会话临时目录；
- 可配置额外的读写白名单和黑名单；
- 可保护凭证文件和敏感环境变量；
- 网络通过代理按域名放行；
- 新域名可以触发用户确认，也可以启用严格白名单；
- 可禁止命令失败后申请脱离沙箱重新执行。

其本地实现为：

- macOS：Seatbelt；
- Linux 和 WSL2：Bubblewrap，并通过代理控制网络；
- 原生 Windows 暂不支持内置 Bash 沙箱。

需要特别注意：内置 Bash 沙箱默认只覆盖 Bash 及其子进程。内置文件工具、Hooks 和 MCP Server 不一定处于同一隔离边界内。要隔离整个 Agent，需要使用 Sandbox Runtime、容器或虚拟机。

参考：

- [Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Claude Code Sandbox environments](https://code.claude.com/docs/en/sandbox-environments)

## 5. 这些沙箱通常不能自动解决什么

不能默认 Coding Agent 的内置沙箱已经提供：

- 严格的 CPU、内存和进程数量限制；
- 对工作区内部文件的防删除或防篡改能力；
- 对宿主机所有敏感文件的读取隔离；
- 对 MCP Server、Hooks 和外部辅助进程的统一隔离；
- 虚拟机级别的内核与硬件边界。

工作区通常被视为 Agent 可以修改的区域，因此沙箱主要保护工作区之外的宿主系统，而不是保护工作区不被误删。

## 6. 推荐的分层模型

一套实用的 Agent 沙箱可以概括为：

```text
AI SDK 工具白名单
+ 路径规范化
+ 写入和高风险命令审批
+ Seatbelt / Bubblewrap 文件系统隔离
+ 网络出口白名单
+ 凭证与环境变量清理
+ 超时、资源和输出限制
```

对于日常本地开发，这种分层模型能在自动化效率和安全性之间取得较好平衡。对于不可信仓库、无人值守执行或允许跳过审批的场景，应将整个 Agent 放入容器或虚拟机，而不是只依赖单个 Bash 进程的沙箱。
