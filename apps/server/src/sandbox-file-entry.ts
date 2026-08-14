import { runSandboxFileHelper } from "./sandbox-file-helper.ts";

void runSandboxFileHelper().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const blocked = /(?:operation not permitted|sandbox|deny|permission denied)/i.test(message);
  process.stdout.write(JSON.stringify({ ok: false, blocked, error: message }));
  process.exitCode = 1;
});
