import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export const commands = {
  chatdesk: {
    script: "migrate-to-chatdesk.mjs",
    summary: "把旧版数据目录复制到 ~/.chatdesk",
  },
  jsonl: {
    script: "migrate-sessions-to-jsonl.mjs",
    summary: "把 session.json 拆成 meta.json 与 messages.jsonl",
  },
  "default-workspace": {
    script: "migrate-default-workspace.mjs",
    summary: "为无 cwd 的 Default 会话绑定独立工作目录",
  },
  dedupe: {
    script: "dedupe-chat-sessions.mjs",
    summary: "清理会话中重复的 assistant 消息",
  },
};

export function printHelp() {
  const commandLines = Object.entries(commands)
    .map(([name, command]) => `  ${name.padEnd(20)}${command.summary}`)
    .join("\n");
  console.log(`用法：
  pnpm migrate <command> [-- <options>]

命令：
${commandLines}

常用选项：
  --apply              实际写入；默认只预览
  --target <dir>       目标数据目录
  -h, --help           显示帮助

示例：
  pnpm migrate
  pnpm migrate chatdesk -- --apply
  pnpm migrate jsonl -- --apply
  pnpm migrate default-workspace -- --apply
  pnpm migrate dedupe -- --target ~/.chatdesk/chat-server --apply

详见 docs/data-migration.md。`);
}

export function resolveCommand(argv) {
  const [command, ...args] = argv.filter((argument) => argument !== "--");
  if (!command || command === "-h" || command === "--help") {
    return { type: "help" };
  }
  if (!Object.hasOwn(commands, command)) {
    return { type: "unknown", command };
  }
  return { type: "run", command, args };
}

function main(argv = process.argv.slice(2)) {
  const resolved = resolveCommand(argv);
  if (resolved.type === "help") {
    printHelp();
    return 0;
  }
  if (resolved.type === "unknown") {
    console.error(`未知命令：${resolved.command}\n`);
    printHelp();
    return 1;
  }

  const script = path.join(scriptsDir, commands[resolved.command].script);
  const result = spawnSync(process.execPath, [script, ...resolved.args], { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  if (result.signal) return 1;
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
