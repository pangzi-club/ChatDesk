import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  readBuiltinSkillFile,
  resolveBuiltinSkillsRoot,
  scanBuiltinSkills,
} from "./skills-store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function createSkillRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-builtin-skills-"));
  temporaryDirectories.push(root);
  const skillDir = path.join(root, "demo-guide");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: Demo Guide\ndescription: Demo skill for tests.\n---\n\n# Demo\n\nUse references/extra.md when needed.\n",
    "utf8",
  );
  await writeFile(path.join(skillDir, "references", "extra.md"), "extra detail\n", "utf8");
  return root;
}

describe("resolveBuiltinSkillsRoot", () => {
  it("prefers CHATDESK_BUILTIN_SKILLS_DIR", () => {
    const root = resolveBuiltinSkillsRoot({
      env: { CHATDESK_BUILTIN_SKILLS_DIR: "/tmp/custom-skills" },
      argv1: "/app/workers/chat-server.cjs",
      cwd: "/repo",
      exists: (file) => file === "/tmp/custom-skills",
      sourceDir: "/repo/apps/server/src",
    });
    assert.equal(root, path.resolve("/tmp/custom-skills"));
  });

  it("uses the packaged worker sibling skills directory", () => {
    const root = resolveBuiltinSkillsRoot({
      env: {},
      argv1: "/app/node-runtime/workers/chat-server.cjs",
      cwd: "/repo",
      exists: (file) => file === path.resolve("/app/node-runtime/workers/skills"),
      sourceDir: undefined,
    });
    assert.equal(root, path.resolve("/app/node-runtime/workers/skills"));
  });
});

describe("scanBuiltinSkills", () => {
  it("parses packaged SKILL.md files from the resolved root", async () => {
    const root = await createSkillRoot();
    const skills = await scanBuiltinSkills({
      env: { CHATDESK_BUILTIN_SKILLS_DIR: root },
    });
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.id, "builtin:demo-guide");
    assert.equal(skills[0]?.name, "Demo Guide");
    assert.equal(skills[0]?.source, "builtin");
    assert.match(skills[0]?.description ?? "", /Demo skill/);
  });

  it("finds the shipped chatdesk-doc skill from the source tree", async () => {
    const skills = await scanBuiltinSkills({
      env: {},
      argv1: path.join(process.cwd(), "apps/server/src/server.ts"),
      cwd: process.cwd(),
    });
    const doc = skills.find((skill) => skill.id === "builtin:chatdesk-doc");
    assert.ok(doc);
    assert.match(doc?.description ?? "", /设置/);
  });
});

describe("readBuiltinSkillFile", () => {
  it("reads SKILL.md and relative references", async () => {
    const root = await createSkillRoot();
    const options = { env: { CHATDESK_BUILTIN_SKILLS_DIR: root } };
    const skill = await readBuiltinSkillFile("builtin:demo-guide", "SKILL.md", options);
    assert.match(skill.content, /Demo Guide/);
    const reference = await readBuiltinSkillFile(
      "builtin:demo-guide",
      "references/extra.md",
      options,
    );
    assert.match(reference.content, /extra detail/);
  });

  it("rejects local skills and path traversal", async () => {
    const root = await createSkillRoot();
    const options = { env: { CHATDESK_BUILTIN_SKILLS_DIR: root } };
    await assert.rejects(
      () => readBuiltinSkillFile("agents:demo-guide", "SKILL.md", options),
      /只能读取内置 skill/,
    );
    await assert.rejects(
      () => readBuiltinSkillFile("builtin:demo-guide", "../secret.md", options),
      /必须位于该 skill 目录内/,
    );
    await assert.rejects(
      () => readBuiltinSkillFile("builtin:../demo-guide", "SKILL.md", options),
      /无效的 skill id/,
    );
  });
});
