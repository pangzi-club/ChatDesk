import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanExternalPluginDirectories } from "./plugin-registry.js";

const temporaryDirectories: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "chatdesk-plugins-"));
  temporaryDirectories.push(root);
  return root;
}

async function writePlugin(
  root: string,
  id: string,
  options: { manifest?: string; entry?: string | null } = {},
) {
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "plugin.json"), options.manifest ?? `{ "id": "${id}" }`, "utf8");
  if (options.entry !== null) {
    await writeFile(join(directory, "index.js"), options.entry ?? "module.exports = {};", "utf8");
  }
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});

describe("scanExternalPluginDirectories", () => {
  it("collects plugins from a collection root", async () => {
    const root = await temporaryRoot();
    await writePlugin(root, "alpha");
    await writePlugin(root, "beta");

    const items = await scanExternalPluginDirectories([root]);
    const ids = items.map((item) => item.id).sort();
    expect(ids).toEqual(["alpha", "beta"]);
    expect(items[0]?.manifestJson).toContain('"id"');
    expect(items[0]?.entrySource).toBe("module.exports = {};");
    expect(items[0]?.error).toBeNull();
  });

  it("treats a root containing plugin.json as a single plugin", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "plugin.json"), '{ "id": "solo" }', "utf8");
    await writeFile(join(root, "index.js"), "module.exports = {};", "utf8");

    const items = await scanExternalPluginDirectories([root]);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(basename(root));
    expect(items[0]?.directory).toBe(root);
  });

  it("skips missing roots and directories without a manifest", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "not-a-plugin"), { recursive: true });
    await mkdir(join(root, ".hidden"), { recursive: true });
    await writePlugin(join(root, ".hidden"), "ignored");

    const items = await scanExternalPluginDirectories([
      join(root, "does-not-exist"),
      root,
    ]);
    expect(items).toHaveLength(0);
  });

  it("reports a plugin whose entry file is missing", async () => {
    const root = await temporaryRoot();
    await writePlugin(root, "broken", { entry: null });

    const items = await scanExternalPluginDirectories([root]);
    expect(items).toHaveLength(1);
    expect(items[0]?.manifestJson).toContain("broken");
    expect(items[0]?.entrySource).toBeNull();
    expect(items[0]?.error).toContain("index.js");
  });

  it("skips symlinked plugin directories", async () => {
    const root = await temporaryRoot();
    const real = await writePlugin(root, "real");
    await symlink(real, join(root, "linked"));

    const items = await scanExternalPluginDirectories([root]);
    expect(items.map((item) => item.id)).toEqual(["real"]);
  });

  it("deduplicates the same directory reached through two roots", async () => {
    const outer = await temporaryRoot();
    const inner = join(outer, "bundle");
    await mkdir(inner, { recursive: true });
    await writePlugin(inner, "alpha");

    const items = await scanExternalPluginDirectories([outer, inner]);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("alpha");
  });
});
