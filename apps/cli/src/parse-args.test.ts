import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseArgs, USAGE } from "./parse-args.ts";

describe("parseArgs", () => {
  it("defaults to interactive with no arguments", () => {
    assert.deepEqual(parseArgs([]), {
      ok: true,
      help: false,
      interactive: true,
      verbose: false,
    });
  });

  it("parses -i and --interactive", () => {
    assert.deepEqual(parseArgs(["-i"]), {
      ok: true,
      help: false,
      interactive: true,
      verbose: false,
    });
    assert.deepEqual(parseArgs(["--interactive"]), {
      ok: true,
      help: false,
      interactive: true,
      verbose: false,
    });
    assert.deepEqual(parseArgs(["--interactive="]), {
      ok: true,
      help: false,
      interactive: true,
      verbose: false,
    });
  });

  it("parses -p and optional flags", () => {
    const parsed = parseArgs(["-p", "今天天气怎么样", "--model", "kimi", "--cwd", "/tmp/project"]);
    assert.deepEqual(parsed, {
      ok: true,
      help: false,
      interactive: false,
      prompt: "今天天气怎么样",
      verbose: false,
      model: "kimi",
      cwd: "/tmp/project",
    });
  });

  it("parses long flags with equals", () => {
    const parsed = parseArgs(["--prompt=hello", "--model=gpt", "--cwd=/tmp", "--verbose"]);
    assert.deepEqual(parsed, {
      ok: true,
      help: false,
      interactive: false,
      prompt: "hello",
      verbose: true,
      model: "gpt",
      cwd: "/tmp",
    });
  });

  it("parses -v and --verbose", () => {
    const short = parseArgs(["-p", "hi", "-v"]);
    assert.equal(short.ok, true);
    if (!short.ok || short.help || short.interactive) throw new Error("expected prompt mode");
    assert.equal(short.verbose, true);
    const parsed = parseArgs(["-p", "hi", "--verbose="]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.help || parsed.interactive) throw new Error("expected prompt mode");
    assert.equal(parsed.verbose, true);
  });

  it("returns help without requiring a prompt", () => {
    assert.deepEqual(parseArgs(["-h"]), { ok: true, help: true });
    assert.deepEqual(parseArgs(["--help"]), { ok: true, help: true });
    assert.deepEqual(parseArgs(["--", "--help"]), { ok: true, help: true });
  });

  it("includes interactive options and exit commands in help text", () => {
    assert.match(USAGE, /-i, --interactive/);
    assert.match(USAGE, /-v, --verbose/);
    assert.match(USAGE, /:q, :quit, :exit/);
    assert.match(USAGE, /Ctrl-C, Ctrl-D/);
  });

  it("rejects a flag without a value", () => {
    const parsed = parseArgs(["-p"]);
    assert.equal(parsed.ok, false);
    if (parsed.ok) throw new Error("expected failure");
    assert.match(parsed.error, /参数 -p 需要值/);
  });

  it("rejects -p combined with -i", () => {
    const parsed = parseArgs(["-p", "hi", "-i"]);
    assert.equal(parsed.ok, false);
    if (parsed.ok) throw new Error("expected failure");
    assert.match(parsed.error, /-p \/ --prompt 与 -i \/ --interactive 不能同时使用/);
    assert.ok(parsed.error.includes(USAGE));
  });

  it("rejects unknown flags", () => {
    const parsed = parseArgs(["-p", "hi", "--nope"]);
    assert.equal(parsed.ok, false);
    if (parsed.ok) throw new Error("expected failure");
    assert.match(parsed.error, /未知参数：--nope/);
  });
});
