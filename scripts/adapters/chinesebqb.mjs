// ChineseBQB local/GitHub adapter for collect.
// Prefer a local mirror (COLLECT_MIRROR / --mirror) to avoid re-downloading.
// Skips cover-like files, huge files, and non-image junk.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

export const id = 'chinesebqb';
export const licenseId = 'zhaoolee-chinesebqb';
export const publicUrl = 'https://github.com/zhaoolee/ChineseBQB';
export const label = 'ChineseBQB（经典备用源）';

const IMAGE = /\.(gif|png|jpe?g|webp)$/i;
const COVER = /^(000000\d+|cover|封面|preview|thumb)/i;
const MAX_BYTES = 1.8 * 1024 * 1024;

function packTitleFromDir(name) {
  let t = name.replace(/_?BQB$/i, '').replace(/[🕊]/gu, '');
  const parts = t.split('_').filter(Boolean);
  const zh = parts.find((p) => /[\u4e00-\u9fa5]/.test(p));
  const pick = zh || parts[parts.length - 1] || t;
  return [...String(pick)].slice(0, 24).join('') || name;
}

function titleFromFile(name) {
  let t = name.replace(IMAGE, '');
  // 00016鸽子-当鸽的怎么能骗你呢 / 鸽子00002-像鸽子的鹦鹉 → 取描述段
  const m = t.match(/^[0-9A-Za-z\u4e00-\u9fa5]*-(.+)$/);
  if (m) t = m[1];
  else t = t.replace(/^\d+/, '');
  t = t.split('-')[0] || t;
  return [...t].slice(0, 80).join('') || name.replace(IMAGE, '').slice(0, 40);
}

function guessCategory(title) {
  const t = String(title).toLowerCase();
  if (/哈哈|开心|笑|happy|smile|laugh|lol/.test(t)) return 'laugh';
  if (/哭|sad|泪|伤心/.test(t)) return 'sad';
  if (/怒|angry|气/.test(t)) return 'angry';
  if (/睡|sleepy|困|tired/.test(t)) return 'sleepy';
  if (/谢|thanks|thank/.test(t)) return 'thanks';
  if (/好的|ok|同意|agree/.test(t)) return 'agree';
  if (/不|拒|refuse|\bno\b|别|鸽/.test(t)) return 'refuse';
  if (/惊|shock|what|wow|astonish/.test(t)) return 'shock';
  if (/无语|speech|沉默|呆|痴呆/.test(t)) return 'speechless';
  if (/吃|food|饿|hungry/.test(t)) return 'food';
  if (/加|班|bug|代码|需求|上线|锅|修电脑|程序员|work|加班|AI|训练/.test(t)) return 'work';
  if (/猫|狗|企鹅|动物|负鼠|鸽子|alien|cat|dog|animal|鸽|fox|bear|frog|penguin/.test(t)) return 'animal';
  if (/可爱|cute|萌|baby|angel/.test(t)) return 'cute';
  if (/庆祝|celebrate|party/.test(t)) return 'celebrate';
  if (/打招呼|hi|hello|greeting|wave/.test(t)) return 'greeting';
  return 'other';
}

function walkPacks(root) {
  const packs = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (name.startsWith('.') || name === 'node_modules') continue;
    // ChineseBQB pack folders look like 109_Opossum_负鼠_BQB or 029Pigeon_...
    if (!/_BQB$/i.test(name) && !/BQB$/i.test(name) && !/^\d{3}/.test(name)) continue;
    packs.push({ name, dir });
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {{ cursor?: string|null, limits?: { maxCandidates?: number }, mirror?: string }} opts
 */
export async function discover(opts = {}) {
  const mirror = opts.mirror || process.env.COLLECT_MIRROR || '';
  if (!mirror || !existsSync(mirror)) {
    return {
      candidates: [],
      nextCursor: null,
      note: `需要本地镜像目录（--mirror 或 COLLECT_MIRROR）。例：/tmp/sticker-import-src/ChineseBQB`,
    };
  }
  const max = Math.min(Math.max(opts.limits?.maxCandidates ?? 40, 1), 200);
  const start = Math.max(0, Number.parseInt(String(opts.cursor || '0'), 10) || 0);
  const packs = walkPacks(mirror);
  const all = [];
  for (const pack of packs) {
    const packLabel = packTitleFromDir(pack.name);
    let files = [];
    try { files = readdirSync(pack.dir); } catch { continue; }
    for (const file of files.sort()) {
      if (!IMAGE.test(file)) continue;
      if (COVER.test(file)) continue;
      const full = join(pack.dir, file);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isFile() || st.size <= 0 || st.size > MAX_BYTES) continue;
      const title = titleFromFile(file);
      const rel = relative(mirror, full).split(/[/\\]/).join('/');
      all.push({
        itemId: `chinesebqb:${rel}`.slice(0, 128),
        url: `file://${full}`,
        publishedAt: null,
        title,
        pack: packLabel,
        path: full,
        bytesHint: st.size,
      });
    }
  }
  const slice = all.slice(start, start + max);
  const next = start + max < all.length ? String(start + max) : null;
  return { candidates: slice, nextCursor: next, total: all.length };
}

/**
 * @param {object} candidate
 */
export async function fetchApproved(candidate) {
  const path = candidate.path || (candidate.url?.startsWith('file://') ? candidate.url.slice(7) : null);
  if (!path) throw new Error('chinesebqb candidate missing local path');
  const bytes = readFileSync(path);
  const title = candidate.title || titleFromFile(basename(path));
  const pack = candidate.pack || 'ChineseBQB';
  return {
    bytes,
    filename: basename(path),
    meta: {
      shareable: true,
      title: [...title].slice(0, 80).join(''),
      categories: [guessCategory(title)],
      tags: ['ChineseBQB', '表情包', [...pack].slice(0, 24).join(''), [...title].slice(0, 24).join('')].filter(Boolean),
      aliases: [],
      language: 'zh-CN',
      tone: 'neutral',
      safety: { rating: 'general', offensive: false },
      text: { ocr: title, ocrSource: 'manual', ocrConfirmed: false },
      source: {
        kind: 'adapter',
        adapter: id,
        url: publicUrl,
        itemId: candidate.itemId,
        publishedAt: candidate.publishedAt ?? null,
        confidence: 'high',
      },
      rights: { basis: 'creator-permission', licenseId, publicUrl },
    },
    provenance: {
      kind: 'adapter',
      adapter: id,
      url: publicUrl,
      itemId: candidate.itemId,
      publishedAt: candidate.publishedAt ?? null,
      confidence: 'high',
    },
  };
}
