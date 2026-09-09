import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DESKTOP_UI_SLOTS } from "@chatdesk/shared";
import { tool } from "ai";
import { z } from "zod";

export const CREATE_PLUGIN_TOOL_NAME = "create_plugin";

const inputSchema = z.object({
  id: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  icon: z.string().trim().min(1).max(64).optional(),
  contributes: z.array(z.enum(DESKTOP_UI_SLOTS)).min(1),
  code: z.string().trim().min(1).max(1_000_000),
});

export async function createLocalPlugin(
  input: z.infer<typeof inputSchema>,
  homeDir = os.homedir(),
) {
  const value = inputSchema.parse(input);
  try {
    new Function("require", "module", "exports", `"use strict";\n${value.code}`);
  } catch (cause) {
    throw new Error(`插件代码语法错误：${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const home = await realpath(homeDir);
  const root = path.join(home, ".chatdesk", "plugins");
  let current = home;
  for (const component of [".chatdesk", "plugins"]) {
    current = path.join(current, component);
    await mkdir(current, { recursive: true });
    const metadata = await lstat(current);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      (await realpath(current)) !== current
    )
      throw new Error("插件目录必须是真实目录，不能使用符号链接");
  }
  const directory = path.join(root, value.id);
  await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error(`插件已存在，未覆盖：${value.id}`);
    throw error;
  });
  const manifest = {
    id: value.id,
    name: value.name,
    description: value.description,
    version: "1.0.0",
    apiVersion: 1,
    entry: "index.js",
    ...(value.icon ? { icon: value.icon } : {}),
    contributes: [...new Set(value.contributes)],
    permissions: [],
  };
  await writeFile(path.join(directory, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(path.join(directory, "index.js"), `${value.code}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { id: value.id, directory, created: true };
}

export function createPluginTool(options: { homeDir?: string } = {}) {
  return tool({
    description:
      "创建 ChatDesk 外部插件，写入 ~/.chatdesk/plugins/<id>。仅创建可信的纯 JavaScript 插件，不覆盖已有目录。",
    inputSchema,
    execute: async (input) => createLocalPlugin(input, options.homeDir),
  });
}
