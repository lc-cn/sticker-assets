// 仅用于生成自制测试图（不用于生产处理）：极简 PNG(RGBA) 与 GIF(调色板+LZW) 编码器。
import { deflateSync, crc32 } from 'node:zlib';

export class Canvas {
  constructor(w, h, bg = [255, 255, 255, 255]) {
    this.w = w; this.h = h; this.px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 4);
  }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px.set(c, (y * this.w + x) * 4); }
  rect(x0, y0, w, h, c) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c); }
  circle(cx, cy, r, c) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c); }
  arc(cx, cy, r, c, up = false) { for (let a = 0; a <= 180; a += 2) { const t = (a * Math.PI) / 180; this.set(Math.round(cx + r * Math.cos(t)), Math.round(cy + (up ? -1 : 1) * r * Math.sin(t)), c); } }
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function encodePng(cv) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0); ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((cv.w * 4 + 1) * cv.h);
  for (let y = 0; y < cv.h; y++) { raw[y * (cv.w * 4 + 1)] = 0; Buffer.from(cv.px.buffer, y * cv.w * 4, cv.w * 4).copy(raw, y * (cv.w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** 可选：给 PNG 插入 tEXt 元数据块（测试“未剥离元数据”拒绝用） */
export function pngWithText(png, key, value) {
  const iendAt = png.length - 12;
  return Buffer.concat([png.subarray(0, iendAt), chunk('tEXt', Buffer.from(`${key}\0${value}`, 'latin1')), png.subarray(iendAt)]);
}

function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1, dict = new Map();
  const out = []; let cur = 0, bits = 0;
  const emit = (c) => { cur |= c << bits; bits += codeSize; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k, v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); dict = new Map(); next = eoi + 1; codeSize = minCodeSize + 1; }
    else { if (next >= 1 << codeSize) codeSize++; dict.set(key, next++); }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return Buffer.from(out);
}

const subBlocks = (buf) => { const parts = []; for (let i = 0; i < buf.length; i += 255) { const s = buf.subarray(i, i + 255); parts.push(Buffer.from([s.length]), s); } parts.push(Buffer.from([0])); return Buffer.concat(parts); };

/** frames: Uint8Array 调色板索引数组；palette: [[r,g,b]...] 长度为 2 的幂(≥4) */
export function encodeGif(w, h, palette, frames, delayCs = 30) {
  const n = Math.log2(palette.length);
  if (!Number.isInteger(n) || n < 2) throw new Error('palette 长度须为 2 的幂且 ≥4');
  const head = Buffer.alloc(13);
  head.write('GIF89a', 0, 'latin1'); head.writeUInt16LE(w, 6); head.writeUInt16LE(h, 8);
  head[10] = 0x80 | ((n - 1) << 4) | (n - 1); head[11] = 0; head[12] = 0;
  const gct = Buffer.from(palette.flat());
  const loop = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'latin1'), 0x03, 0x01, 0x00, 0x00, 0x00]);
  const parts = [head, gct, loop];
  for (const f of frames) {
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x04, delayCs & 255, delayCs >> 8, 0x00, 0x00]));
    const desc = Buffer.alloc(10); desc[0] = 0x2c; desc.writeUInt16LE(w, 5); desc.writeUInt16LE(h, 7); desc[9] = 0;
    parts.push(desc, Buffer.from([n]), subBlocks(lzw(f, n)));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
