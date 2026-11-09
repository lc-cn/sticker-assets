import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inspectImage, budgetProblems } from '../lib/image.mjs';
import { stripMetadata } from '../lib/strip.mjs';
import { Canvas, encodePng, encodeGif, pngWithText } from '../scripts/fixture-encoders.mjs';
import { FIXTURE } from './helpers.mjs';

const limits = JSON.parse(readFileSync(join(FIXTURE, 'config/limits.json'), 'utf8'));

// 测试专用 GIF LZW 解码器：确认 fixture 编码器产出可正确解码
function decodeGifFrames(buf) {
  const frames = [];
  let off = 13 + ((buf[10] & 0x80) ? 3 * (1 << ((buf[10] & 7) + 1)) : 0);
  while (buf[off] !== 0x3b) {
    if (buf[off] === 0x21) { off += 2; while (buf[off]) off += buf[off] + 1; off++; continue; }
    const w = buf.readUInt16LE(off + 5), h = buf.readUInt16LE(off + 7);
    off += 10;
    const min = buf[off++];
    const data = [];
    while (buf[off]) { data.push(...buf.subarray(off + 1, off + 1 + buf[off])); off += buf[off] + 1; }
    off++;
    const clear = 1 << min, eoi = clear + 1;
    let size = min + 1, dict = [], prev = null, bitPos = 0;
    const out = [];
    const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; size = min + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bitPos++) code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      let entry;
      if (code < dict.length) entry = dict[code];
      else entry = [...dict[prev], dict[prev][0]];
      out.push(...entry);
      if (prev !== null && dict.length < 4096) dict.push([...dict[prev], entry[0]]);
      if (dict.length === (1 << size) && size < 12) size++;
      prev = code;
    }
    assert.equal(out.length, w * h);
    frames.push(Uint8Array.from(out));
  }
  return frames;
}

test('fixture 对象均可识别且无元数据', () => {
  const dir = join(FIXTURE, 'objects/sha256');
  const seen = new Set();
  for (const hh of readdirSync(dir)) for (const f of readdirSync(join(dir, hh))) {
    const info = inspectImage(readFileSync(join(dir, hh, f)));
    assert.deepEqual(info.problems, [], f);
    assert.deepEqual(info.metadata, [], f);
    seen.add(info.mime);
  }
  assert.deepEqual([...seen].sort(), ['image/gif', 'image/jpeg', 'image/png']);
});

test('GIF 编码器往返解码一致（含 >4096 码表重置路径）', () => {
  const w = 120, h = 120;
  const pal = Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, (i * 37) % 256]);
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) % 16;
  const frames = [Uint8Array.from({ length: w * h }, rnd), Uint8Array.from({ length: w * h }, (_, i) => (i >> 4) % 16)];
  const gif = encodeGif(w, h, pal, frames);
  const info = inspectImage(gif);
  assert.equal(info.frames, 2); assert.equal(info.animated, true);
  const dec = decodeGifFrames(gif);
  assert.deepEqual(dec, frames);
});

test('拒绝 APNG、非图片与 SVG', () => {
  const png = encodePng(new Canvas(4, 4));
  // 在 IHDR 后插入 acTL
  const ihdrEnd = 8 + 25;
  const actl = Buffer.from('000000086163544c000000020000000000000000', 'hex'); // CRC 故意不对也会报
  const apng = Buffer.concat([png.subarray(0, ihdrEnd), actl, png.subarray(ihdrEnd)]);
  assert.ok(inspectImage(apng).problems.some((p) => /APNG/.test(p)));
  assert.equal(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).mime, null);
  assert.equal(inspectImage(Buffer.from('<html>')).mime, null);
});

test('识别并剥离 PNG 文本元数据', () => {
  const png = pngWithText(encodePng(new Canvas(8, 8)), 'Comment', 'gps 1,2');
  assert.deepEqual(inspectImage(png).metadata, ['png:tEXt']);
  const clean = stripMetadata(png);
  assert.deepEqual(inspectImage(clean).metadata, []);
  assert.deepEqual(inspectImage(clean).problems, []);
});

test('剥离 GIF 注释不破坏动画帧', () => {
  const pal = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 0, 255]];
  const f = (v) => new Uint8Array(16).fill(v);
  const gif = encodeGif(4, 4, pal, [f(1), f(2), f(3)]);
  const comment = Buffer.from([0x21, 0xfe, 5, ...Buffer.from('hello'), 0]);
  const withC = Buffer.concat([gif.subarray(0, gif.length - 1), comment, gif.subarray(gif.length - 1)]);
  assert.deepEqual(inspectImage(withC).metadata, ['gif:comment']);
  const clean = stripMetadata(withC);
  assert.equal(inspectImage(clean).frames, 3);
  assert.deepEqual(decodeGifFrames(clean), [f(1), f(2), f(3)]);
  assert.ok(clean.includes(Buffer.from('NETSCAPE2.0')), '保留循环扩展');
});

test('解码预算按逻辑画布计', () => {
  assert.deepEqual(budgetProblems({ width: 2048, height: 1953, frames: 1 }, limits), []);
  assert.ok(budgetProblems({ width: 2049, height: 10, frames: 1 }, limits).length);
  assert.ok(budgetProblems({ width: 800, height: 800, frames: 60 }, limits).some((p) => /累计/.test(p)));
  assert.ok(budgetProblems({ width: 10, height: 10, frames: 61 }, limits).some((p) => /帧数/.test(p)));
});
