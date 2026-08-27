import { render } from "ink";
import { createElement as h } from "react";
import { lockHint, type OpenCliSessionOptions, openCliSession } from "./cli-session.ts";
import { InteractiveApp } from "./interactive-app.ts";

export type RunInteractiveOptions = OpenCliSessionOptions & {
  stdout?: NodeJS.WriteStream;
  stderr?: Pick<NodeJS.WritableStream, "write">;
  stdin?: NodeJS.ReadStream;
};

export async function runInteractive(options: RunInteractiveOptions) {
  const stderr = options.stderr ?? process.stderr;
  let session: Awaited<ReturnType<typeof openCliSession>> | undefined;
  let instance: ReturnType<typeof render> | undefined;
  try {
    session = await openCliSession(options);
    instance = render(
      h(InteractiveApp, {
        submit: session.submit,
        stop: session.stop,
        modelLabel: session.modelLabel,
        cwd: options.cwd ?? process.cwd(),
      }),
      {
        exitOnCtrlC: false,
        patchConsole: true,
        ...(options.stdout ? { stdout: options.stdout } : {}),
        ...(options.stdin ? { stdin: options.stdin } : {}),
      },
    );
    await instance.waitUntilExit();
    return 0;
  } catch (error) {
    const message = lockHint(error instanceof Error ? error.message : String(error));
    stderr.write(`${message}\n`);
    return 1;
  } finally {
    instance?.unmount();
    await session?.close();
  }
}
