#!/usr/bin/env node
// 采集占位：不联网、不写仓库。适配器接口（将来由 B 固定 commit 提供）：
//   discover(cursor, limits) -> { candidates:[{itemId, url, publishedAt}], nextCursor }
//   fetchApproved(candidate)  -> { bytes, provenance:{ kind:'adapter', adapter, url, itemId, publishedAt, confidence } }
// 约束：每源限图数/字节/时长；429 尊重 Retry-After；不带用户 cookie；不绕登录/验证码/付费/反爬；
// API host 与图片 CDN 分别 allowlist；产出仍须经 lib/commit-plan.mjs 与 validate 才能提交。
// 来源登记表：config/collect-sources.json（B 管理后台据此列出来源并 workflow_dispatch source=<id>）。
import { readFileSync } from 'node:fs';

const APPROVED_ADAPTERS = []; // 需 Fin 逐个批准后才可加入
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
// --adapter 为旧参数名，保留兼容
const source = arg('--source', arg('--adapter', 'none'));
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(source)) {
  console.log('[collect] source 参数格式非法，已拒绝。');
  process.exit(1);
}
const registry = JSON.parse(readFileSync(new URL('../config/collect-sources.json', import.meta.url), 'utf8'));
const entry = registry.sources.find((s) => s.id === source);
if (source !== 'none' && !entry) {
  console.log(`[collect] 来源 "${source}" 不在 config/collect-sources.json 登记表中，已拒绝。`);
  process.exit(1);
}
if (!entry?.approved || !APPROVED_ADAPTERS.includes(source)) {
  console.log(`[collect] 来源 "${source}" 未获批准或尚无适配器；当前批准列表为空。未执行任何网络请求。`);
  process.exit(0);
}
