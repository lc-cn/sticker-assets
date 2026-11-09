import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { walk } from '../lib/repo.mjs';
import { planCreate, planUpdate, planArchive, planTombstone, applyChanges, findAsset, PlanError } from '../lib/commit-plan.mjs';
import { buildIndex } from '../lib/indexer.mjs';
import { loadState } from '../lib/repo.mjs';
import { loadSchemas, validateRepo } from '../lib/validator.mjs';
import { sha256Hex } from '../lib/hash.mjs';
import { Canvas, encodePng, pngWithText } from '../scripts/fixture-encoders.mjs';
import { FIXTURE, tmpCopy, cleanup, mapReader } from './helpers.mjs';

function loadFiles(dir) {
  const m = new Map();
  for (const p of walk(dir)) m.set(p, /\.(png|jpg|gif)$/.test(p) ? readFileSync(join(dir, p)) : readFileSync(join(dir, p), 'utf8'));
  return m;
}
const baseCtx = () => { const s = loadState(FIXTURE); return { synonyms: s.synonyms, limits: s.limits, registry: loadSchemas() }; };
const meta = (over = {}) => ({ title: '测试图', categories: ['other'], tags: ['测试'], rights: { basis: 'self-created', licenseId: 'self-created-project', reviewedAt: '2026-11-09T00:00:00Z' }, source: { kind: 'self-created', confidence: 'high' }, ...over });
let seq = 0;
const opId = () => `op_${sha256Hex(`t-${++seq}-${Math.random()}`).slice(0, 32)}`;
const img = (seed) => { const c = new Canvas(16, 16); c.rect(seed % 16, (seed * 7) % 16, 3, 3, [seed % 255, 10, 200, 255]); c.set(0, 0, [seed & 255, (seed >> 8) & 255, 1, 255]); return encodePng(c); };

function writeTree(files) {
  const dir = tmpCopy();
  rmSync(dir, { recursive: true, force: true });
  for (const [p, c] of files) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
  return dir;
}

test('create → 校验通过；重复图返回 duplicate 且不改 uploadedAt', () => {
  const files = loadFiles(FIXTURE), ctx = baseCtx(), read = mapReader(files);
  const bytes = img(1);
  const r = planCreate(read, { bytes, meta: meta(), uploadedAt: '2026-11-09T05:00:00Z', operationId: opId(), actorKind: 'machine' }, ctx);
  assert.equal(r.kind, 'created');
  applyChanges(files, r.changes);
  const again = planCreate(read, { bytes, meta: meta({ title: '别的标题' }), uploadedAt: '2026-11-09T06:00:00Z', operationId: opId(), actorKind: 'machine' }, ctx);
  assert.equal(again.kind, 'duplicate');
  assert.equal(again.asset.uploadedAt, '2026-11-09T05:00:00Z');
  const dir = writeTree(files);
  try { assert.deepEqual(validateRepo(dir).errors, []); } finally { cleanup(dir); }
});

test('tombstone 后同 hash 重传被拒，不复活', () => {
  const files = loadFiles(FIXTURE), ctx = baseCtx(), read = mapReader(files);
  // 现造一张图 → 下架 → 用同样字节重传
  const bytes = img(99);
  const c = planCreate(read, { bytes, meta: meta(), uploadedAt: '2026-11-09T05:00:00Z', operationId: opId(), actorKind: 'admin' }, ctx);
  applyChanges(files, c.changes);
  applyChanges(files, planTombstone(read, c.asset.id, { at: '2026-11-09T05:10:00Z', operationId: opId(), actorKind: 'admin', reason: 'rights', expectedRevision: 1 }, ctx).changes);
  assert.equal(files.has(c.asset.object.path), false, '对象已从树中删除');
  assert.throws(() => planCreate(read, { bytes, meta: meta(), uploadedAt: '2026-11-09T06:00:00Z', operationId: opId(), actorKind: 'admin' }, ctx), (e) => e instanceof PlanError && e.code === 'tombstoned');
  const dir = writeTree(files);
  try { assert.deepEqual(validateRepo(dir).errors, []); } finally { cleanup(dir); }
});

test('旧 revision → precondition_failed；不可改字段被拒', () => {
  const files = loadFiles(FIXTURE), ctx = baseCtx(), read = mapReader(files);
  const id = JSON.parse(files.get('manifests/2e.json')).assets[0].id;
  assert.throws(() => planUpdate(read, id, { patch: { title: 'x' }, expectedRevision: 1, at: '2026-11-09T07:00:00Z', operationId: opId(), actorKind: 'admin' }, ctx), (e) => e.code === 'precondition_failed');
  assert.throws(() => planUpdate(read, id, { patch: { uploadedAt: '2020-01-01T00:00:00Z' }, at: '2026-11-09T07:00:00Z', operationId: opId(), actorKind: 'admin' }, ctx), (e) => e.code === 'invalid_metadata');
});

test('未剥离元数据 / pending / 未知许可 / 每日预算', () => {
  const files = loadFiles(FIXTURE), ctx = baseCtx(), read = mapReader(files);
  const base = { uploadedAt: '2026-11-09T05:00:00Z', actorKind: 'admin' };
  assert.throws(() => planCreate(read, { ...base, bytes: pngWithText(img(3), 'k', 'v'), meta: meta(), operationId: opId() }, ctx), (e) => e.code === 'metadata_not_stripped');
  assert.throws(() => planCreate(read, { ...base, bytes: img(4), meta: meta({ rights: { basis: 'pending', licenseId: 'self-created-project', reviewedAt: null } }), operationId: opId() }, ctx), (e) => e.code === 'invalid_metadata');
  assert.throws(() => planCreate(read, { ...base, bytes: img(5), meta: meta({ rights: { basis: 'license', licenseId: 'nope', reviewedAt: '2026-11-09T00:00:00Z' } }), operationId: opId() }, ctx), (e) => e.code === 'unknown_license');
  const tight = { ...ctx, limits: { ...ctx.limits, dailyMaxAssets: 3 } };
  assert.throws(() => planCreate(read, { ...base, bytes: img(6), meta: meta(), operationId: opId() }, tight), (e) => e.code === 'daily_budget_exceeded');
  assert.throws(() => planCreate(read, { ...base, bytes: Buffer.from('<svg/>'), meta: meta(), operationId: opId() }, ctx), (e) => e.code === 'unsupported_media_type');
});

test('随机操作序列：增量索引 == 全量重建（逐字节）', () => {
  const files = loadFiles(FIXTURE), ctx = baseCtx(), read = mapReader(files);
  const cats = ['laugh', 'sad', 'cute', 'work', 'food'];
  const words = ['哈哈', '打工', '摸鱼', '干饭', '晚安', '好的', '谢谢', 'ok', '无语', '震惊'];
  let s = 42; const rnd = (n) => (s = (s * 1103515245 + 12345) & 0x7fffffff) % n;
  const ids = [];
  let t = Date.parse('2026-11-10T00:00:00Z');
  for (let i = 0; i < 60; i++) {
    t += 60_000 * (1 + rnd(90));
    const at = new Date(t).toISOString().replace('.000Z', 'Z');
    const action = ids.length < 5 ? 0 : rnd(5);
    if (action <= 1) {
      const r = planCreate(read, { bytes: img(1000 + i), meta: meta({ title: words[rnd(10)] + words[rnd(10)], categories: [cats[rnd(5)]], tags: [words[rnd(10)]] }), uploadedAt: at, operationId: opId(), actorKind: 'machine' }, ctx);
      if (r.kind === 'created') { applyChanges(files, r.changes); ids.push(r.asset.id); }
    } else {
      const id = ids[rnd(ids.length)];
      const a = findAsset(read, id);
      const op = { at, operationId: opId(), actorKind: 'admin', expectedRevision: a.revision };
      if (a.status === 'tombstoned') continue;
      if (action === 2) applyChanges(files, planUpdate(read, id, { ...op, patch: { tags: [words[rnd(10)], 'x' + i], categories: [cats[rnd(5)]] } }, ctx).changes);
      else if (action === 3 && a.status === 'active') applyChanges(files, planArchive(read, id, op, ctx).changes);
      else applyChanges(files, planTombstone(read, id, { ...op, reason: 'quality' }, ctx).changes);
    }
  }
  const dir = writeTree(files);
  try {
    const st = loadState(dir);
    const full = buildIndex(st);
    for (const [p, c] of full) assert.equal(files.get(p), c, p);
    for (const p of files.keys()) if (p.startsWith('indexes/')) assert.ok(full.has(p), `多余 ${p}`);
    assert.deepEqual(validateRepo(dir).errors, []);
  } finally { cleanup(dir); }
});
