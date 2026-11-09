import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURE = join(ROOT, 'fixtures/sample-repo');

export function tmpCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'sticker-assets-test-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}
export const rj = (dir, p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
export const wj = (dir, p, v, compact = false) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), compact ? JSON.stringify(v) + '\n' : JSON.stringify(v, null, 2) + '\n'); };
export const reader = (dir) => (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : undefined);
export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

/** 在内存 Map 上读：Buffer 原样，其它转字符串 */
export const mapReader = (files) => (p) => { const v = files.get(p); return v === undefined ? undefined : Buffer.isBuffer(v) ? v : String(v); };
