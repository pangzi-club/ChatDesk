import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveBrowserWorkerScript, resolvePlaywrightBrowsersPath } from "./browser-runtime.ts";

const sourceWorker = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../desktop/src-tauri/src/sidecar/browser-worker.mjs",
);

describe("browser worker resolution", () => {
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

  it("returns undefined when no worker is configured or present", () => {
    expect(resolveBrowserWorkerScript({}, () => false)).toBeUndefined();
  });

  it("uses packaged Playwright browsers only when Chromium is present", () => {
    const browsers = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../desktop/src-tauri/resources/playwright-browsers",
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
