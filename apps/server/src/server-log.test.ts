import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { formatLogArguments, logServerError, logServerInfo, logServerWarn } from "./server-log.ts";

describe("server log helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefixes every server message exactly once", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logServerInfo("browser worker: /tmp/worker.mjs");
    logServerWarn("未配置 browser worker");
    logServerError("关闭失败: boom");

    assert.deepEqual(log.mock.calls, [["[Chat Server] browser worker: /tmp/worker.mjs"]]);
    assert.deepEqual(warn.mock.calls, [["[Chat Server] 未配置 browser worker"]]);
    assert.deepEqual(error.mock.calls, [["[Chat Server] 关闭失败: boom"]]);
  });

  it("flattens nested Feishu SDK logger arguments into one line", () => {
    assert.equal(
      formatLogArguments([["[ws]", "receive events\n  through persistent connection"]]),
      "[ws] receive events through persistent connection",
    );
    assert.equal(formatLogArguments([{ code: 0 }]), '{"code":0}');
    assert.equal(formatLogArguments(["client ready"]), "client ready");
  });
});
