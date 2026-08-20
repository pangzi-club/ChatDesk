import { crc32, deflateSync } from "node:zlib";

export type TrayIconColor = { r: number; g: number; b: number };

const TEMPLATE_COLOR: TrayIconColor = { r: 0, g: 0, b: 0 };
const COLOR_ICON: TrayIconColor = { r: 47, g: 128, b: 237 };
const TRAY_TEMPLATE_POINT_SIZE = 18;
const TRAY_TEMPLATE_SCALE = 2;
const TRAY_COLOR_ICON_SIZE = 32;
const TRAY_MENU_MIN_WIDTH = 28;
const TRAY_MENU_PAD = "\u00A0";

type Point = { x: number; y: number };

export function triangleVertices(size: number): [Point, Point, Point] {
  const inset = size * 0.06;
  const side = size - inset * 2;
  const height = (side * Math.sqrt(3)) / 2;
  const top = { x: size / 2, y: (size - height) / 2 };
  return [
    top,
    { x: top.x - side / 2, y: top.y + height },
    { x: top.x + side / 2, y: top.y + height },
  ];
}

function edgeSign(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function pointInTriangle(px: number, py: number, a: Point, b: Point, c: Point) {
  const d1 = edgeSign(px, py, a.x, a.y, b.x, b.y);
  const d2 = edgeSign(px, py, b.x, b.y, c.x, c.y);
  const d3 = edgeSign(px, py, c.x, c.y, a.x, a.y);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function triangleCoverage(px: number, py: number, a: Point, b: Point, c: Point) {
  const inside = pointInTriangle(px, py, a, b, c);
  const distance = Math.min(
    distanceToSegment(px, py, a.x, a.y, b.x, b.y),
    distanceToSegment(px, py, b.x, b.y, c.x, c.y),
    distanceToSegment(px, py, c.x, c.y, a.x, a.y),
  );
  if (inside) return Math.min(1, 0.5 + distance);
  return Math.max(0, 0.5 - distance);
}

export function renderTriangleIcon(size: number, fill: TrayIconColor) {
  const [a, b, c] = triangleVertices(size);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coverage = triangleCoverage(x + 0.5, y + 0.5, a, b, c);
      const index = (y * size + x) * 4;
      rgba[index] = fill.r;
      rgba[index + 1] = fill.g;
      rgba[index + 2] = fill.b;
      rgba[index + 3] = Math.round(coverage * 255);
    }
  }
  return rgba;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBuffer, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

export function rgbaToPng(rgba: Uint8Array, width: number, height: number) {
  if (rgba.length !== width * height * 4) throw new Error("RGBA 尺寸不匹配");
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const source = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    source.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function createTrayIconBuffer(platform: NodeJS.Platform) {
  const template = platform === "darwin";
  const size = template ? TRAY_TEMPLATE_POINT_SIZE * TRAY_TEMPLATE_SCALE : TRAY_COLOR_ICON_SIZE;
  const fill = template ? TEMPLATE_COLOR : COLOR_ICON;
  return {
    png: rgbaToPng(renderTriangleIcon(size, fill), size, size),
    scaleFactor: template ? TRAY_TEMPLATE_SCALE : 1,
    template,
  };
}

export function padTrayMenuLabel(label: string, minWidth = TRAY_MENU_MIN_WIDTH) {
  let width = 0;
  for (const char of label) {
    width += char.charCodeAt(0) < 128 ? 1 : 2;
  }
  const pad = Math.max(0, minWidth - width);
  return `${label}${TRAY_MENU_PAD.repeat(pad)}\u200B`;
}
