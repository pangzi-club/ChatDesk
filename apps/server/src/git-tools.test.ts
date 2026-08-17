import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildGitToolCommand, isGitMutation, normalizeGitToolInput } from "./git-tools.ts";

describe("chat git tool commands", () => {
  it("builds a status command without shell input", () => {
    assert.equal(buildGitToolCommand({ action: "status" }), "git status --short --branch");
  });

  it("validates and quotes branch names", () => {
    const command = buildGitToolCommand({ action: "create_branch", branch: "feature/o'malley" });
    assert.match(command, /git check-ref-format --branch 'feature\/o'\\''malley'/);
    assert.match(command, /git switch --create 'feature\/o'\\''malley'/);
  });

  it("disables hooks for chat commits and returns the typed input", () => {
    const input = normalizeGitToolInput({ action: "commit", message: "  add feature  " });
    assert.deepEqual(input, { action: "commit", message: "  add feature  " });
    assert.match(buildGitToolCommand(input), /core\.hooksPath=\/dev\/null/);
    assert.equal(isGitMutation({ action: "status" }), false);
    assert.equal(isGitMutation({ action: "commit", message: "update" }), true);
  });

  it("rejects missing action-specific values", () => {
    assert.throws(() => normalizeGitToolInput({ action: "create_branch" }));
    assert.throws(() => normalizeGitToolInput({ action: "commit" }));
    assert.throws(() => buildGitToolCommand({ action: "create_branch", branch: "" }));
    assert.throws(() => buildGitToolCommand({ action: "commit", message: "" }));
  });
});
