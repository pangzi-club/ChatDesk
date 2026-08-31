import { runSandboxFileHelper } from "./sandbox-file-helper.ts";

void runSandboxFileHelper().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const blocked = /(?:operation not permitted|sandbox|deny|permission denied)/i.test(message);
  const details =
    error && typeof error === "object"
      ? (error as { code?: unknown; operation?: unknown; rule?: unknown })
      : {};
  process.stdout.write(
    JSON.stringify({
      ok: false,
      blocked,
      error: message,
      errorCode: typeof details.code === "string" ? details.code : undefined,
      errorOperation: typeof details.operation === "string" ? details.operation : undefined,
      errorRule: typeof details.rule === "string" ? details.rule : undefined,
    }),
  );
  process.exitCode = 1;
});
