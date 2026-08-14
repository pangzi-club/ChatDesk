import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("buildSystemPrompt", () => {
  it("loads AGENTS.md from the workspace root and preserves section order", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "chatdesk-system-prompt-"));
    temporaryDirectories.push(workspace);
    await writeFile(path.join(workspace, "AGENTS.md"), "遵守项目规则。\n", "utf8");

    const prompt = await buildSystemPrompt({
      cwd: workspace,
      workspaceToolInstructions: "工具规则",
      todoToolInstructions: "任务规划规则",
      system: "Skills 规则",
      memory: "记忆规则",
    });

    assert.deepEqual(
      prompt.sections.map((section) => section.id),
      ["workspace-tools", "todo-tool", "agents", "system", "memory", "workspace"],
    );
    const agentsSection = prompt.sections.find((section) => section.id === "agents");
    assert.equal(agentsSection?.included, true);
    assert.match(
      prompt.text,
      /工具规则[\s\S]*任务规划规则[\s\S]*Workspace instructions from AGENTS\.md[\s\S]*遵守项目规则。[\s\S]*Skills 规则/,
    );
    assert.equal(agentsSection?.path, path.join(workspace, "AGENTS.md"));
  });

  it("does not read a nested AGENTS.md and skips oversized files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "chatdesk-system-prompt-"));
    temporaryDirectories.push(workspace);
    await writeFile(path.join(workspace, "AGENTS.md"), "x".repeat(512 * 1024 + 1), "utf8");
    await writeFile(path.join(workspace, "nested.txt"), "root", "utf8");

    const prompt = await buildSystemPrompt({ cwd: workspace });

    assert.equal(prompt.sections.find((section) => section.id === "agents")?.included, false);
    assert.equal(prompt.text, `当前 workspace：${workspace}`);
  });

  it("returns no workspace sections when cwd is absent", async () => {
    const prompt = await buildSystemPrompt({ system: "普通规则" });
    assert.equal(prompt.cwd, undefined);
    assert.equal(prompt.sections.find((section) => section.id === "agents")?.included, false);
    assert.equal(prompt.text, "普通规则");
  });
});
