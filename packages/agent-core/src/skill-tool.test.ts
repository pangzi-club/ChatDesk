import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReadSkillTool, formatBuiltinSkillsCatalog } from "./skill-tool.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("formatBuiltinSkillsCatalog", () => {
  it("returns an empty string when there are no builtin skills", () => {
    expect(formatBuiltinSkillsCatalog([])).toBe("");
  });

  it("lists name, id, and description for on-demand loading", () => {
    const catalog = formatBuiltinSkillsCatalog([
      {
        id: "builtin:chatdesk-doc",
        name: "chatdesk-doc",
        description: "How to use ChatDesk.",
        source: "builtin",
        path: "/skills/chatdesk-doc/SKILL.md",
        content: "unused",
      },
    ]);
    expect(catalog).toContain("## ChatDesk 内置 Skills");
    expect(catalog).toContain("`builtin:chatdesk-doc`");
    expect(catalog).toContain("How to use ChatDesk.");
    expect(catalog).toContain("read_skill");
    expect(catalog).not.toContain("unused");
  });
});

describe("read_skill tool", () => {
  it("reads a builtin skill file and rejects traversal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-read-skill-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "chatdesk-doc"));
    await writeFile(path.join(root, "chatdesk-doc", "SKILL.md"), "# Guide\n", "utf8");
    const execute = createReadSkillTool({
      env: { CHATDESK_BUILTIN_SKILLS_DIR: root },
    }).execute;
    if (!execute) throw new Error("read_skill 缺少 execute");
    const result = (await execute({ skillId: "builtin:chatdesk-doc" }, {
      toolCallId: "test",
      messages: [],
      abortSignal: new AbortController().signal,
    } as never)) as { content: string };
    expect(result.content).toContain("# Guide");
    await expect(
      execute({ skillId: "builtin:chatdesk-doc", path: "../SKILL.md" }, {
        toolCallId: "test",
        messages: [],
        abortSignal: new AbortController().signal,
      } as never),
    ).rejects.toThrow(/必须位于该 skill 目录内|未找到 skill 文件/);
  });
});
