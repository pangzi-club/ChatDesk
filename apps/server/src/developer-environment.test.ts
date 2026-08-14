import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEVELOPMENT_TOOL_NAMES } from "@chatdesk/shared";
import { afterEach, describe, it } from "vitest";
import {
  buildDeveloperToolImportCommand,
  inspectDeveloperEnvironment,
  normalizeDeveloperToolPaths,
} from "./developer-environment.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("developer environment", () => {
  it("builds shell-specific commands for the complete allowlist", () => {
    const posix = buildDeveloperToolImportCommand("marker", "/bin/zsh");
    const fish = buildDeveloperToolImportCommand("marker", "/opt/homebrew/bin/fish");

    for (const name of DEVELOPMENT_TOOL_NAMES) {
      assert.match(posix, new RegExp(`(?:^| )${name.replaceAll("+", "\\+")}(?: |;)`));
      assert.match(fish, new RegExp(`(?:^| )${name.replaceAll("+", "\\+")}(?: |;)`));
    }
    assert.match(posix, /command -v/);
    assert.match(fish, /command -s/);
  });

  it("only reports allowlisted executable files from configured directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-tools-"));
    temporaryDirectories.push(root);
    const bin = path.join(root, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "node"), "#!/bin/sh\n", "utf8");
    await chmod(path.join(bin, "node"), 0o755);
    await writeFile(path.join(bin, "secret-tool"), "#!/bin/sh\n", "utf8");
    await chmod(path.join(bin, "secret-tool"), 0o755);

    const status = await inspectDeveloperEnvironment([bin]);

    assert.deepEqual(status.paths, [bin]);
    assert.equal(status.tools.find((tool) => tool.name === "node")?.available, true);
    assert.deepEqual(
      status.tools.map((tool) => tool.name),
      [...DEVELOPMENT_TOOL_NAMES],
    );
  });

  it("drops relative, missing and non-directory paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-tool-paths-"));
    temporaryDirectories.push(root);
    const file = path.join(root, "file");
    const bin = path.join(root, "bin");
    await writeFile(file, "not a directory", "utf8");
    await mkdir(bin);
    await writeFile(path.join(bin, "go"), "#!/bin/sh\n", "utf8");
    await chmod(path.join(bin, "go"), 0o755);

    assert.deepEqual(
      await normalizeDeveloperToolPaths([
        "relative/bin",
        "/",
        os.homedir(),
        path.join(root, "missing"),
        file,
        bin,
      ]),
      [bin],
    );
  });
});
