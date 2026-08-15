import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  decideRunStep,
  evaluateRunCompletion,
  ReadOnlyToolLoopTracker,
  ReadOnlyToolResultDeduplicator,
  toolFingerprint,
} from "./run-policy.ts";

describe("run policy", () => {
  it("warns near the internal plan limit and reserves the final step for handoff", () => {
    assert.equal(
      decideRunStep({ planMode: "plan", stepNumber: 0, planWritten: false }).toolChoice,
      "required",
    );
    assert.equal(
      decideRunStep({
        planMode: "plan",
        stepNumber: 0,
        planWritten: false,
        requiredToolChoiceSupported: false,
      }).toolChoice,
      "auto",
    );
    assert.match(
      decideRunStep({ planMode: "plan", stepNumber: 89, planWritten: false }).instructions ?? "",
      /接近上限/,
    );
    assert.equal(
      decideRunStep({ planMode: "plan", stepNumber: 89, planWritten: false }).toolChoice,
      "required",
    );
    assert.equal(
      decideRunStep({ planMode: "plan", stepNumber: 90, planWritten: false }).instructions,
      undefined,
    );
    assert.deepEqual(
      decideRunStep({ planMode: "plan", stepNumber: 98, planWritten: false }).activeTools,
      ["plan_write", "request_user_input"],
    );
    assert.equal(
      decideRunStep({ planMode: "plan", stepNumber: 99, planWritten: false }).toolChoice,
      "required",
    );
    assert.match(
      decideRunStep({ planMode: "plan", stepNumber: 99, planWritten: false }).instructions ?? "",
      /不得输出普通文本问题/,
    );
    assert.match(
      decideRunStep({ planMode: "plan", stepNumber: 99, planWritten: true }).instructions ?? "",
      /计划已写入/,
    );
  });

  it("distinguishes completion, awaiting user, incomplete output, and stop", () => {
    assert.equal(
      evaluateRunCompletion({
        planMode: "plan",
        planWritten: true,
        finalText: "计划已完成",
        finishReason: "stop",
        terminalObserved: true,
        aborted: false,
      }).outcome,
      "completed",
    );
    assert.deepEqual(
      evaluateRunCompletion({
        planMode: "plan",
        planWritten: false,
        finalText: "需要确认部署区域",
        finishReason: "stop",
        terminalObserved: true,
        aborted: false,
      }),
      { outcome: "error", stopReason: "incomplete-response" },
    );
    assert.equal(
      evaluateRunCompletion({
        planMode: "plan",
        planWritten: false,
        userInputRequested: true,
        finalText: "",
        finishReason: "tool-calls",
        terminalObserved: true,
        aborted: false,
      }).outcome,
      "awaiting-user",
    );
    assert.deepEqual(
      evaluateRunCompletion({
        planMode: "apply",
        planWritten: false,
        finalText: "",
        finishReason: "tool-calls",
        terminalObserved: true,
        aborted: false,
      }),
      { outcome: "error", stopReason: "incomplete-response" },
    );
    assert.deepEqual(
      evaluateRunCompletion({
        planMode: "apply",
        planWritten: false,
        finalText: "",
        terminalObserved: false,
        aborted: true,
      }),
      { outcome: "stopped", stopReason: "user" },
    );
  });
});

describe("read-only tool loop detection", () => {
  it("normalizes defaults and returns a compact receipt for unchanged results", () => {
    assert.equal(
      toolFingerprint("read_file", { path: "./src/a.ts" }),
      toolFingerprint("read_file", { path: "src/a.ts", startLine: 1 }),
    );
    const deduplicator = new ReadOnlyToolResultDeduplicator();
    const output = { path: "src/a.ts", content: "same" };
    assert.deepEqual(
      deduplicator.compact("read_file", { path: "src/a.ts" }, output, "one"),
      output,
    );
    const receipt = deduplicator.compact(
      "read_file",
      { path: "./src/a.ts", startLine: 1 },
      output,
      "two",
    ) as { duplicate: boolean; duplicateOf: string; resultDigest: string; message: string };
    assert.equal(receipt.duplicate, true);
    assert.equal(receipt.duplicateOf, "one");
    assert.match(receipt.resultDigest, /^[a-f0-9]{64}$/);
    assert.equal(receipt.message, "结果与先前调用相同；请复用已有信息，不要再次执行相同查询。");
  });

  it("enters finalization on the third identical result but permits changed files", () => {
    const tracker = new ReadOnlyToolLoopTracker();
    const call = (output: unknown) =>
      tracker.recordStep([{ toolName: "read_file", input: { path: "a.ts" }, output }]);
    assert.equal(call({ content: "one" }).loopDetected, false);
    assert.equal(call({ content: "one" }).loopDetected, false);
    assert.equal(call({ content: "two" }).loopDetected, false);
    assert.equal(call({ content: "two" }).loopDetected, false);
    assert.equal(call({ content: "two" }).loopDetected, true);
  });
});
