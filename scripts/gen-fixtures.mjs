#!/usr/bin/env node
// 生成 fixtures/sample-repo：全部图片由本脚本自绘（无任何网络/第三方图片）。
// 走与 B 相同的 lib/commit-plan.mjs 路径逐个“提交”，因此 fixture 同时验证提交协议。
// JPEG：macOS 上用 sips 由自绘 PNG 转出一次并剥离元数据，存 fixtures/sources/ 以便复现。
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Canvas, encodePng, encodeGif } from './fixture-encoders.mjs';
import { sha256Hex } from '../lib/hash.mjs';
import { pretty } from '../lib/canonical.mjs';
import { buildIndex } from '../lib/indexer.mjs';
import { planCreate, planArchive, planTombstone, planUpdate, applyChanges } from '../lib/commit-plan.mjs';
import { stripMetadata } from '../lib/strip.mjs';
import { loadSchemas } from '../lib/validator.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'fixtures/sample-repo');
const SRC = join(ROOT, 'fixtures/sources');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

const Y = [255, 214, 64, 255], K = [40, 40, 40, 255], R = [230, 80, 80, 255], B = [90, 140, 230, 255], W = [255, 255, 255, 255], G = [80, 190, 120, 255];
function face(size, color, mood) {
  const c = new Canvas(size, size, W);
  const r = Math.floor(size / 2) - 2, m = Math.floor(size / 2);
  c.circle(m, m, r, color);
  const e = Math.max(2, Math.floor(size / 12));
  c.circle(m - Math.floor(r / 2.5), m - Math.floor(r / 3), e, K);
  c.circle(m + Math.floor(r / 2.5), m - Math.floor(r / 3), e, K);
  if (mood === 'smile') for (let d = 0; d < 2; d++) c.arc(m, m + Math.floor(r / 6), Math.floor(r / 2) - d, K, false);
  if (mood === 'sad') for (let d = 0; d < 2; d++) c.arc(m, m + Math.floor(r / 1.6), Math.floor(r / 3) - d, K, true);
  if (mood === 'sad') c.rect(m - Math.floor(r / 2.5) - 1, m, 2, Math.floor(r / 3), B);
  return c;
}

function blinkGif() {
  const w = 32, h = 32, pal = [[255, 255, 255], [255, 214, 64], [40, 40, 40], [230, 80, 80]];
  const frame = (closed) => {
    const f = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = (x - 16) ** 2 + (y - 16) ** 2;
      let v = d <= 14 * 14 ? 1 : 0;
      const eye = (ex) => (closed ? Math.abs(y - 12) <= 0 && Math.abs(x - ex) <= 3 : (x - ex) ** 2 + (y - 12) ** 2 <= 4);
      if (eye(11) || eye(21)) v = 2;
      if (y === 21 && x >= 11 && x <= 21) v = 3;
      f[y * w + x] = v;
    }
    return f;
  };
  return encodeGif(w, h, pal, [frame(false), frame(false), frame(true)], 40);
}

function jpegBytes() {
  const p = join(SRC, 'thanks-40.jpg');
  if (!existsSync(p)) {
    const png = join(tmpdir(), 'sticker-fixture-thanks.png');
    writeFileSync(png, encodePng(face(40, G, 'smile')));
    const raw = join(tmpdir(), 'sticker-fixture-thanks.jpg');
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', png, '--out', raw], { stdio: 'ignore' });
    mkdirSync(SRC, { recursive: true });
    writeFileSync(p, stripMetadata(readFileSync(raw)));
  }
  return readFileSync(p);
}

function templateBase() {
  const c = new Canvas(240, 240, W);
  c.rect(0, 0, 240, 6, K); c.rect(0, 234, 240, 6, K); c.rect(0, 0, 6, 240, K); c.rect(234, 0, 6, 240, K);
  c.rect(6, 180, 228, 54, [245, 245, 245, 255]);
  return encodePng(c);
}

// ---------- 初始树 ----------
const files = new Map();
for (const p of ['sticker-assets.json', 'config/limits.json', 'config/taxonomy.json', 'config/synonyms.json']) files.set(p, rd(p));
const mirrors = JSON.parse(rd('config/mirrors.json'));
mirrors.owner = 'example-owner'; mirrors.repo = 'sticker-assets'; // 占位，非真实账号
files.set('config/mirrors.json', pretty(mirrors));
const reviewedAt = '2026-11-09T00:00:00Z';
files.set('licenses/self-created-project.json', pretty({ schemaVersion: 1, id: 'self-created-project', kind: 'self-created', name: '项目维护者自制', spdx: null, url: null, attribution: null, notice: '由本项目脚本自绘的测试/示例图，可随本仓库公开再分发。', scope: 'fixtures 与示例模板', reviewedAt }));
files.set('licenses/ofl-1-1.json', pretty({ schemaVersion: 1, id: 'ofl-1-1', kind: 'license', name: 'SIL Open Font License 1.1', spdx: 'OFL-1.1', url: 'https://openfontlicense.org/open-font-license-official-text/', attribution: null, notice: '示例：模板引用的字体由 B 渲染器提供，具体字体文件与版本 hash 需在 B 中固定并附 NOTICE。', scope: '模板字体引用', reviewedAt }));
const base = templateBase();
files.set('templates/caption-bar/1/base.png', base);
files.set('templates/caption-bar/1/template.json', pretty({
  schemaVersion: 1, id: 'caption-bar', version: 1, title: '底部字幕条', status: 'active', renderer: 'light-v1', tags: ['字幕', '配字'],
  inputs: { texts: { min: 1, max: 1, maxLength: 40 }, images: { min: 0, max: 1 } },
  params: [{ name: 'color', type: 'enum', default: 'black', enum: ['black', 'red'] }],
  output: { mime: 'image/png', animated: false, maxBytes: 2097152 },
  canvas: { width: 240, height: 240, background: '#ffffff' },
  layers: [
    { type: 'image', file: 'base.png', box: { x: 0, y: 0, w: 240, h: 240 } },
    { type: 'slot-image', slot: 0, box: { x: 6, y: 6, w: 228, h: 174 }, fit: 'contain' },
    { type: 'text', slot: 0, box: { x: 12, y: 184, w: 216, h: 46 }, font: 'default-sans', fontSize: 28, minFontSize: 14, color: '#222222', stroke: { color: '#ffffff', width: 2 }, align: 'center', valign: 'middle', wrap: true },
  ],
  files: [{ path: 'base.png', sha256: sha256Hex(base), bytes: base.length, mime: 'image/png', role: 'base' }],
  fonts: [{ id: 'default-sans', licenseId: 'ofl-1-1', providedBy: 'renderer' }],
  licenseIds: ['self-created-project'],
  notice: '底图为项目自绘；字体由渲染器提供（见 ofl-1-1）。',
}));
const synBuf = Buffer.from(files.get('config/synonyms.json'));
const ctx = { synonyms: JSON.parse(synBuf), limits: JSON.parse(files.get('config/limits.json')), registry: loadSchemas() };
const templates = [{ path: 'templates/caption-bar/1/template.json', template: JSON.parse(files.get('templates/caption-bar/1/template.json')) }];
for (const [p, c] of buildIndex({ assets: [], templates, synonyms: ctx.synonyms, synonymsSha256: sha256Hex(synBuf), limits: ctx.limits })) files.set(p, c);

const read = (p) => { const v = files.get(p); return v === undefined ? undefined : Buffer.isBuffer(v) ? v : String(v); };
let n = 0;
const op = () => `op_${sha256Hex(`fixture-op-${++n}`).slice(0, 32)}`;
const rights = { basis: 'self-created', licenseId: 'self-created-project', reviewedAt, publicUrl: null };
const self = { kind: 'self-created', confidence: 'high' };
const create = (bytes, meta, uploadedAt) => {
  const r = planCreate(read, { bytes, meta: { rights, source: self, ...meta }, uploadedAt, operationId: op(), actorKind: 'admin' }, ctx);
  if (r.kind !== 'created') throw new Error('fixture 重复');
  applyChanges(files, r.changes);
  return r.asset;
};

const smile = create(encodePng(face(64, Y, 'smile')), { title: '开心大笑', categories: ['laugh'], tags: ['哈哈', '开心', '大笑'], aliases: ['xswl'], tone: 'positive' }, '2026-11-09T02:00:00Z');
create(encodePng(face(48, B, 'sad')), { title: '委屈哭哭', categories: ['sad'], tags: ['哭', '难过', '委屈'], tone: 'negative', text: { ocr: '我太难了', ocrSource: 'manual', ocrConfirmed: true } }, '2026-11-08T10:00:00Z');
create(blinkGif(), { title: '眨眼晚安', categories: ['cute', 'sleepy'], tags: ['眨眼', '晚安'], tone: 'positive' }, '2026-11-09T03:00:00Z');
create(jpegBytes(), { title: '谢谢老板', categories: ['thanks'], tags: ['谢谢', '老板'], tone: 'positive' }, '2026-11-09T03:30:00Z');
const ok = create(encodePng(face(32, G, 'none')), { title: '好的收到', categories: ['agree'], tags: ['好的'], tone: 'neutral' }, '2026-11-07T08:00:00Z');
const gone = create(encodePng(face(36, R, 'sad')), { title: '已下架示例', categories: ['angry'], tags: ['生气'], tone: 'negative' }, '2026-11-07T09:00:00Z');

applyChanges(files, planArchive(read, ok.id, { at: '2026-11-09T04:00:00Z', operationId: op(), actorKind: 'admin', expectedRevision: 1 }, ctx).changes);
applyChanges(files, planTombstone(read, gone.id, { at: '2026-11-09T04:10:00Z', operationId: op(), actorKind: 'admin', expectedRevision: 1, reason: 'quality' }, ctx).changes);
applyChanges(files, planUpdate(read, smile.id, { patch: { tags: ['哈哈', '开心', '大笑', '笑死'] }, at: '2026-11-09T04:20:00Z', operationId: op(), actorKind: 'machine', expectedRevision: 1 }, ctx).changes);

rmSync(OUT, { recursive: true, force: true });
for (const [p, c] of files) { const full = join(OUT, p); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, c); }
console.log(`[gen-fixtures] wrote ${files.size} files to ${OUT}`);
