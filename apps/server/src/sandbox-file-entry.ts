import { runSandboxFileWorker } from "./sandbox-file-worker.ts";

void runSandboxFileWorker().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const blocked = /(?:operation not permitted|sandbox|deny|permission denied)/i.test(message);
  process.stdout.write(JSON.stringify({ ok: false, blocked, error: message }));
  process.exitCode = 1;
});
