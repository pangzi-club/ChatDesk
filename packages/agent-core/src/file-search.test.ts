import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { searchWorkspaceFiles, suggestWorkspacePaths } from "./file-search.ts";

const execFileAsync = promisify(execFile);

async function createGitWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-file-search-"));
  await mkdir(path.join(root, "src", "nested"), { recursive: true });
  await mkdir(path.join(root, "ignored"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), "ignored/\n", "utf8");
  await writeFile(path.join(root, "src", "main.ts"), "const SearchNeedle = true;\n", "utf8");
  await writeFile(
    path.join(root, "src", "nested", "other.ts"),
    "export const searchNeedle = false;\n",
    "utf8",
  );
  await writeFile(path.join(root, "README.md"), "SearchNeedle docs\n", "utf8");
  await writeFile(path.join(root, "ignored", "secret.ts"), "SearchNeedle ignored\n", "utf8");
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  return root;
}

describe("workspace file search", () => {
  it("suggests visible files and directories by case-insensitive path prefix", async () => {
    const root = await createGitWorkspace();
    const result = await suggestWorkspacePaths(root, "SRC/", 20);

    expect(result.suggestions).toEqual([
      { path: "src/main.ts", kind: "file" },
      { path: "src/nested/other.ts", kind: "file" },
      { path: "src/nested", kind: "dir" },
    ]);
    expect(result.suggestions.some((item) => item.path.includes("ignored"))).toBe(false);
  });

  it("matches a file by its final name", async () => {
    const root = await createGitWorkspace();
    const result = await suggestWorkspacePaths(root, "MAIN.TS", 20);

    expect(result.suggestions).toEqual([{ path: "src/main.ts", kind: "file" }]);
  });

  it("supports recursive globs, Git ignores, and content previews", async () => {
    const root = await createGitWorkspace();
    const result = await searchWorkspaceFiles(root, root, {
      pattern: "**/*.ts",
      query: "searchneedle",
    });

    expect(result.matches).toEqual(["src/main.ts", "src/nested/other.ts"]);
    expect(result.matches).not.toContain("ignored/secret.ts");
    expect(result.contentMatches).toEqual([
      {
        path: "src/main.ts",
        line: 1,
        column: 7,
        preview: "const SearchNeedle = true;",
      },
      {
        path: "src/nested/other.ts",
        line: 1,
        column: 14,
        preview: "export const searchNeedle = false;",
      },
    ]);
  });

  it("searches a single file and reports truncation accurately", async () => {
    const root = await createGitWorkspace();
    const single = await searchWorkspaceFiles(root, path.join(root, "README.md"), {
      query: "searchneedle",
    });
    const truncated = await searchWorkspaceFiles(root, root, {
      pattern: "**/*.ts",
      maxResults: 1,
    });

    expect(single.matches).toEqual(["README.md"]);
    expect(single.contentMatches?.[0]).toMatchObject({ path: "README.md", line: 1, column: 1 });
    expect(truncated.matches).toHaveLength(1);
    expect(truncated.truncated).toBe(true);
  });

  it("does not invoke ripgrep across protected descendants or open protected files", async () => {
    const root = await createGitWorkspace();
    const protectedDirectory = path.join(root, "credentials");
    await mkdir(protectedDirectory);
    await writeFile(path.join(protectedDirectory, "token.txt"), "SearchNeedle secret\n", "utf8");
    const canonicalProtectedDirectory = await realpath(protectedDirectory);
    const guard = {
      isReadable: (target: string) =>
        target !== canonicalProtectedDirectory &&
        !target.startsWith(`${canonicalProtectedDirectory}${path.sep}`),
      hasProtectedReadDescendant: () => true,
    };

    const result = await searchWorkspaceFiles(root, root, { query: "searchneedle" }, guard);

    expect(result.engine).toBe("builtin");
    expect(result.matches).toEqual(["README.md", "src/main.ts", "src/nested/other.ts"]);
    expect(result.matches).not.toContain("credentials/token.txt");
    expect(result.contentMatches?.some((item) => item.preview.includes("secret"))).toBe(false);
  });
});
