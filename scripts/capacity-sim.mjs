#!/usr/bin/env node
// 容量模拟（不写盘）：生成 N 条合成元数据（无图片），检查索引分片大小与单次查询读入量是否在自设门槛内。
// 用法：node scripts/capacity-sim.mjs [N=3000]
import { readFileSync } from 'node:fs';
import { buildIndex } from '../lib/indexer.mjs';
import { search } from '../lib/search.mjs';
import { sha256Hex } from '../lib/hash.mjs';

const N = Number(process.argv[2] || 3000);
const limits = JSON.parse(readFileSync(new URL('../config/limits.json', import.meta.url)));
const synonyms = JSON.parse(readFileSync(new URL('../config/synonyms.json', import.meta.url)));
const cats = JSON.parse(readFileSync(new URL('../config/taxonomy.json', import.meta.url))).categories.map((c) => c.slug);
const pool = '哈笑哭气好的谢晚安困饭吃打工摸鱼震惊无语可爱猫狗老板开心难过生日快乐加油冲鸭社畜周末上班下班睡觉早安牛啊绝了离谱破防'.split('');
let s = 1; const rnd = (n) => (s = (s * 1103515245 + 12345) & 0x7fffffff) % n;
const word = (a, b) => Array.from({ length: a + rnd(b - a + 1) }, () => pool[rnd(pool.length)]).join('');
const assets = [];
for (let i = 0; i < N; i++) {
  const sha = sha256Hex(`sim-${i}`);
  assets.push({
    id: `sha256:${sha}`, revision: 1, status: 'active',
    object: { sha256: sha, path: `objects/sha256/${sha.slice(0, 2)}/${sha}.png`, mime: 'image/png', bytes: 150000, width: 240, height: 240, frames: 1, animated: false },
    title: word(4, 12), categories: [cats[rnd(cats.length)], cats[rnd(cats.length)]].filter((v, j, a) => a.indexOf(v) === j),
    tags: Array.from({ length: 3 + rnd(4) }, () => word(2, 4)).filter((v, j, a) => a.indexOf(v) === j), aliases: [word(2, 3)],
    tone: 'neutral', safety: { rating: 'general', offensive: false }, text: { ocr: word(4, 10), ocrSource: 'manual', ocrConfirmed: true },
    uploadedAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 3600_000).toISOString().replace('.000Z', 'Z'),
    source: { publishedAt: null },
  });
}
assets.sort((a, b) => (a.id < b.id ? -1 : 1));
const files = buildIndex({ assets, templates: [], synonyms, synonymsSha256: 'x'.repeat(64), limits });
const size = (p) => Buffer.byteLength(files.get(p));
const by = (re) => [...files.keys()].filter((p) => re.test(p)).map(size);
const terms = by(/terms\//), docs = by(/docs\//);
const report = {
  assets: N,
  catalogBytes: size('indexes/catalog.json'),
  recentBytes: size('indexes/recent.json'),
  termShards: terms.length, termShardMaxBytes: Math.max(...terms), termTotalBytes: terms.reduce((a, b) => a + b, 0),
  docShards: docs.length, docShardMaxBytes: Math.max(...docs),
};
const read = (p) => files.get(p);
let worst = 0;
for (let i = 0; i < 50; i++) { const r = search(read, { q: word(2, 6), limit: 50 }); worst = Math.max(worst, r.bytesRead); }
report.worstQueryBytes = worst;
report.withinLimits = report.catalogBytes <= limits.maxCatalogBytes && report.recentBytes <= limits.maxShardBytes && report.termShardMaxBytes <= limits.maxShardBytes && report.docShardMaxBytes <= limits.maxShardBytes && worst <= 512 * 1024;
console.log(JSON.stringify(report, null, 2));
process.exit(report.withinLimits ? 0 : 1);
