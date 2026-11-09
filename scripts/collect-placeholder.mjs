#!/usr/bin/env node
// 采集占位：不联网、不写仓库。适配器接口（将来由 B 固定 commit 提供）：
//   discover(cursor, limits) -> { candidates:[{itemId, url, publishedAt}], nextCursor }
//   fetchApproved(candidate)  -> { bytes, provenance:{ kind:'adapter', adapter, url, itemId, publishedAt, confidence } }
// 约束：每源限图数/字节/时长；429 尊重 Retry-After；不带用户 cookie；不绕登录/验证码/付费/反爬；
// API host 与图片 CDN 分别 allowlist；产出仍须经 lib/commit-plan.mjs 与 validate 才能提交。
const APPROVED_ADAPTERS = []; // 需 Fin 逐个批准后才可加入
const args = process.argv.slice(2);
const adapter = args[args.indexOf('--adapter') + 1] || 'none';
if (!APPROVED_ADAPTERS.includes(adapter)) {
  console.log(`[collect] 适配器 "${adapter}" 未获批准；当前批准列表为空。未执行任何网络请求。`);
  process.exit(0);
}
