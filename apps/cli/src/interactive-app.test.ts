import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { cleanup, render } from "ink-testing-library";
import { createElement as h } from "react";
import { afterEach, describe, it } from "vitest";
import type { CliTurnResult } from "./cli-session.ts";
import { InteractiveApp, type InteractiveAppProps, isExitCommand } from "./interactive-app.ts";

afterEach(() => {
  cleanup();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function ok(text: string): CliTurnResult {
  return { text, modelLabel: "mock-model", aborted: false };
}

async function waitForFrame(getFrame: () => string | undefined, pattern: RegExp, timeout = 800) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pattern.test(getFrame() ?? "")) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${pattern}. last frame:\n${getFrame() ?? ""}`);
}

async function typeLine(stdin: { write: (value: string) => void }, text: string) {
  stdin.write(text);
  await delay(30);
  stdin.write("\r");
  await delay(30);
}

describe("InteractiveApp", () => {
  it("recognizes exit commands", () => {
    assert.equal(isExitCommand(":q"), true);
    assert.equal(isExitCommand(" :Quit "), true);
    assert.equal(isExitCommand(":exit"), true);
    assert.equal(isExitCommand("hello"), false);
  });

  it("renders streamed text before completion", async () => {
    const turn = deferred<CliTurnResult>();
    let emit: Parameters<InteractiveAppProps["submit"]>[2];
    const { lastFrame, stdin } = render(
      h(InteractiveApp, {
        submit: (_prompt, _signal, onEvent) => {
          emit = onEvent;
          return turn.promise;
        },
      }),
    );
    await typeLine(stdin, "请说明重点");
    await waitForFrame(lastFrame, /正在思考/);
    emit?.({ type: "text-delta", delta: "这是重点。" });
    await waitForFrame(lastFrame, /重点/);
    turn.resolve(ok("这是 **重点**。"));
    await waitForFrame(lastFrame, /Enter 发送/);
    assert.match(lastFrame() ?? "", /重点/);
    assert.doesNotMatch(lastFrame() ?? "", /正在思考/);
    assert.doesNotMatch(lastFrame() ?? "", /\*\*重点\*\*/);
  });

  it("reuses submit across multiple turns and ignores blank lines", async () => {
    const prompts: string[] = [];
    const { lastFrame, stdin } = render(
      h(InteractiveApp, {
        submit: async (prompt) => {
          prompts.push(prompt);
          return ok(`答:${prompt}`);
        },
      }),
    );
    stdin.write("\r");
    await delay(30);
    stdin.write("   ");
    await delay(20);
    stdin.write("\r");
    await delay(30);
    await typeLine(stdin, "第一轮");
    await waitForFrame(lastFrame, /答:第一轮/);
    await typeLine(stdin, "第二轮");
    await waitForFrame(lastFrame, /答:第二轮/);
    assert.deepEqual(prompts, ["第一轮", "第二轮"]);
  });

  it("exits on :q, :quit, :exit, and Ctrl-D", async () => {
    for (const command of [":q", ":quit", ":exit"]) {
      let exited = 0;
      const { stdin, unmount } = render(
        h(InteractiveApp, {
          submit: async () => ok("unused"),
          onExit: () => {
            exited += 1;
          },
        }),
      );
      await typeLine(stdin, command);
      await waitForFrame(() => (exited ? "exited" : ""), /exited/);
      assert.equal(exited, 1, command);
      unmount();
    }

    let exited = 0;
    const { stdin, unmount } = render(
      h(InteractiveApp, {
        submit: async () => ok("unused"),
        onExit: () => {
          exited += 1;
        },
      }),
    );
    stdin.write("\x04");
    await waitForFrame(() => (exited ? "exited" : ""), /exited/);
    assert.equal(exited, 1);
    unmount();
  });

  it("keeps the session usable after a turn error", async () => {
    let count = 0;
    const { lastFrame, stdin } = render(
      h(InteractiveApp, {
        submit: async () => {
          count += 1;
          if (count === 1) throw new Error("本轮失败");
          return ok("第二轮成功");
        },
      }),
    );
    await typeLine(stdin, "第一轮");
    await waitForFrame(lastFrame, /本轮失败/);
    await typeLine(stdin, "第二轮");
    await waitForFrame(lastFrame, /第二轮成功/);
    assert.equal(count, 2);
  });

  it("stops the active run on Ctrl-C without exiting", async () => {
    const turn = deferred<CliTurnResult>();
    const aborts: string[] = [];
    let stopped = 0;
    let exited = 0;
    const { lastFrame, stdin, unmount } = render(
      h(InteractiveApp, {
        submit: (prompt, signal) => {
          signal.addEventListener("abort", () => aborts.push(prompt));
          return turn.promise;
        },
        stop: () => {
          stopped += 1;
        },
        onExit: () => {
          exited += 1;
        },
      }),
    );
    await typeLine(stdin, "进行中");
    await waitForFrame(lastFrame, /正在思考/);
    stdin.write("\x03");
    await waitForFrame(lastFrame, /正在停止/);
    assert.deepEqual(aborts, ["进行中"]);
    assert.equal(stopped, 1);
    assert.equal(exited, 0);
    turn.resolve({ text: "", modelLabel: "mock-model", aborted: true });
    await waitForFrame(lastFrame, /运行已停止/);
    unmount();
  });
});
