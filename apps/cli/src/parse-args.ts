export const USAGE = `用法:
  chatdesk
  chatdesk -i [--model <id>] [--cwd <path>]
  chatdesk -p <prompt> [--model <id>] [--cwd <path>] [-v]

选项:
  -i, --interactive     进入交互模式（无参数时默认）
  -p, --prompt <text>   发送一条消息并打印最终回答
  -v, --verbose         非交互模式把运行摘要写到 stdout
  --model <id>          指定模型 id 或名称（默认使用桌面里的默认模型）
  --cwd <path>          指定 workspace 目录（默认当前工作目录）
                        桌面端运行时自动复用桌面端 Chat Server 和配置
                        默认启用 web_search 和 web_fetch；web_search 需要支持 Responses API 的模型
  -h, --help            显示帮助

交互模式退出:
  :q, :quit, :exit      退出
  Ctrl-C, Ctrl-D        停止当前运行并退出`;

export type ParsedInteractiveArgs = {
  ok: true;
  help: false;
  interactive: true;
  verbose: boolean;
  model?: string;
  cwd?: string;
};

export type ParsedPromptArgs = {
  ok: true;
  help: false;
  interactive: false;
  prompt: string;
  verbose: boolean;
  model?: string;
  cwd?: string;
};

export type ParsedArgs =
  | { ok: true; help: true }
  | ParsedInteractiveArgs
  | ParsedPromptArgs
  | { ok: false; error: string };

function takeValue(
  argv: string[],
  index: number,
  flag: string,
): { error: string } | { value: string; nextIndex: number } {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    return { error: `参数 ${flag} 需要值\n${USAGE}` };
  }
  return { value, nextIndex: index + 1 };
}

function isFlag(arg: string, short: string, long: string) {
  return arg === short || arg === long || arg.startsWith(`${long}=`);
}

export function parseArgs(argv: string[]): ParsedArgs {
  let prompt: string | undefined;
  let model: string | undefined;
  let cwd: string | undefined;
  let help = false;
  let interactive = false;
  let verbose = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") continue;
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (isFlag(arg, "-i", "--interactive")) {
      interactive = true;
      continue;
    }
    if (isFlag(arg, "-v", "--verbose")) {
      verbose = true;
      continue;
    }
    if (arg === "-p" || arg === "--prompt") {
      const taken = takeValue(argv, index, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      prompt = taken.value;
      index = taken.nextIndex;
      continue;
    }
    if (arg.startsWith("--prompt=")) {
      prompt = arg.slice("--prompt=".length);
      continue;
    }
    if (arg === "--model") {
      const taken = takeValue(argv, index, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      model = taken.value;
      index = taken.nextIndex;
      continue;
    }
    if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
      continue;
    }
    if (arg === "--cwd") {
      const taken = takeValue(argv, index, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      cwd = taken.value;
      index = taken.nextIndex;
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
      continue;
    }
    return { ok: false, error: `未知参数：${arg}\n${USAGE}` };
  }

  if (help) return { ok: true, help: true };
  if (prompt !== undefined && interactive) {
    return { ok: false, error: `-p / --prompt 与 -i / --interactive 不能同时使用\n${USAGE}` };
  }
  const extras = {
    verbose,
    ...(model?.trim() ? { model: model.trim() } : {}),
    ...(cwd?.trim() ? { cwd: cwd.trim() } : {}),
  };
  if (prompt !== undefined) {
    if (!prompt.trim()) return { ok: false, error: `缺少 -p / --prompt\n${USAGE}` };
    return {
      ok: true,
      help: false,
      interactive: false,
      prompt: prompt.trim(),
      ...extras,
    };
  }
  return {
    ok: true,
    help: false,
    interactive: true,
    ...extras,
  };
}
