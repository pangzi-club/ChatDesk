#!/usr/bin/env node

import { installAiSdkWarningFilter } from "@chatdesk/agent-core";
import { runInteractive } from "./interactive.ts";
import { parseArgs, USAGE } from "./parse-args.ts";
import { runPrompt } from "./run-prompt.ts";

installAiSdkWarningFilter();

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
    process.exitCode = 1;
    return;
  }
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (parsed.interactive) {
    process.exitCode = await runInteractive({
      modelId: parsed.model,
      cwd: parsed.cwd,
    });
    return;
  }

  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    process.exitCode = await runPrompt({
      prompt: parsed.prompt,
      modelId: parsed.model,
      cwd: parsed.cwd,
      verbose: parsed.verbose,
      signal: controller.signal,
    });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

void main();
