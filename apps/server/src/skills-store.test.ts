import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  readBuiltinSkillFile,
  resolveBuiltinSkillsRoot,
  scanBuiltinSkills,
  scanSkills,
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

  it("ignores SKILL.md files that omit frontmatter name", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-builtin-skills-"));
    temporaryDirectories.push(root);
    const skillDir = path.join(root, "header-only");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\ndescription: Directory fallback test.\n---\n\n# Header Title\n\nBody text.\n",
      "utf8",
    );

    const skills = await scanBuiltinSkills({
      env: { CHATDESK_BUILTIN_SKILLS_DIR: root },
    });
    assert.equal(skills.length, 0);
  });

  it("finds the shipped builtin skills from the source tree", async () => {
    const skills = await scanBuiltinSkills({
      env: {},
      argv1: path.join(process.cwd(), "apps/server/src/server.ts"),
      cwd: process.cwd(),
    });
    const ids = skills.map((skill) => skill.id).sort();
    assert.deepEqual(ids, [
      "builtin:chatdesk-doc",
      "builtin:skill-creator",
      "builtin:skill-installer",
    ]);
    const doc = skills.find((skill) => skill.id === "builtin:chatdesk-doc");
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

describe("scanSkills", () => {
  it("only scans ~/.agents/skills for local skills", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "chatdesk-home-skills-"));
    temporaryDirectories.push(home);
    const agentsSkill = path.join(home, ".agents/skills/alpha");
    const ignored = [
      path.join(home, ".agent/skills/beta"),
      path.join(home, ".codex/skills/gamma"),
      path.join(home, ".claude/skills/delta"),
      path.join(home, ".agents/workspace-should-not-count"),
    ];
    await mkdir(agentsSkill, { recursive: true });
    await writeFile(
      path.join(agentsSkill, "SKILL.md"),
      "---\nname: Alpha\ndescription: Agents skill.\n---\n\n# Alpha\n",
      "utf8",
    );
    for (const directory of ignored) {
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        "---\nname: Ignored\ndescription: Should not be scanned.\n---\n\n# Ignored\n",
        "utf8",
      );
    }
    const workspaceAgents = path.join(home, "project/.agents/skills/workspace");
    await mkdir(workspaceAgents, { recursive: true });
    await writeFile(
      path.join(workspaceAgents, "SKILL.md"),
      "---\nname: Workspace\ndescription: Workspace skill.\n---\n\n# Workspace\n",
      "utf8",
    );

    const skills = await scanSkills({
      homeDir: home,
      cwd: path.join(home, "project"),
      env: {},
      exists: () => false,
      sourceDir: undefined,
    });
    assert.deepEqual(
      skills.map((skill) => skill.id),
      ["agents:alpha"],
    );
  });
});
