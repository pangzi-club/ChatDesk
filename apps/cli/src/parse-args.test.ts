import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseArgs, USAGE } from "./parse-args.ts";

describe("parseArgs", () => {
  it("parses -p and optional flags", () => {
    const parsed = parseArgs(["-p", "今天天气怎么样", "--model", "kimi", "--cwd", "/tmp/project"]);
    assert.deepEqual(parsed, {
      ok: true,
      help: false,
      prompt: "今天天气怎么样",
      model: "kimi",
      cwd: "/tmp/project",
    });
  });

  it("parses long flags with equals", () => {
    const parsed = parseArgs(["--prompt=hello", "--model=gpt", "--cwd=/tmp"]);
    assert.deepEqual(parsed, {
      ok: true,
      help: false,
      prompt: "hello",
      model: "gpt",
      cwd: "/tmp",
    });
  });

  it("returns help without requiring a prompt", () => {
    assert.deepEqual(parseArgs(["-h"]), { ok: true, help: true });
    assert.deepEqual(parseArgs(["--help"]), { ok: true, help: true });
    assert.deepEqual(parseArgs(["--", "--help"]), { ok: true, help: true });
  });

  it("rejects a missing prompt", () => {
    const parsed = parseArgs([]);
    assert.equal(parsed.ok, false);
    if (parsed.ok) throw new Error("expected failure");
    assert.match(parsed.error, /缺少 -p \/ --prompt/);
    assert.ok(parsed.error.includes(USAGE));
  });

  it("rejects a flag without a value", () => {
    const parsed = parseArgs(["-p"]);
    assert.equal(parsed.ok, false);
    if (parsed.ok) throw new Error("expected failure");
    assert.match(parsed.error, /参数 -p 需要值/);
  });

  it("rejects unknown flags", () => {
    const parsed = parseArgs(["-p", "hi", "--verbose"]);
    assert.equal(parsed.ok, false);
    if (parsed.ok) throw new Error("expected failure");
    assert.match(parsed.error, /未知参数：--verbose/);
  });
});
