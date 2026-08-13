import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeGeneratedCommitMessage } from "./git-commit-message.ts";

test("normalizes generated messages to an English Conventional Commit prefix", () => {
  assert.equal(
    normalizeGeneratedCommitMessage("feat(scope): add the commit flow"),
    "feat: add the commit flow",
  );
  assert.equal(
    normalizeGeneratedCommitMessage("add the commit flow"),
    "chore: add the commit flow",
  );
  assert.equal(normalizeGeneratedCommitMessage("修复提交"), "chore: update workspace changes");
});
