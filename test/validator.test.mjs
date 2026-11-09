import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync, unlinkSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateRepo } from '../lib/validator.mjs';
import { ROOT, FIXTURE, tmpCopy, rj, wj, cleanup } from './helpers.mjs';

const has = (res, re) => res.errors.some((e) => re.test(`${e.file}: ${e.message}`));
const firstManifest = (dir) => {
  const m = rj(dir, 'manifests/2e.json');
  return { m, a: m.assets[0] };
};

function withCopy(fn) { const dir = tmpCopy(); try { fn(dir); } finally { cleanup(dir); } }

test('fixture 与工具仓库本身均通过校验', () => {
  assert.deepEqual(validateRepo(FIXTURE).errors, []);
  assert.deepEqual(validateRepo(ROOT, { isToolRepo: true }).errors, []);
});

test('对象内容被篡改 → hash 不符', () => withCopy((dir) => {
  const { a } = firstManifest(dir);
  const p = join(dir, a.object.path);
  const b = readFileSync(p); b[b.length - 20] ^= 0xff; writeFileSync(p, b);
  assert.ok(has(validateRepo(dir), /sha256 .* 与文件名不符/));
}));

test('对象放错前缀目录 → 路径不符合协议', () => withCopy((dir) => {
  const { a } = firstManifest(dir);
  mkdirSync(join(dir, 'objects/sha256/ff'), { recursive: true });
  renameSync(join(dir, a.object.path), join(dir, `objects/sha256/ff/${a.object.sha256}.png`));
  const r = validateRepo(dir);
  assert.ok(has(r, /路径不符合协议/));
  assert.ok(has(r, /对象实际路径与记录不符/));
}));

test('未知分类 / pending 权利 / 规范化重复标签', () => withCopy((dir) => {
  const { m, a } = firstManifest(dir);
  a.categories = ['meme-old']; a.rights.basis = 'pending'; a.tags = ['哈哈', 'ＨＡＨＡ', 'haha'];
  wj(dir, 'manifests/2e.json', m);
  const r = validateRepo(dir);
  assert.ok(has(r, /取值不在枚举内/));
  assert.ok(has(r, /pending 不得进入 A/));
  assert.ok(has(r, /规范化后重复/));
}));

test('孤儿对象 & tombstone 仍留文件', () => withCopy((dir) => {
  const src = join(FIXTURE, 'templates/caption-bar/1/base.png');
  const sha = (JSON.parse(readFileSync(join(FIXTURE, 'templates/caption-bar/1/template.json'), 'utf8')).files[0].sha256);
  mkdirSync(join(dir, `objects/sha256/${sha.slice(0, 2)}`), { recursive: true });
  copyFileSync(src, join(dir, `objects/sha256/${sha.slice(0, 2)}/${sha}.png`));
  const t = rj(dir, 'manifests/44.json').assets[0];
  assert.equal(t.status, 'tombstoned');
  mkdirSync(join(dir, t.object.path, '..'), { recursive: true });
  copyFileSync(join(FIXTURE, 'templates/caption-bar/1/base.png'), join(dir, t.object.path)); // 内容不对也会报 hash
  const r = validateRepo(dir);
  assert.ok(has(r, /孤儿对象/));
  assert.ok(has(r, /tombstoned 资产的对象文件必须从当前树删除|与文件名不符/));
}));

test('索引被手工修改 → 陈旧', () => withCopy((dir) => {
  const p = 'indexes/recent.json';
  const v = rj(dir, p); v.items.reverse(); wj(dir, p, v, true);
  assert.ok(has(validateRepo(dir), /索引陈旧/));
}));

test('多余索引分片与缺失索引', () => withCopy((dir) => {
  wj(dir, 'indexes/terms/ff.json', { schemaVersion: 1, indexFormat: 1, shard: 'ff', terms: { x: [['000000000000', 1]] } }, true);
  unlinkSync(join(dir, 'indexes/catalog.json'));
  const r = validateRepo(dir);
  assert.ok(has(r, /索引缺失/));
  assert.ok(has(r, /多余的索引文件/));
}));

test('每日预算与 manifests 不符 / 超上限', () => withCopy((dir) => {
  const p = 'budgets/daily/2026-11-09.json';
  const v = rj(dir, p); v.acceptedCount += 1; wj(dir, p, v);
  assert.ok(has(validateRepo(dir), /与 manifests 推导值不符/));
}));

test('容量上限：资产数超过 limits.maxAssets 先到先停', () => withCopy((dir) => {
  const l = rj(dir, 'config/limits.json'); l.maxAssets = 3; wj(dir, 'config/limits.json', l);
  assert.ok(has(validateRepo(dir), /资产数 5 > 上限 3/));
}));

test('容量上限：受管字节', () => withCopy((dir) => {
  const l = rj(dir, 'config/limits.json'); l.maxManagedBytes = 1000; l.warnManagedBytes = 500; wj(dir, 'config/limits.json', l);
  assert.ok(has(validateRepo(dir), /受管字节 \d+ > 上限 1000/));
}));

test('事件里出现身份字段 / 密钥被拦截', () => withCopy((dir) => {
  const { m, a } = firstManifest(dir);
  const ev = `events/${a.lastOperationId.slice(3, 5)}/${a.lastOperationId}.json`;
  const e = rj(dir, ev); e.userId = '12345'; wj(dir, ev, e);
  a.title = 'x ' + 'gh' + 'p_' + 'A'.repeat(36);
  wj(dir, 'manifests/2e.json', m);
  const r = validateRepo(dir);
  assert.ok(has(r, /禁止的身份\/凭证字段 \$\.userId/));
  assert.ok(has(r, /疑似 GitHub token/));
}));

test('非协议顶层文件、非规范格式、未知 schemaVersion', () => withCopy((dir) => {
  writeFileSync(join(dir, 'random.txt'), 'x');
  writeFileSync(join(dir, 'manifests/2e.json'), JSON.stringify(rj(dir, 'manifests/2e.json')));
  wj(dir, 'sticker-assets.json', { format: 'sticker-assets', schemaVersion: 2, indexFormat: 1, tokenizer: 'zh-bigram-v1' });
  const r = validateRepo(dir);
  assert.ok(has(r, /random\.txt: 非协议文件/));
  assert.ok(has(r, /非规范 JSON 格式/));
  assert.ok(has(r, /未知 format\/schemaVersion/));
}));

test('启用未验收镜像 / 非 allowlist host 被拒', () => withCopy((dir) => {
  const c = rj(dir, 'config/mirrors.json');
  c.mirrors[0].enabled = true;
  c.mirrors.push({ id: 'evil', template: 'https://evil.example/{owner}/{repo}/{commit}/{path}', enabled: false, verifiedAt: null, note: '' });
  wj(dir, 'config/mirrors.json', c);
  const r = validateRepo(dir);
  assert.ok(has(r, /mirrors\.json: \$\.mirrors\[0\]\.verifiedAt/));
  assert.ok(has(r, /evil host evil\.example 不在 allowedHosts/));
}));

test('模板素材 hash 不符 / 未声明文件', () => withCopy((dir) => {
  const p = join(dir, 'templates/caption-bar/1/base.png');
  const b = readFileSync(p); b[40] ^= 1; writeFileSync(p, b);
  writeFileSync(join(dir, 'templates/caption-bar/1/extra.png'), b);
  const r = validateRepo(dir);
  assert.ok(has(r, /base\.png: sha256 与 template\.json 不符/));
  assert.ok(has(r, /未声明文件/));
}));
