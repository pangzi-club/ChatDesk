import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createLocalSkill, createSkillTool } from "./create-skill.ts";
import { scanSkills } from "./skills-store.ts";

const roots: string[] = [];
async function temporaryHome() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-create-skill-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const input = {
  name: "repo-review",
  description: 'Review: "repository" # files',
  body: "# Review\n\nRead files.",
};

it("creates a discoverable skill with generated frontmatter and an absolute result path", async () => {
  const home = await temporaryHome();
  const execute = createSkillTool({ homeDir: home }).execute;
  if (!execute) throw new Error("Missing execute");
  const result = await execute(input, { toolCallId: "create", messages: [], context: {} });
  expect(result).toMatchObject({ id: "agents:repo-review", created: true });
  const skills = await scanSkills({ homeDir: home });
  expect(skills.find((skill) => skill.id === "agents:repo-review")).toMatchObject({
    name: input.name,
    description: input.description,
  });
});

it("rejects traversal and invalid or empty metadata before writing", async () => {
  const home = await temporaryHome();
  for (const name of ["../outside", "/tmp/outside", "a/b", "a\\b", ".agents", "", "Upper"]) {
    await expect(createLocalSkill({ ...input, name }, home)).rejects.toThrow();
  }
  await expect(
    createLocalSkill({ ...input, description: "a\nname: injected" }, home),
  ).rejects.toThrow();
  await expect(createLocalSkill({ ...input, body: " " }, home)).rejects.toThrow();
});

it("does not overwrite an existing skill or empty directory", async () => {
  const home = await temporaryHome();
  const result = await createLocalSkill(input, home);
  const before = await readFile(result.path, "utf8");
  await expect(createLocalSkill({ ...input, body: "changed" }, home)).rejects.toThrow("已存在");
  expect(await readFile(result.path, "utf8")).toBe(before);
  await mkdir(path.join(home, ".agents/skills/empty"));
  await expect(createLocalSkill({ ...input, name: "empty" }, home)).rejects.toThrow("已存在");
});

it("rejects symlinks in both parents and the destination", async () => {
  for (const target of [".agents", ".agents/skills", ".agents/skills/repo-review"]) {
    const home = await temporaryHome();
    const outside = await temporaryHome();
    await mkdir(path.dirname(path.join(home, target)), { recursive: true });
    await symlink(outside, path.join(home, target));
    await expect(createLocalSkill(input, home)).rejects.toThrow();
    await expect(readFile(path.join(outside, "SKILL.md"))).rejects.toThrow();
  }
});

it("allows only one concurrent creation of the same name", async () => {
  const home = await temporaryHome();
  const results = await Promise.allSettled([
    createLocalSkill(input, home),
    createLocalSkill(input, home),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
});

it("does not interpret body examples as skill metadata", async () => {
  const home = await temporaryHome();
  await createLocalSkill(
    { ...input, body: "Example:\n---\nname: other\ndescription: other\n---" },
    home,
  );
  expect(
    (await scanSkills({ homeDir: home })).find((skill) => skill.id === "agents:repo-review"),
  ).toMatchObject({ name: input.name, description: input.description });
});
