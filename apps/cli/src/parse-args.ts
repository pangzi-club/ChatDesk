export const USAGE = `用法:
  chatdesk -p <prompt> [--model <id>] [--cwd <path>]

选项:
  -p, --prompt <text>   发送一条消息并打印最终回答
  --model <id>          指定模型 id 或名称（默认使用桌面里的默认模型）
  --cwd <path>          指定 workspace 目录（默认当前工作目录）
  -h, --help            显示帮助`;

export type ParsedArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; prompt: string; model?: string; cwd?: string }
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

export function parseArgs(argv: string[]): ParsedArgs {
  let prompt: string | undefined;
  let model: string | undefined;
  let cwd: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") continue;
    if (arg === "-h" || arg === "--help") {
      help = true;
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
  if (!prompt?.trim()) return { ok: false, error: `缺少 -p / --prompt\n${USAGE}` };
  return {
    ok: true,
    help: false,
    prompt: prompt.trim(),
    ...(model?.trim() ? { model: model.trim() } : {}),
    ...(cwd?.trim() ? { cwd: cwd.trim() } : {}),
  };
}
