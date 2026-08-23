import assert from "node:assert/strict";
import sharp from "sharp";
import { test } from "vitest";
import {
  compressChatImage,
  loadSharp,
  MAX_CHAT_IMAGE_EDGE,
  replaceImageFileName,
  TARGET_CHAT_IMAGE_MAX_BYTES,
} from "./image-compress.ts";

async function noisyPng(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 1) {
    raw[index] = (index * 13) % 256;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

test("compressChatImage downscales oversized photos to webp", async () => {
  const input = await noisyPng(3000, 2000);
  const result = await compressChatImage(input);
  assert.equal(result.changed, true);
  assert.equal(result.mediaType, "image/webp");
  assert.ok((result.width ?? 0) <= MAX_CHAT_IMAGE_EDGE);
  assert.ok((result.height ?? 0) <= MAX_CHAT_IMAGE_EDGE);
  assert.ok(result.bytes.byteLength <= TARGET_CHAT_IMAGE_MAX_BYTES);
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.ok((meta.width ?? 0) <= MAX_CHAT_IMAGE_EDGE);
});

test("compressChatImage keeps detailed photos under the payload budget", async () => {
  const raw = Buffer.alloc(2400 * 1600 * 3);
  for (let index = 0; index < raw.length; index += 1) raw[index] = (index * 31) % 256;
  const input = await sharp(raw, { raw: { width: 2400, height: 1600, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  const result = await compressChatImage(input);
  assert.equal(result.changed, true);
  assert.ok(result.bytes.byteLength < input.byteLength);
  assert.ok(result.bytes.byteLength <= TARGET_CHAT_IMAGE_MAX_BYTES);
  assert.ok((result.width ?? 0) <= MAX_CHAT_IMAGE_EDGE);
});

test("compressChatImage leaves small jpeg/png/webp unchanged", async () => {
  const input = await sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 8, g: 16, b: 32 } },
  })
    .png()
    .toBuffer();
  const result = await compressChatImage(input);
  assert.equal(result.changed, false);
  assert.equal(result.mediaType, "image/png");
  assert.equal(result.width, 32);
  assert.equal(result.height, 24);
  assert.deepEqual(result.bytes, input);
});

test("compressChatImage leaves non-images unchanged", async () => {
  const input = Buffer.from("not an image");
  const result = await compressChatImage(input);
  assert.equal(result.changed, false);
  assert.equal(result.mediaType, undefined);
  assert.deepEqual(result.bytes, input);
});

test("compressChatImage leaves undecodable bytes unchanged", async () => {
  const input = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
  const result = await compressChatImage(input);
  assert.equal(result.changed, false);
  assert.deepEqual(result.bytes, input);
});

test("loadSharp resolves the native module from the server package", async () => {
  const ctor = await loadSharp();
  assert.equal(typeof ctor, "function");
  const bytes = await ctor({
    create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  assert.ok(bytes.byteLength > 0);
});

test("replaceImageFileName swaps or appends the matching extension", () => {
  assert.equal(replaceImageFileName("photo.PNG", "image/webp"), "photo.webp");
  assert.equal(replaceImageFileName("screenshot-1.png", "image/webp"), "screenshot-1.webp");
  assert.equal(replaceImageFileName("noext", "image/webp"), "noext.webp");
  assert.equal(replaceImageFileName("note.txt", "application/pdf"), "note.txt");
});
