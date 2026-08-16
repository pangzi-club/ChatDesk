import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { commands, resolveCommand } from "./migrate.mjs";

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts/migrate.mjs");

test("resolveCommand maps known names and help flags", () => {
  assert.deepEqual(resolveCommand([]), { type: "help" });
  assert.deepEqual(resolveCommand(["--help"]), { type: "help" });
  assert.deepEqual(resolveCommand(["--", "--help"]), { type: "help" });
  assert.deepEqual(resolveCommand(["jsonl", "--apply"]), {
    type: "run",
    command: "jsonl",
    args: ["--apply"],
  });
  assert.deepEqual(resolveCommand(["--", "jsonl", "--apply"]), {
    type: "run",
    command: "jsonl",
    args: ["--apply"],
  });
  assert.deepEqual(resolveCommand(["not-a-command"]), {
    type: "unknown",
    command: "not-a-command",
  });
  assert.ok(Object.hasOwn(commands, "chatdesk"));
  assert.ok(Object.hasOwn(commands, "dedupe"));
});

test("migrate dispatcher lists commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, [script, "--help"]);
  assert.match(stdout, /pnpm migrate <command>/);
  assert.match(stdout, /chatdesk/);
  assert.match(stdout, /jsonl/);
  assert.match(stdout, /default-workspace/);
  assert.match(stdout, /dedupe/);
  assert.match(stdout, /docs\/data-migration\.md/);

  const forwarded = await execFileAsync(process.execPath, [script, "--", "--help"]);
  assert.match(forwarded.stdout, /pnpm migrate <command>/);
});

test("migrate dispatcher forwards help to a subcommand", async () => {
  const { stdout } = await execFileAsync(process.execPath, [script, "jsonl", "--help"]);
  assert.match(stdout, /messages\.jsonl/);
});

test("migrate dispatcher rejects unknown commands", async () => {
  try {
    await execFileAsync(process.execPath, [script, "not-a-command"]);
    assert.fail("expected unknown command to fail");
  } catch (error) {
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /未知命令：not-a-command/);
  }
});
