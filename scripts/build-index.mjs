#!/usr/bin/env node
// 全量重建 indexes/（确定性）。用法：node scripts/build-index.mjs [--root <dir>] [--check]
// --check：只比较不写入，不一致时退出码 1（CI 用）。
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { loadState } from '../lib/repo.mjs';
import { buildIndex } from '../lib/indexer.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--root');
const root = resolve(i >= 0 ? args[i + 1] : fileURLToPath(new URL('..', import.meta.url)));
const check = args.includes('--check');
const state = loadState(root);
const expected = buildIndex(state);
const existing = state.files.filter((f) => f.startsWith('indexes/') && !f.endsWith('.gitkeep'));
let diffs = 0;
for (const [p, content] of expected) {
  const full = join(root, p);
  const cur = existsSync(full) ? readFileSync(full, 'utf8') : undefined;
  if (cur === content) continue;
  diffs++;
  if (check) console.error(`DIFF ${p}${cur === undefined ? '（缺失）' : ''}`);
  else { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content); }
}
for (const p of existing) if (!expected.has(p)) {
  diffs++;
  if (check) console.error(`EXTRA ${p}`); else rmSync(join(root, p));
}
console.log(`[build-index] root=${root} files=${expected.size} ${check ? 'diffs' : 'written'}=${diffs}`);
process.exit(check && diffs ? 1 : 0);
