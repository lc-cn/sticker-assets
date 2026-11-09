#!/usr/bin/env node
/**
 * 采集运行器（本地 / Actions 共用）。
 * 适配器：scripts/adapters/* ；登记表：config/collect-sources.json
 *
 * 用法：
 *   node scripts/collect.mjs --source chinesebqb --dry-run true --mirror /tmp/sticker-import-src/ChineseBQB --limit 20
 *   node scripts/collect.mjs --source chinesebqb --dry-run false --upload --mirror ... --limit 15
 *
 * --upload 会读 ~/.sticker-secrets/xiaozhi-machine-token.txt（或 STICKER_MACHINE_TOKEN），
 * 经 POST /v1/assets/batch 写入线上库。不把 token 写入仓库。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripMetadata } from '../lib/strip.mjs';
import { inspectImage } from '../lib/image.mjs';
import { getAdapter, listAdapterIds } from './adapters/index.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = (process.env.STICKER_API || 'https://sticker.l2cl.link').replace(/\/$/, '');
const BATCH_MAX_ITEMS = 20;
const BATCH_MAX_BYTES = 3 * 1024 * 1024;

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(name);

const source = arg('--source', arg('--adapter', 'none'));
const dryRaw = arg('--dry-run', 'true');
const dryRun = !(dryRaw === 'false' || dryRaw === '0' || dryRaw === false);
const mirror = arg('--mirror', process.env.COLLECT_MIRROR || '');
const limit = Number.parseInt(arg('--limit', '20'), 10) || 20;
const cursor = arg('--cursor', '0');
const doUpload = flag('--upload') && !dryRun;

if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(source)) {
  console.log('[collect] source 参数格式非法，已拒绝。');
  process.exit(1);
}

const registry = JSON.parse(readFileSync(join(ROOT, 'config/collect-sources.json'), 'utf8'));
const entry = registry.sources.find((s) => s.id === source);
if (source !== 'none' && !entry) {
  console.log(`[collect] 来源 "${source}" 不在 config/collect-sources.json 登记表中，已拒绝。`);
  process.exit(1);
}

const adapter = getAdapter(source);
if (!entry?.approved || !adapter) {
  console.log(
    `[collect] 来源 "${source}" 未获批准或尚无适配器；已批准适配器: [${listAdapterIds().join(', ') || '无'}]。未执行任何网络/上传。`,
  );
  process.exit(0);
}

function loadToken() {
  if (process.env.STICKER_MACHINE_TOKEN) return process.env.STICKER_MACHINE_TOKEN.trim();
  const p = join(homedir(), '.sticker-secrets/xiaozhi-machine-token.txt');
  if (!existsSync(p)) throw new Error('缺少 machine token：设 STICKER_MACHINE_TOKEN 或 ~/.sticker-secrets/xiaozhi-machine-token.txt');
  return readFileSync(p, 'utf8').trim();
}

function prepare(bytes, meta, filename) {
  let stripped;
  try { stripped = stripMetadata(bytes); } catch (e) {
    return { error: `strip_failed: ${e.message}` };
  }
  const info = inspectImage(stripped);
  if (!info.mime || info.problems.length || info.metadata.length) {
    return { error: `inspect: mime=${info.mime} problems=${info.problems} meta=${info.metadata}` };
  }
  if (stripped.length > 1.8 * 1024 * 1024) return { error: 'too_large' };
  return { bytes: stripped, info, meta, filename };
}

function buildMultipart(items) {
  const boundary = `----sticker${randomBytes(8).toString('hex')}`;
  const chunks = [];
  const metadata = JSON.stringify(items.map((it) => it.meta));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n`));
  for (const [i, it] of items.entries()) {
    const filename = it.filename || `f${i}.bin`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${it.info.mime}\r\n\r\n`));
    chunks.push(it.bytes, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function packBatches(prepared) {
  const batches = [];
  let cur = [];
  let bytes = 0;
  for (const it of prepared) {
    if (cur.length >= BATCH_MAX_ITEMS || (cur.length && bytes + it.bytes.length > BATCH_MAX_BYTES)) {
      batches.push(cur); cur = []; bytes = 0;
    }
    cur.push(it); bytes += it.bytes.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function postBatch(token, items, label) {
  const key = `col-${randomBytes(16).toString('hex')}`.slice(0, 48);
  const { body, contentType } = buildMultipart(items);
  const res = await fetch(`${API}/v1/assets/batch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': contentType, 'idempotency-key': key },
    body,
  });
  const json = await res.json().catch(() => ({}));
  const summary = {
    label,
    http: res.status,
    key,
    commit: json.commit,
    status: json.status,
    summary: json.summary,
    items: (json.items || []).map((r) => ({
      index: r.index,
      status: r.status,
      code: r.error?.code,
      message: r.error?.message,
      id: r.asset?.id,
      title: r.asset?.title,
      url: r.asset?.contentUrl || (r.asset?.id ? `/v1/asset/${r.asset.id}` : undefined),
    })),
  };
  console.log(JSON.stringify({
    label,
    http: res.status,
    status: json.status,
    summary: json.summary,
    commit: json.commit,
    created: summary.items.filter((i) => i.status === 'created').map((i) => ({ id: i.id, title: i.title, url: i.url })),
    errors: summary.items.filter((i) => i.status === 'error').slice(0, 5),
  }));
  return summary;
}

const discovered = await adapter.discover({ cursor, limits: { maxCandidates: limit }, mirror });
const candidates = discovered.candidates || [];
console.log(JSON.stringify({
  phase: 'discover',
  source,
  dryRun,
  upload: doUpload,
  mirror: mirror || null,
  total: discovered.total ?? candidates.length,
  nextCursor: discovered.nextCursor,
  note: discovered.note,
  sample: candidates.slice(0, 5).map((c) => ({ itemId: c.itemId, title: c.title, pack: c.pack, bytesHint: c.bytesHint })),
}));

if (!candidates.length) {
  console.log('[collect] 无候选，结束。');
  process.exit(0);
}

if (dryRun) {
  console.log(`[collect] dry-run：列出 ${candidates.length} 个候选，未拉取也未上传。`);
  process.exit(0);
}

const prepared = [];
const skipped = [];
for (const c of candidates) {
  try {
    const fetched = await adapter.fetchApproved(c);
    const p = prepare(fetched.bytes, fetched.meta, fetched.filename);
    if (p.error) { skipped.push({ itemId: c.itemId, error: p.error }); continue; }
    prepared.push(p);
  } catch (e) {
    skipped.push({ itemId: c.itemId, error: e instanceof Error ? e.message : String(e) });
  }
}
console.log(JSON.stringify({ phase: 'fetch', prepared: prepared.length, skipped: skipped.slice(0, 10) }));

if (!doUpload) {
  console.log('[collect] 已拉取并剥离元数据，未加 --upload，不写线上库。');
  process.exit(0);
}

const token = loadToken();
const results = [];
for (const [i, batch] of packBatches(prepared).entries()) {
  results.push(await postBatch(token, batch, `${source}-${i}`));
  await new Promise((r) => setTimeout(r, 1200));
}
const created = results.flatMap((r) => (r.items || []).filter((i) => i.status === 'created'));
console.log(JSON.stringify({
  phase: 'done',
  batches: results.length,
  created: created.length,
  examples: created.slice(0, 8).map((i) => ({ id: i.id, title: i.title, url: i.url ? `${API}${i.url.startsWith('/') ? i.url : '/' + i.url}` : undefined })),
}));
