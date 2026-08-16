import assert from "node:assert/strict";
import type { Warning } from "ai";
import { test } from "vitest";
import {
  createAiSdkWarningLogger,
  filterAiSdkWarnings,
  isSuppressedAiSdkWarning,
  STATELESS_REASONING_WARNING,
} from "./ai-sdk-warnings.ts";

const skipped: Warning = {
  type: "other",
  message: STATELESS_REASONING_WARNING,
};

const other: Warning = {
  type: "other",
  message: 'The feature "temperature" is not supported.',
};

test("identifies only the stateless reasoning skip warning", () => {
  assert.equal(isSuppressedAiSdkWarning(skipped), true);
  assert.equal(isSuppressedAiSdkWarning(other), false);
  assert.deepEqual(filterAiSdkWarnings([skipped, other, skipped]), [other]);
});

test("logger stays quiet when every warning is the expected skip", () => {
  let called = false;
  const log = createAiSdkWarningLogger(() => {
    called = true;
  });
  log({
    provider: "openai.responses",
    model: "deepseek-v4-flash",
    warnings: [skipped, skipped],
  });
  assert.equal(called, false);
});

test("logger forwards remaining warnings", () => {
  const logged: Warning[][] = [];
  const log = createAiSdkWarningLogger(({ warnings }) => {
    logged.push(warnings);
  });
  log({
    provider: "openai.responses",
    model: "deepseek-v4-flash",
    warnings: [skipped, other],
  });
  assert.deepEqual(logged, [[other]]);
});
