import assert from "node:assert/strict";
import test from "node:test";
import { createIndentedWriter, DEV_CONSOLE_INDENT } from "./dev-console.mjs";

function collector() {
  const lines = [];
  return { lines, write: (text) => lines.push(text) };
}

test("indents each complete line", () => {
  const { lines, write } = collector();
  const writer = createIndentedWriter(write);

  writer("first\nsecond\n");

  assert.deepEqual(lines, [`${DEV_CONSOLE_INDENT}first\n`, `${DEV_CONSOLE_INDENT}second\n`]);
});

test("buffers a partial line until its newline arrives", () => {
  const { lines, write } = collector();
  const writer = createIndentedWriter(write);

  writer("Ver");
  assert.deepEqual(lines, []);
  writer("ified\n");

  assert.deepEqual(lines, [`${DEV_CONSOLE_INDENT}Verified\n`]);
});

test("flush emits a trailing partial line exactly once", () => {
  const { lines, write } = collector();
  const writer = createIndentedWriter(write);

  writer("no newline");
  writer.flush();
  writer.flush();

  assert.deepEqual(lines, [`${DEV_CONSOLE_INDENT}no newline\n`]);
});

test("keeps blank lines empty and normalizes CRLF", () => {
  const { lines, write } = collector();
  const writer = createIndentedWriter(write);

  writer("first\r\n\r\nlast\r\n");

  assert.deepEqual(lines, [`${DEV_CONSOLE_INDENT}first\n`, "\n", `${DEV_CONSOLE_INDENT}last\n`]);
});

test("accepts a custom indent", () => {
  const { lines, write } = collector();
  const writer = createIndentedWriter(write, "-- ");

  writer("ready\n");

  assert.deepEqual(lines, ["-- ready\n"]);
});
