import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  CUA_DRIVER_VERSION,
  cuaDriverAsset,
  cuaDriverExecutableName,
  cuaDriverLocalCandidates,
  cuaDriverTargetPath,
  downloadCuaDriver,
  findCuaDriverBinary,
  resolveLocalCuaDriver,
  stageCuaDriver,
} from "./cua-driver.mjs";

let work;

before(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "cua-driver-test-"));
});

after(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("cuaDriverAsset", () => {
  it("pins the release asset and digest per platform and architecture", () => {
    const arm = cuaDriverAsset("darwin", "arm64");
    assert.equal(arm.name, `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-arm64.tar.gz`);
    assert.equal(
      arm.url,
      `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}/${arm.name}`,
    );
    assert.equal(arm.sha256, "fd0cf565db831ad34d44a3c2321439575e02a6ce3ca97d04f267db1da7883685");

    assert.equal(
      cuaDriverAsset("darwin", "x64").sha256,
      "66db9b244c12e0f416212ca3421afb7cda6b1b927fb6536943919bb7eff5e10b",
    );
    assert.match(cuaDriverAsset("win32", "x64").name, /windows-x86_64\.zip$/);
    assert.equal(cuaDriverAsset("darwin", "ppc64"), null);
  });
});

describe("cuaDriverTargetPath", () => {
  it("stages into the desktop assets directory the packager copies", () => {
    assert.match(
      cuaDriverTargetPath("darwin"),
      /apps[/\\]desktop[/\\]assets[/\\]binaries[/\\]cua-driver$/,
    );
    assert.match(cuaDriverTargetPath("win32"), /cua-driver\.exe$/);
    assert.equal(cuaDriverExecutableName("win32"), "cua-driver.exe");
    assert.equal(cuaDriverExecutableName("linux"), "cua-driver");
  });
});

describe("cuaDriverLocalCandidates", () => {
  it("prefers explicit configuration, then the staged binary, then system installs", () => {
    const candidates = cuaDriverLocalCandidates({
      platform: "darwin",
      home: "/home/dev",
      env: { CHATDESK_CUA_DRIVER: "/custom/cua-driver", CUA_DRIVER_BINARY: "/other/cua-driver" },
      target: "/repo/apps/desktop/assets/binaries/cua-driver",
    });

    assert.deepEqual(candidates, [
      "/custom/cua-driver",
      "/other/cua-driver",
      "/repo/apps/desktop/assets/binaries/cua-driver",
      "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
      "/home/dev/.local/bin/cua-driver",
    ]);
  });

  it("omits macOS locations on other platforms", () => {
    const candidates = cuaDriverLocalCandidates({
      platform: "linux",
      home: "/home/dev",
      env: {},
      target: "/repo/apps/desktop/assets/binaries/cua-driver",
    });

    assert.deepEqual(candidates, [
      "/repo/apps/desktop/assets/binaries/cua-driver",
      "/home/dev/.local/bin/cua-driver",
    ]);
  });
});

describe("resolveLocalCuaDriver", () => {
  it("returns null when no candidate exists", () => {
    const resolved = resolveLocalCuaDriver({
      platform: "linux",
      home: path.join(work, "missing-home"),
      env: {},
      target: path.join(work, "missing-target"),
      probePath: false,
    });

    assert.equal(resolved, null);
  });

  it("returns the staged binary once it exists and is executable", async () => {
    const target = path.join(work, "staged", "cua-driver");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "#!/bin/sh\n", { mode: 0o755 });

    const resolved = resolveLocalCuaDriver({
      platform: "linux",
      home: path.join(work, "missing-home"),
      env: {},
      target,
      probePath: false,
    });

    assert.equal(resolved, target);
  });
});

describe("findCuaDriverBinary", () => {
  it("takes the top-level binary and ignores the bundled app", async () => {
    const root = path.join(work, "archive");
    const topLevel = path.join(root, "cua-driver-rs-0.24.0-darwin-x86_64", "cua-driver");
    const bundled = path.join(
      root,
      "cua-driver-rs-0.24.0-darwin-x86_64",
      "CuaDriver.app",
      "Contents",
      "MacOS",
      "cua-driver",
    );
    await mkdir(path.dirname(topLevel), { recursive: true });
    await mkdir(path.dirname(bundled), { recursive: true });
    await writeFile(topLevel, "top-level");
    await writeFile(bundled, "bundled");
    await mkdir(path.join(work, "empty"), { recursive: true });

    assert.equal(findCuaDriverBinary(root, "cua-driver"), topLevel);
    assert.equal(findCuaDriverBinary(path.join(work, "empty"), "cua-driver"), null);
  });
});

describe("downloadCuaDriver", () => {
  it("rejects a payload whose digest does not match the pin", async () => {
    await assert.rejects(
      downloadCuaDriver({
        platform: "darwin",
        arch: "arm64",
        target: path.join(work, "download", "cua-driver"),
        fetchImpl: async () => ({
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode("not the driver").buffer,
        }),
        log: () => {},
      }),
      /校验失败/,
    );
  });

  it("rejects a failed HTTP response", async () => {
    await assert.rejects(
      downloadCuaDriver({
        platform: "darwin",
        arch: "arm64",
        target: path.join(work, "download", "cua-driver"),
        fetchImpl: async () => ({ ok: false, status: 404 }),
        log: () => {},
      }),
      /HTTP 404/,
    );
  });

  it("reports platforms without a pinned asset", async () => {
    await assert.rejects(
      downloadCuaDriver({ platform: "darwin", arch: "ppc64", log: () => {} }),
      /没有为 darwin-ppc64 固定/,
    );
  });
});

describe("stageCuaDriver", () => {
  it("copies a local driver into the target path and keeps it executable", async () => {
    const source = path.join(work, "local-install", "cua-driver");
    const target = path.join(work, "staged-by-stage", "cua-driver");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "#!/bin/sh\necho cua-driver\n", { mode: 0o755 });

    const staged = await stageCuaDriver({
      platform: "darwin",
      target,
      env: { CHATDESK_CUA_DRIVER: source },
      probePath: false,
      log: () => {},
    });

    assert.equal(staged, target);
    assert.equal(await readFile(target, "utf8"), "#!/bin/sh\necho cua-driver\n");
  });

  it("warns and returns null when nothing is available", async () => {
    const messages = [];
    const staged = await stageCuaDriver({
      platform: "linux",
      target: path.join(work, "staged-missing", "cua-driver"),
      env: {},
      home: path.join(work, "missing-home"),
      probePath: false,
      log: (message) => messages.push(message),
    });

    assert.equal(staged, null);
    assert.match(messages.join("\n"), /not staged/);
  });
});
