import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopUiSlotName } from "@chatdesk/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalPlugin } from "./create-plugin.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function home() {
  const root = await mkdtemp(join(tmpdir(), "chatdesk-plugin-home-"));
  roots.push(root);
  return root;
}
const base = {
  id: "snake",
  name: "Snake",
  description: "A game",
  contributes: ["route"] as DesktopUiSlotName[],
  code: "module.exports = { apply() {} };",
};

describe("createLocalPlugin", () => {
  it("creates manifest and entry", async () => {
    const root = await home();
    await createLocalPlugin(base, root);
    expect(
      JSON.parse(await readFile(join(root, ".chatdesk/plugins/snake/plugin.json"), "utf8")).id,
    ).toBe("snake");
  });
  it("does not overwrite existing plugin", async () => {
    const root = await home();
    await createLocalPlugin(base, root);
    await expect(createLocalPlugin(base, root)).rejects.toThrow("已存在");
  });
  it("rejects invalid syntax and symlinked roots", async () => {
    const root = await home();
    await expect(createLocalPlugin({ ...base, code: "oops(" }, root)).rejects.toThrow("语法");
    const symlinkHome = await home();
    const target = await mkdtemp(join(tmpdir(), "chatdesk-plugin-target-"));
    roots.push(target);
    await mkdir(join(symlinkHome, ".chatdesk"));
    await symlink(target, join(symlinkHome, ".chatdesk/plugins"));
    await expect(createLocalPlugin(base, symlinkHome)).rejects.toThrow("符号链接");
  });
});
