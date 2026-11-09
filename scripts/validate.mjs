#!/usr/bin/env node
// 用法：node scripts/validate.mjs [--root <dir>] [--skip-index] [--json]
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepo } from '../lib/validator.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const toolRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(opt('--root') || toolRoot);
const res = validateRepo(root, { skipIndex: args.includes('--skip-index'), isToolRepo: root === resolve(toolRoot) });
if (args.includes('--json')) { console.log(JSON.stringify(res, null, 2)); }
else {
  for (const w of res.warnings) console.warn(`WARN  ${w.file}: ${w.message}`);
  for (const e of res.errors) console.error(`ERROR ${e.file}: ${e.message}`);
  console.log(`[validate] root=${root} errors=${res.errors.length} warnings=${res.warnings.length} stats=${JSON.stringify(res.stats)}`);
}
process.exit(res.errors.length ? 1 : 0);
