import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

// Mirrors `ExternalPluginScanItem` from @chatdesk/shared; the Electron host
// keeps its IPC surface self-typed instead of importing renderer-facing code.
export type ExternalPluginScanItem = {
  id: string;
  directory: string;
  manifestJson: string | null;
  entrySource: string | null;
  error: string | null;
};

const MANIFEST_FILE = "plugin.json";
const ENTRY_FILE = "index.js";
const MANIFEST_MAX_BYTES = 64 * 1024;
const ENTRY_MAX_BYTES = 1024 * 1024;

type BoundedRead = { content: string | null; error: string | null };

async function isRealDirectory(directory: string) {
  const metadata = await lstat(directory).catch(() => null);
  return !!metadata && metadata.isDirectory() && !metadata.isSymbolicLink();
}

async function fileExists(filePath: string) {
  const metadata = await lstat(filePath).catch(() => null);
  return !!metadata && metadata.isFile() && !metadata.isSymbolicLink();
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<BoundedRead> {
  const label = basename(filePath);
  const metadata = await lstat(filePath).catch(() => null);
  if (!metadata) return { content: null, error: `缺少 ${label}` };
  if (metadata.isSymbolicLink()) return { content: null, error: `${label} 不能是符号链接` };
  if (!metadata.isFile()) return { content: null, error: `${label} 不是普通文件` };
  if (metadata.size > maxBytes) return { content: null, error: `${label} 超过大小限制` };
  const content = await readFile(filePath, { encoding: "utf8" });
  return { content, error: null };
}

async function scanPluginDirectory(directory: string): Promise<ExternalPluginScanItem> {
  const id = basename(directory);
  const manifest = await readBoundedFile(join(directory, MANIFEST_FILE), MANIFEST_MAX_BYTES);
  if (!manifest.content) {
    return { id, directory, manifestJson: null, entrySource: null, error: manifest.error };
  }
  const entry = await readBoundedFile(join(directory, ENTRY_FILE), ENTRY_MAX_BYTES);
  if (!entry.content) {
    return { id, directory, manifestJson: manifest.content, entrySource: null, error: entry.error };
  }
  return {
    id,
    directory,
    manifestJson: manifest.content,
    entrySource: entry.content,
    error: null,
  };
}

async function listPluginChildDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;
    const directory = join(root, entry.name);
    if (await fileExists(join(directory, MANIFEST_FILE))) directories.push(directory);
  }
  return directories;
}

/**
 * Scan plugin roots on disk. A root is either a collection directory holding
 * one plugin per child folder (`<root>/<id>/plugin.json`) or a single plugin
 * directory itself (`<root>/plugin.json`). Missing roots are skipped silently
 * so a stale user-added directory never breaks the scan; per-plugin problems
 * surface on the item itself for the renderer to display.
 */
export async function scanExternalPluginDirectories(
  roots: readonly string[],
): Promise<ExternalPluginScanItem[]> {
  const seen = new Set<string>();
  const items: ExternalPluginScanItem[] = [];
  for (const root of roots) {
    if (!(await isRealDirectory(root))) continue;
    const rootIsPlugin = await fileExists(join(root, MANIFEST_FILE));
    const candidates = rootIsPlugin ? [root] : await listPluginChildDirectories(root);
    for (const directory of candidates) {
      if (seen.has(directory)) continue;
      seen.add(directory);
      items.push(await scanPluginDirectory(directory));
    }
  }
  return items;
}
