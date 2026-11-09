import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, analyze, queryTerms } from '../lib/tokenize.mjs';

test('NFKC + 小写 + 标点转空格', () => {
  assert.equal(normalize('  ＨＡＨＡ！哈哈，好的 '), 'haha 哈哈 好的');
});

test('中文二字 gram 与整段', () => {
  const m = analyze('开心大笑');
  assert.equal(m.get('开心大笑'), 'whole');
  for (const g of ['开心', '心大', '大笑']) assert.equal(m.get(g), 'part');
});

test('中英混排拆 run', () => {
  assert.deepEqual(queryTerms('xswl笑死'), ['xswl笑死', 'xswl', '笑死']);
  assert.deepEqual(queryTerms('哭'), ['哭']);
});
