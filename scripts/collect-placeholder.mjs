#!/usr/bin/env node
// 兼容旧入口：转发到 scripts/collect.mjs（仍尊重登记表 approved + 适配器白名单）。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const collect = join(here, 'collect.mjs');
const args = process.argv.slice(2);
// Actions 默认 dry-run；本地显式 --upload 才会写库
const res = spawnSync(process.execPath, [collect, ...args], { stdio: 'inherit' });
process.exit(res.status ?? 1);
