import { lockHint, type OpenCliSessionOptions, openCliSession } from "./cli-session.ts";
import { renderMarkdown } from "./markdown.ts";
import { formatVerboseSummary } from "./verbose.ts";

export { CLI_DEFAULT_TOOL_NAMES } from "./cli-session.ts";

export type RunPromptOptions = OpenCliSessionOptions & {
  prompt: string;
  stdout?: Pick<NodeJS.WritableStream, "write">;
  stderr?: Pick<NodeJS.WritableStream, "write">;
  verbose?: boolean;
  signal?: AbortSignal;
};

function writeLine(stream: Pick<NodeJS.WritableStream, "write">, text: string) {
  stream.write(`${text}\n`);
}

function stdoutColor(stdout: Pick<NodeJS.WritableStream, "write">) {
  return stdout === process.stdout && Boolean(process.stdout.isTTY);
}

export async function runPrompt(options: RunPromptOptions) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const prompt = options.prompt.trim();
  if (!prompt) {
    writeLine(stderr, "prompt 不能为空");
    return 1;
  }

  let session: Awaited<ReturnType<typeof openCliSession>> | undefined;
  try {
    session = await openCliSession(options);
    const turn = await session.submit(prompt, options.signal);
    if (turn.text) writeLine(stdout, renderMarkdown(turn.text, { color: stdoutColor(stdout) }));
    if (options.verbose) writeLine(stdout, formatVerboseSummary(turn));
    if (turn.aborted) return 1;
    const outcome = turn.summary?.outcome;
    if (outcome === "error" || outcome === "stopped" || !turn.text) {
      if (!turn.text) {
        if (outcome === "error" || outcome === "stopped") {
          writeLine(
            stderr,
            turn.summary?.stopReason ? `运行失败：${turn.summary.stopReason}` : "运行失败",
          );
        } else {
          writeLine(stderr, "模型没有返回内容");
        }
      }
      return 1;
    }
    return 0;
  } catch (error) {
    const message = lockHint(error instanceof Error ? error.message : String(error));
    writeLine(stderr, message);
    return 1;
  } finally {
    await session?.close();
  }
}
