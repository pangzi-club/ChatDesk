# Seabelt

> **⚠️ 本文档为早期原型草稿，不再反映当前实现。**
>
> 以下示例使用 `(allow default)` profile 和登录 shell（`-lc`），与生产环境不一致。
> 当前实现位于 `apps/server/src/sandbox-exec.ts`，使用 `(deny default)` profile、
> 非登录 shell（`-c`）、最小化环境变量和独立的缓存目录。如需了解实际沙箱策略，
> 请参阅 `docs/aisdk-seatbelt-sandbox.md` 和 `docs/agent-sandbox-permission-controls.md`。
>
> 本文档保留仅用于记录 Seatbelt 的基础概念，**不要将以下代码用于生产环境**。

## 早期原型示例

```js
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function runInSeatbelt(shellCommand, { cwd, network = false } = {}) {
  const workspace = fs.realpathSync(cwd ?? process.cwd());
  const tmp = fs.realpathSync(os.tmpdir());
  const escape = (p) => p.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

  const rules = [
    "(version 1)",
    "(allow default)",
    `(deny file-write* (require-not (require-any (subpath "${escape(workspace)}") (subpath "${escape(tmp)}") (subpath "/dev/null") (subpath "/dev/tty"))))`,
    network ? "" : "(deny network*)",
  ]
    .filter(Boolean)
    .join(" ");

  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/sandbox-exec",
      ["-p", rules, process.env.SHELL ?? "/bin/sh", "-lc", shellCommand],
      { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
    child.on("error", reject);
  });
}

// 工作区内可写，工作区外写会失败
const r = await runInSeatbelt("echo hi > ./ok.txt; echo bye > ~/blocked.txt", {
  cwd: "/tmp/my-workspace",
});
console.log(r);
```
