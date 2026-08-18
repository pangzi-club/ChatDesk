import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  browserWorkerCommand,
  resolveBrowserWorkerScript,
  resolvePlaywrightBrowsersPath,
} from "./browser-runtime.ts";

const sourceWorker = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tauri/src-tauri/src/sidecar/browser-worker.mjs",
);

describe("browser worker resolution", () => {
  it("runs worker scripts with the current Node executable", () => {
    expect(browserWorkerCommand("/tmp/browser-worker.mjs", "/app/node-runtime")).toEqual({
      command: "/app/node-runtime",
      args: ["/tmp/browser-worker.mjs"],
    });
  });

  it("uses CHAT_SERVER_BROWSER_WORKER when set", () => {
    expect(
      resolveBrowserWorkerScript(
        { CHAT_SERVER_BROWSER_WORKER: "/tmp/browser-worker" },
        () => false,
      ),
    ).toBe("/tmp/browser-worker");
  });

  it("falls back to the source worker when env is unset", () => {
    expect(resolveBrowserWorkerScript({}, (file) => file === sourceWorker)).toBe(sourceWorker);
  });

  it("falls back to a repo-relative path from cwd when the ESM file path is absent", () => {
    const fromRepoRoot = path.resolve(
      process.cwd(),
      "apps/tauri/src-tauri/src/sidecar/browser-worker.mjs",
    );
    const fromServerDir = path.resolve(
      process.cwd(),
      "../tauri/src-tauri/src/sidecar/browser-worker.mjs",
    );
    const result = resolveBrowserWorkerScript(
      {},
      (file) => file === fromRepoRoot || file === fromServerDir,
    );
    expect([fromRepoRoot, fromServerDir]).toContain(result);
  });

  it("returns undefined when no worker is configured or present", () => {
    expect(resolveBrowserWorkerScript({}, () => false)).toBeUndefined();
  });

  it("uses packaged Playwright browsers only when Chromium is present", () => {
    const browsers = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../tauri/src-tauri/resources/playwright-browsers",
    );
    expect(
      resolvePlaywrightBrowsersPath(
        {},
        (file) => file === browsers,
        () => ["placeholder.txt"],
      ),
    ).toBeUndefined();
    expect(
      resolvePlaywrightBrowsersPath(
        {},
        (file) => file === browsers,
        () => ["chromium_headless_shell-1187"],
      ),
    ).toBe(browsers);
  });
});
