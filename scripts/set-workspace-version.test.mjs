import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  applyPackageVersion,
  isWorkspaceVersion,
  parseArgs,
  setWorkspaceVersions,
  shouldSkipManifest,
} from "./set-workspace-version.mjs";

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts/set-workspace-version.mjs");

function packageJson(version) {
  return `{
  "name": "example",
  "version": "${version}",
  "private": true
}
`;
}

test("parseArgs reads version and dry-run", () => {
  assert.deepEqual(parseArgs(["0.5.0"]), {
    dryRun: false,
    help: false,
    version: "0.5.0",
  });
  assert.deepEqual(parseArgs(["0.5.0", "--dry-run"]), {
    dryRun: true,
    help: false,
    version: "0.5.0",
  });
  assert.deepEqual(parseArgs(["--help"]), {
    dryRun: false,
    help: true,
    version: undefined,
  });
  assert.throws(() => parseArgs(["--unknown"]), /未知参数/);
  assert.throws(() => parseArgs(["0.5.0", "0.6.0"]), /多余参数/);
});

test("isWorkspaceVersion accepts semver-like values", () => {
  assert.equal(isWorkspaceVersion("0.5.0"), true);
  assert.equal(isWorkspaceVersion("1.0.0-beta.1"), true);
  assert.equal(isWorkspaceVersion("1.0.0+build.2"), true);
  assert.equal(isWorkspaceVersion("v0.5.0"), false);
  assert.equal(isWorkspaceVersion("0.5"), false);
});

test("shouldSkipManifest does not skip workspace package manifests", () => {
  assert.equal(shouldSkipManifest("package.json"), false);
  assert.equal(shouldSkipManifest("apps/desktop/package.json"), false);
  assert.equal(shouldSkipManifest("apps/electron/package.json"), false);
});

test("applyPackageVersion only rewrites the version field", () => {
  const source = packageJson("0.4.0");
  assert.deepEqual(applyPackageVersion(source, "0.4.0"), {
    previous: "0.4.0",
    source,
    changed: false,
  });

  const updated = applyPackageVersion(source, "0.5.0");
  assert.equal(updated.previous, "0.4.0");
  assert.equal(updated.changed, true);
  assert.equal(updated.source, packageJson("0.5.0"));
});

test("setWorkspaceVersions updates workspace packages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-set-version-"));
  await mkdir(path.join(root, "apps", "desktop", "assets"), { recursive: true });
  await mkdir(path.join(root, "packages", "shared"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "left-alone"), { recursive: true });
  await writeFile(path.join(root, "package.json"), packageJson("0.4.0"));
  await writeFile(path.join(root, "apps", "desktop", "package.json"), packageJson("0.4.0"));
  await writeFile(
    path.join(root, "apps", "desktop", "assets", "package.json"),
    packageJson("9.9.9"),
  );
  await writeFile(path.join(root, "packages", "shared", "package.json"), packageJson("0.4.0"));
  await writeFile(
    path.join(root, "node_modules", "left-alone", "package.json"),
    packageJson("9.9.9"),
  );

  const preview = await setWorkspaceVersions(root, "0.5.0", { dryRun: true });
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), packageJson("0.4.0"));
  assert.equal(preview.filter((result) => result.changed).length, 3);

  const results = await setWorkspaceVersions(root, "0.5.0");
  assert.deepEqual(
    results.map((result) => result.relativePath).sort(),
    ["apps/desktop/package.json", "package.json", "packages/shared/package.json"].sort(),
  );
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), packageJson("0.5.0"));
  assert.equal(
    await readFile(path.join(root, "apps", "desktop", "package.json"), "utf8"),
    packageJson("0.5.0"),
  );
  assert.equal(
    await readFile(path.join(root, "packages", "shared", "package.json"), "utf8"),
    packageJson("0.5.0"),
  );
  assert.equal(
    await readFile(path.join(root, "apps", "desktop", "assets", "package.json"), "utf8"),
    packageJson("9.9.9"),
  );
  assert.equal(
    await readFile(path.join(root, "node_modules", "left-alone", "package.json"), "utf8"),
    packageJson("9.9.9"),
  );
});

test("set-workspace-version CLI prints help and rejects invalid versions", async () => {
  const { stdout } = await execFileAsync(process.execPath, [script, "--help"]);
  assert.match(stdout, /pnpm version:set -- <version>/);

  await assert.rejects(execFileAsync(process.execPath, [script, "not-a-version"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /无效版本：not-a-version/);
    return true;
  });
});
