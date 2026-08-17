import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  createScreenshotAttachmentTarget,
  decorateScreenshotResult,
  persistScreenshotResult,
} from "./browser-screenshot.ts";
import { SessionStore } from "./store.ts";

test("createScreenshotAttachmentTarget writes under session attachments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-screenshot-target-"));
  const store = new SessionStore(root);
  const target = createScreenshotAttachmentTarget(store, "chat-session-1", {
    id: "11111111-1111-4111-8111-111111111111",
    now: 1_700_000_000_000,
  });
  assert.equal(target.attachmentId, "11111111-1111-4111-8111-111111111111");
  assert.equal(target.fileName, "screenshot-1700000000000.png");
  assert.equal(
    target.path,
    path.join(
      root,
      "sessions",
      "chat-session-1",
      "attachments",
      "11111111-1111-4111-8111-111111111111-screenshot-1700000000000.png",
    ),
  );
});

test("decorateScreenshotResult adds attachment fields on success", () => {
  const decorated = decorateScreenshotResult(
    {
      ok: true,
      sessionId: "browser-1",
      data: { path: "/tmp/old.png", mimeType: "image/png", width: 800, height: 600 },
    },
    {
      attachmentId: "att-1",
      fileName: "screenshot-1.png",
      path: "/data/sessions/chat/attachments/att-1-screenshot-1.png",
    },
  );
  assert.deepEqual(decorated, {
    ok: true,
    sessionId: "browser-1",
    data: {
      path: "/data/sessions/chat/attachments/att-1-screenshot-1.png",
      mimeType: "image/png",
      width: 800,
      height: 600,
      attachmentId: "att-1",
      fileName: "screenshot-1.png",
    },
  });
});

test("decorateScreenshotResult leaves failed results unchanged", () => {
  const failed = { ok: false, code: "unknown_session", message: "浏览器 session 不存在或已关闭" };
  assert.deepEqual(
    decorateScreenshotResult(failed, {
      attachmentId: "att-1",
      fileName: "screenshot-1.png",
      path: "/data/shot.png",
    }),
    failed,
  );
});

test("persistScreenshotResult copies a temp file into the attachment path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-screenshot-persist-"));
  const tempFile = path.join(root, "temp-shot.png");
  await writeFile(tempFile, "png-bytes");
  const target = {
    attachmentId: "att-2",
    fileName: "screenshot-2.png",
    path: path.join(root, "sessions", "chat-1", "attachments", "att-2-screenshot-2.png"),
  };
  const persisted = await persistScreenshotResult(
    { ok: true, data: { path: tempFile, mimeType: "image/png", width: 10, height: 20 } },
    target,
  );
  assert.equal(await readFile(target.path, "utf8"), "png-bytes");
  await assert.rejects(readFile(tempFile), { code: "ENOENT" });
  assert.deepEqual(persisted.data, {
    path: target.path,
    mimeType: "image/png",
    width: 10,
    height: 20,
    attachmentId: "att-2",
    fileName: "screenshot-2.png",
  });
});

test("persistScreenshotResult leaves failed results and source files unchanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-screenshot-fail-"));
  const tempFile = path.join(root, "temp-shot.png");
  await writeFile(tempFile, "png-bytes");
  const failed = { ok: false as const, code: "unknown_session", message: "missing" };
  const persisted = await persistScreenshotResult(failed, {
    attachmentId: "att-4",
    fileName: "screenshot-4.png",
    path: path.join(root, "attachments", "att-4-screenshot-4.png"),
  });
  assert.deepEqual(persisted, failed);
  assert.equal(await readFile(tempFile, "utf8"), "png-bytes");
});

test("persistScreenshotResult keeps a file already written to the attachment path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-screenshot-keep-"));
  const targetPath = path.join(root, "attachments", "att-3-screenshot-3.png");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, "direct");
  const persisted = await persistScreenshotResult(
    { ok: true, data: { path: targetPath, mimeType: "image/png" } },
    { attachmentId: "att-3", fileName: "screenshot-3.png", path: targetPath },
  );
  assert.equal(await readFile(targetPath, "utf8"), "direct");
  assert.equal((persisted.data as { attachmentId?: string }).attachmentId, "att-3");
});
