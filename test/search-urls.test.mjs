import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { search } from '../lib/search.mjs';
import { candidateUrls } from '../lib/urls.mjs';
import { FIXTURE, reader } from './helpers.mjs';

const read = reader(FIXTURE);
const titles = (r) => r.items.map((x) => x.title);

test('关键词、同义词、确认OCR、分类过滤', () => {
  assert.deepEqual(titles(search(read, { q: '哈哈' })), ['开心大笑']);
  assert.deepEqual(titles(search(read, { q: '睡觉' })), ['眨眼晚安'], '同义词在索引时扩展');
  assert.deepEqual(titles(search(read, { q: '我太难了' })), ['委屈哭哭'], 'ocrConfirmed 才进索引');
  assert.deepEqual(titles(search(read, { category: 'sleepy' })), ['眨眼晚安']);
  assert.deepEqual(titles(search(read, { tag: '谢谢' })), ['谢谢老板']);
});

test('archived 与 tombstoned 不出现在搜索', () => {
  assert.equal(search(read, { q: '好的收到' }).total, 0);
  assert.equal(search(read, { q: '生气' }).total, 0);
});

test('无关键词按 uploadedAt 降序；分页上限 50', () => {
  const r = search(read, { limit: 999 });
  assert.deepEqual(titles(r), ['谢谢老板', '眨眼晚安', '开心大笑', '委屈哭哭']);
  assert.ok(r.bytesRead < 512 * 1024);
  assert.deepEqual(titles(search(read, { limit: 2, offset: 2 })), ['开心大笑', '委屈哭哭']);
});

test('镜像 URL：锁 commit+path，镜像默认关闭只剩 raw', () => {
  const cfg = JSON.parse(readFileSync(join(FIXTURE, 'config/mirrors.json'), 'utf8'));
  const commit = 'a'.repeat(40);
  const path = search(read, { q: '哈哈' }).items[0].path;
  assert.deepEqual(candidateUrls({ commit, path }, cfg), [{ id: 'github-raw', url: `https://raw.githubusercontent.com/example-owner/sticker-assets/${commit}/${path}` }]);
  const on = structuredClone(cfg); on.mirrors[0].enabled = true; on.mirrors[0].verifiedAt = '2026-11-09T00:00:00Z';
  const list = candidateUrls({ commit, path }, on);
  assert.equal(list[0].url, `https://gh-proxy.com/https://raw.githubusercontent.com/example-owner/sticker-assets/${commit}/${path}`);
  assert.equal(list.at(-1).id, 'github-raw');
  const noVerify = structuredClone(cfg); noVerify.mirrors[1].enabled = true;
  assert.equal(candidateUrls({ commit, path }, noVerify).length, 1, '未验收镜像即使 enabled 也不用');
  assert.throws(() => candidateUrls({ commit: 'main', path }, cfg), /40 位/);
  assert.throws(() => candidateUrls({ commit, path: '../secret' }, cfg), /非受管路径/);
  const main = JSON.parse(readFileSync(new URL('../config/mirrors.json', import.meta.url), 'utf8'));
  const prod = candidateUrls({ commit, path }, main);
  assert.equal(prod[0].id, 'jsdelivr-fastly');
  assert.equal(prod[0].url, `https://fastly.jsdelivr.net/gh/lc-cn/sticker-assets@${commit}/${path}`);
  assert.equal(prod.at(-1).id, 'github-raw');
  const unset = structuredClone(main); unset.owner = null;
  assert.throws(() => candidateUrls({ commit, path }, unset), /owner\/repo 未配置/);
});
