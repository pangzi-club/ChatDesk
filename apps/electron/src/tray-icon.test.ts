import { describe, expect, it } from "vitest";
import {
  createTrayIconBuffer,
  padTrayMenuLabel,
  renderTriangleIcon,
  triangleVertices,
} from "./tray-icon.js";

describe("triangle tray icon", () => {
  it("keeps canvas corners empty and the centroid filled", () => {
    const size = 32;
    const rgba = renderTriangleIcon(size, { r: 0, g: 0, b: 0 });
    const [top, bottomLeft, bottomRight] = triangleVertices(size);
    const centroidX = Math.round((top.x + bottomLeft.x + bottomRight.x) / 3);
    const centroidY = Math.round((top.y + bottomLeft.y + bottomRight.y) / 3);
    expect(rgba[3]).toBe(0);
    expect(rgba[(size * (size - 1) + (size - 1)) * 4 + 3]).toBe(0);
    expect(rgba[(centroidY * size + centroidX) * 4 + 3]).toBe(255);
  });

  it("encodes a PNG that macOS can use as a template image", () => {
    const { png, scaleFactor, template } = createTrayIconBuffer("darwin");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(scaleFactor).toBe(2);
    expect(template).toBe(true);
    expect(png.readUInt32BE(16)).toBe(36);
    expect(png.readUInt32BE(20)).toBe(36);
  });

  it("uses a colored triangle on non-mac platforms", () => {
    const { scaleFactor, template, png } = createTrayIconBuffer("win32");
    expect(template).toBe(false);
    expect(scaleFactor).toBe(1);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("pads tray menu labels so the popup stays wide", () => {
    const padded = padTrayMenuLabel("设置");
    expect(padded.startsWith("设置")).toBe(true);
    expect(padded.endsWith("\u200B")).toBe(true);
    expect(padded.length).toBeGreaterThan("设置".length);
    expect(padTrayMenuLabel("退出 ChatDesk").length).toBeGreaterThan("退出 ChatDesk".length);
  });
});
