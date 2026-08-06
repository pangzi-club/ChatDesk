# Seabelt

## Example 

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
