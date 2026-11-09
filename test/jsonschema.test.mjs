import test from 'node:test';
import assert from 'node:assert/strict';
import { SchemaRegistry } from '../lib/jsonschema.mjs';
import { loadSchemas } from '../lib/validator.mjs';

test('基础关键字与 $ref', () => {
  const r = new SchemaRegistry();
  r.add({ $id: 'urn:t:a', $defs: { n: { type: 'integer', minimum: 1 } }, type: 'object', required: ['x'], additionalProperties: false, properties: { x: { $ref: '#/$defs/n' }, s: { type: 'string', maxLength: 2 } } });
  assert.equal(r.validate('urn:t:a', { x: 1 }).length, 0);
  assert.ok(r.validate('urn:t:a', { x: 0 }).length);
  assert.ok(r.validate('urn:t:a', { x: 1, y: 1 }).length);
  assert.equal(r.validate('urn:t:a', { x: 1, s: '哈哈' }).length, 0, 'maxLength 按码点计');
  assert.ok(r.validate('urn:t:a', { x: 1, s: '哈哈哈' }).length);
});

test('未知关键字直接报错，避免静默不校验', () => {
  const r = new SchemaRegistry().add({ $id: 'urn:t:b', type: 'string', contentMediaType: 'x' });
  assert.throws(() => r.validate('urn:t:b', 'a'), /不支持的关键字/);
});

test('全部仓库 schema 可加载且被本校验器支持', () => {
  const reg = loadSchemas();
  for (const id of ['asset', 'manifest-shard', 'event', 'template', 'license', 'budget', 'index-catalog', 'index-terms', 'index-docs', 'index-recent', 'mirrors']) {
    assert.ok(reg.byId.has(`urn:sticker-assets:v1:${id}`), id);
    reg.validate(`urn:sticker-assets:v1:${id}`, {}); // 不抛异常即可
  }
});
