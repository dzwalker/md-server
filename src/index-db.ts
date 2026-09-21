import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { scanAll } from './scanner.js';
import type { MdFile } from './scanner.js';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const matter = require('gray-matter');
const { pinyin } = require('pinyin-pro');

const DB_PATH = process.env.MD_INDEX_DB || '/data/index/md-index.db';

let db: any = null;
function init() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY, title TEXT, dir TEXT, frontmatter TEXT, body TEXT, mtime_ms INTEGER, size INTEGER, name TEXT
    );
    CREATE TABLE IF NOT EXISTS tags (
      file_path TEXT, tag TEXT, PRIMARY KEY(file_path, tag)
    );
    CREATE TABLE IF NOT EXISTS links (
      source TEXT, target TEXT
    );
    CREATE TABLE IF NOT EXISTS favorites (
      path TEXT PRIMARY KEY, pinned INTEGER DEFAULT 0, added_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY, value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_links_source ON links(source);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(path UNINDEXED, body, tokenize='trigram');
  `);
  // 迁移：旧库补 pinyin / name 列
  const cols = (db.prepare('PRAGMA table_info(files)').all() as any[]).map((c) => c.name);
  if (!cols.includes('pinyin')) db.exec('ALTER TABLE files ADD COLUMN pinyin TEXT');
  if (!cols.includes('name')) db.exec('ALTER TABLE files ADD COLUMN name TEXT');
  // WAL 上限：checkpoint 后把 WAL 截断到 64MB，避免历史全量重建把 -wal 撑到 GB 级。
  try { db.pragma('journal_size_limit = 67108864'); } catch { /* ignore */ }
  return db;
}

// ---------- meta：索引自身的迁移标记 ----------
// fts 行号与 files 行号一一对应后（v2），增量更新才能按 rowid 快速删行。
const FTS_ROWID_KEY = 'fts_rowid_v2';
// 上次索引同步完成时间：启动时据此只补「停机期间被改动的文件」，不再全量重建。
const LAST_SYNC_KEY = 'last_sync_at';

function getMeta(d: any, key: string): string | null {
  const r = d.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value?: string } | undefined;
  return r && typeof r.value === 'string' ? r.value : null;
}

function setMeta(d: any, key: string, value: string) {
  d.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

function extractTags(fm: any): string[] {
  const t = fm && fm.tags;
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return t.split(/[,，\s]+/).filter(Boolean);
  return [];
}

function toPinyin(s: string): string {
  if (!s) return '';
  try {
    return pinyin(s, { toneType: 'none', type: 'string', nonZh: 'consecutive' })
      .replace(/[^a-z0-9]/gi, '').toLowerCase();
  } catch { return ''; }
}

export function rebuildIndex() {
  const d = init();
  const files = scanAll();
  const s = makeStatements(d);
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM files').run();
    d.prepare('DELETE FROM tags').run();
    d.prepare('DELETE FROM fts').run();
    d.prepare('DELETE FROM links').run();
    for (const f of files) {
      insertOne(d, s, f, readBody(f.fsPath));
    }
    setMeta(d, FTS_ROWID_KEY, '1');
  });
  tx();
  return indexStats();
}

// ---------- 增量索引 ----------
// 磁盘上一个文件变了：只删/只建这一个文件的行，不再全库重建。
// 注意：fts 的行号与 files 的行号一一对应（fts_rowid_v2），因此删行是 O(1) 定位，
// 不会退化成 FTS 全表扫描（那是全量重建 40~60s 卡死的主因）。

function readBody(fsPath: string): string {
  try { return matter(fs.readFileSync(fsPath, 'utf8')).content || ''; } catch { return ''; }
}

function makeStatements(d: any) {
  return {
    insFile: d.prepare('INSERT INTO files(path,title,dir,frontmatter,body,mtime_ms,size,pinyin,name) VALUES(?,?,?,?,?,?,?,?,?)'),
    insTag: d.prepare('INSERT OR IGNORE INTO tags(file_path,tag) VALUES(?,?)'),
    insFts: d.prepare('INSERT INTO fts(rowid,path,body) VALUES(?,?,?)'),
    insLink: d.prepare('INSERT INTO links(source,target) VALUES(?,?)'),
    delFts: d.prepare('DELETE FROM fts WHERE rowid IN (SELECT rowid FROM files WHERE path=?)'),
    delTags: d.prepare('DELETE FROM tags WHERE file_path=?'),
    delLinks: d.prepare('DELETE FROM links WHERE source=?'),
    delFile: d.prepare('DELETE FROM files WHERE path=?'),
  };
}

function insertOne(d: any, s: ReturnType<typeof makeStatements>, f: MdFile, body: string) {
  const pinyinStr = toPinyin(f.title + '\n' + body.slice(0, 2000));
  const row = s.insFile.run(f.urlPath, f.title, f.dir, JSON.stringify(f.frontmatter || {}), body, f.mtimeMs, f.size, pinyinStr, f.name);
  s.insFts.run(row.lastInsertRowid, f.urlPath, body);
  for (const t of extractTags(f.frontmatter)) s.insTag.run(f.urlPath, t);
  for (const w of extractWikilinks(body)) s.insLink.run(f.urlPath, w);
}

function removeOne(s: ReturnType<typeof makeStatements>, urlPath: string) {
  s.delFts.run(urlPath);
  s.delTags.run(urlPath);
  s.delLinks.run(urlPath);
  s.delFile.run(urlPath);
}

// 老库（fts 行号还没与 files 对齐）先做一次全量重建，保证后续增量删行不会残留脏数据。
function requireFtsRowid(d: any) {
  if (getMeta(d, FTS_ROWID_KEY) !== '1') rebuildIndex();
}

/** 增量（重）建若干文件：先删旧行再插新行。 */
export function indexFiles(files: MdFile[]) {
  if (!files.length) return indexStats();
  const d = init();
  requireFtsRowid(d);
  const s = makeStatements(d);
  const tx = d.transaction(() => {
    for (const f of files) {
      removeOne(s, f.urlPath);
      insertOne(d, s, f, readBody(f.fsPath));
    }
  });
  tx();
  return indexStats();
}

/**
 * 分批增量索引：每批之间让出事件循环，用于「新增一个大目录」这类批量导入，
 * 避免像全量重建那样把服务冻结几十秒。
 */
export async function indexFilesInBatches(files: MdFile[], batch = 80) {
  if (!files.length) return indexStats();
  const d = init();
  requireFtsRowid(d);
  const s = makeStatements(d);
  for (let i = 0; i < files.length; i += batch) {
    const chunk = files.slice(i, i + batch);
    const tx = d.transaction(() => {
      for (const f of chunk) {
        removeOne(s, f.urlPath);
        insertOne(d, s, f, readBody(f.fsPath));
      }
    });
    tx();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return indexStats();
}

/** 全量重建后截断 WAL（否则 -wal 会长期占住磁盘）。 */
export function truncateWal() {
  try { init().pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
}

/**
 * 启动时的索引同步：库为空/缺标记时全量重建；否则只补「上次同步之后改动的文件」。
 * 把重启从 ~60s 全量重建降到 ~1s（典型只补个位数文件）。
 */
export function syncIndex(): { mode: 'full' | 'incremental'; files: number; changed: number } {
  const d = init();
  const last = Number(getMeta(d, LAST_SYNC_KEY) || 0);
  const indexed = (d.prepare('SELECT COUNT(*) c FROM files').get() as any).c as number;
  if (!last || !indexed || getMeta(d, FTS_ROWID_KEY) !== '1') {
    rebuildIndex();
    setMeta(init(), LAST_SYNC_KEY, String(Date.now()));
    return { mode: 'full', files: indexedTotal(), changed: indexedTotal() };
  }
  const files = scanAll();
  const seen = new Set(files.map((f) => f.urlPath));
  const known = (d.prepare('SELECT path FROM files').all() as { path: string }[]).map((r) => r.path);
  const toIndex = files.filter((f) => f.mtimeMs > last);
  const toRemove = known.filter((p) => !seen.has(p));
  if (toIndex.length) indexFiles(toIndex);
  if (toRemove.length) removeIndexPaths(toRemove);
  setMeta(d, LAST_SYNC_KEY, String(Date.now()));
  return { mode: 'incremental', files: files.length, changed: toIndex.length + toRemove.length };
}

function indexedTotal(): number {
  return (init().prepare('SELECT COUNT(*) c FROM files').get() as any).c as number;
}

/** 增量删除若干文件（按 urlPath）。 */
export function removeIndexPaths(urlPaths: string[]) {
  if (!urlPaths.length) return indexStats();
  const d = init();
  requireFtsRowid(d);
  const s = makeStatements(d);
  const tx = d.transaction(() => { for (const p of urlPaths) removeOne(s, p); });
  tx();
  return indexStats();
}

/** 增量删除某目录下的全部文档（目录被删/改名时用）。返回删除条数。 */
export function removeIndexPrefix(urlPrefix: string) {
  const d = init();
  requireFtsRowid(d);
  const like = urlPrefix.replace(/\/+$/, '') + '/%';
  const rows = d.prepare('SELECT path FROM files WHERE path LIKE ?').all(like) as { path: string }[];
  const s = makeStatements(d);
  const tx = d.transaction(() => { for (const r of rows) removeOne(s, r.path); });
  tx();
  return rows.length;
}

/**
 * 分批删除某目录下的全部文档：每批之间让出事件循环。
 * 删除大文档的 FTS 行并不便宜（单条约 10~20ms），整目录一次删会把请求/其它接口卡住几秒。
 */
export async function removeIndexPrefixInBatches(urlPrefix: string, batch = 40) {
  const d = init();
  requireFtsRowid(d);
  const like = urlPrefix.replace(/\/+$/, '') + '/%';
  const rows = d.prepare('SELECT path FROM files WHERE path LIKE ?').all(like) as { path: string }[];
  const s = makeStatements(d);
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const tx = d.transaction(() => { for (const r of chunk) removeOne(s, r.path); });
    tx();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return rows.length;
}

function makeSnippet(body: string, q: string, radius = 50): string {
  const idx = body.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return body.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + q.length + radius);
  return (start > 0 ? '…' : '') + body.slice(start, end).replace(/\s+/g, ' ').trim() + (end < body.length ? '…' : '');
}

function titleBoost(title: string | undefined, q: string): number {
  const t = (title || '').toLowerCase();
  const ql = q.toLowerCase();
  if (!t) return 0;
  if (t === ql) return 2800; // 标题精确
  if (t.startsWith(ql)) return 2700; // 标题开头
  if (t.includes(ql)) return 2600; // 标题包含
  return 0;
}

function isAscii(q: string): boolean { return /^[a-z0-9]+$/i.test(q); }

export function searchFiles(q: string, opts: { tag?: string; dir?: string; limit?: number } = {}) {
  const d = init();
  const limit = opts.limit || 30;
  const qq = (q || '').trim();

  // 无关键词：标签/目录浏览
  if (!qq) {
    if (!opts.tag && !opts.dir) return [];
    const where: string[] = [];
    const params: any[] = [];
    if (opts.tag) { where.push('EXISTS(SELECT 1 FROM tags t WHERE t.file_path=f.path AND t.tag=?)'); params.push(opts.tag); }
    if (opts.dir) { where.push('f.dir LIKE ?'); params.push(opts.dir + '/%'); }
    const sql = 'SELECT f.path, f.title, f.dir, f.frontmatter, f.body FROM files f WHERE ' + where.join(' AND ') + ' ORDER BY f.path LIMIT 100';
    return d.prepare(sql).all(...params).map((r: any) => ({ path: r.path, title: r.title, dir: r.dir, frontmatter: JSON.parse(r.frontmatter || '{}'), snippet: makeSnippet(r.body, '') }));
  }

  // 关键词：多路召回 + 打分排序（分数越高越靠前，取各路的最高分）
  const cand = new Map<string, number>();
  const bump = (p: string, s: number) => { if (p) cand.set(p, Math.max(cand.get(p) || 0, s)); };

  // 1) 文件名精确开头（最高）
  for (const r of d.prepare('SELECT path FROM files WHERE name LIKE ?').all(qq + '%') as any[]) {
    bump(r.path, 3000);
  }

  // 2) 文件名精确包含
  for (const r of d.prepare('SELECT path FROM files WHERE name LIKE ?').all('%' + qq + '%') as any[]) {
    bump(r.path, 2900);
  }

  // 3) 标题匹配
  for (const r of d.prepare('SELECT path, title FROM files WHERE title LIKE ?').all('%' + qq + '%') as any[]) {
    bump(r.path, titleBoost(r.title, qq));
  }

  // 4) 文件路径精确包含
  for (const r of d.prepare('SELECT path FROM files WHERE path LIKE ?').all('%' + qq + '%') as any[]) {
    bump(r.path, 2500);
  }

  // 5) FTS 全文（>=3 字符，trigram）
  if (qq.length >= 3) {
    try {
      const rows = d.prepare('SELECT fts.path FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?').all(qq, limit * 4) as any[];
      rows.forEach((r, i) => bump(r.path, 400 - i));
    } catch { /* trigram MATCH 对特殊字符可能抛错，忽略 */ }
  }

  // 6) 拼音匹配（ASCII 查询：支持 "touzi" 搜「投资」）
  if (isAscii(qq)) {
    for (const r of d.prepare('SELECT path FROM files WHERE pinyin LIKE ?').all('%' + qq.toLowerCase() + '%') as any[]) {
      bump(r.path, 250);
    }
  }

  // 7) 正文 LIKE 兜底（短词/中文/CJK、FTS 漏掉的）
  for (const r of d.prepare('SELECT path FROM files WHERE body LIKE ?').all('%' + qq + '%') as any[]) {
    bump(r.path, 50);
  }

  // 标签/目录过滤预取
  let tagPaths: Set<string> | null = null;
  if (opts.tag) tagPaths = new Set((d.prepare('SELECT file_path FROM tags WHERE tag=?').all(opts.tag) as any[]).map((r) => r.file_path));

  const sorted = [...cand.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

  const getF = d.prepare('SELECT path, title, dir, frontmatter, body FROM files WHERE path=?');
  const out: any[] = [];
  for (const [p] of sorted) {
    const r = getF.get(p);
    if (!r) continue;
    if (tagPaths && !tagPaths.has(r.path)) continue;
    if (opts.dir && r.dir !== opts.dir && !r.dir.startsWith(opts.dir + '/')) continue;
    out.push({ path: r.path, title: r.title, dir: r.dir, frontmatter: JSON.parse(r.frontmatter || '{}'), snippet: makeSnippet(r.body, qq) });
    if (out.length >= limit) break;
  }
  return out;
}

function extractWikilinks(body: string): string[] {
  const re = /\[\[([^\]]+)\]\]/g;
  const out: string[] = [];
  let m;
  while ((m = re.exec(body))) {
    const target = m[1].split('|')[0].split('#')[0].trim();
    if (target) out.push(target);
  }
  return out;
}

export function backlinks(path: string) {
  const d = init();
  const name = (path.split('/').pop() || '').replace(/\.md$/i, '');
  const rows = d.prepare(`
    SELECT DISTINCT l.source AS path, f.title AS title
    FROM links l LEFT JOIN files f ON f.path = l.source
    WHERE l.target = ? OR l.target LIKE ?
    ORDER BY l.source
  `).all(name, '%/' + name);
  return rows;
}

export function outlinks(path: string) {
  const d = init();
  return d.prepare('SELECT target FROM links WHERE source = ? ORDER BY target').all(path).map((r: any) => r.target);
}

export function graph() {
  const d = init();
  return {
    nodes: d.prepare('SELECT path, title, dir FROM files ORDER BY path').all(),
    edges: d.prepare('SELECT source, target FROM links').all(),
  };
}

export function listTags() {
  return init().prepare('SELECT tag, COUNT(*) AS cnt FROM tags GROUP BY tag ORDER BY cnt DESC, tag ASC').all();
}

export function indexStats() {
  const d = init();
  return { files: (d.prepare('SELECT COUNT(*) c FROM files').get() as any).c, tags: (d.prepare('SELECT COUNT(*) c FROM tags').get() as any).c };
}

// ---------- 只读查询（供 HTTP/MCP 用，避免每个请求全库扫盘） ----------

/** 树只需要 路径 + 标题。 */
export function listFileSummaries(): { urlPath: string; title: string; name: string }[] {
  return (init().prepare('SELECT path, title, name FROM files ORDER BY path').all() as any[]).map((r) => ({
    urlPath: r.path, title: r.title || r.name || r.path, name: r.name || r.path.split('/').pop(),
  }));
}

/** /api/files 全量元信息（不含正文，正文单独读盘）。 */
export function listFilesMeta(): { urlPath: string; title: string; name: string; dir: string; frontmatter: Record<string, unknown>; mtimeMs: number; size: number }[] {
  return (init().prepare('SELECT path, title, name, dir, frontmatter, mtime_ms, size FROM files ORDER BY path').all() as any[]).map((r) => ({
    urlPath: r.path, title: r.title || r.name || r.path, name: r.name || r.path.split('/').pop(), dir: r.dir,
    frontmatter: JSON.parse(r.frontmatter || '{}'), mtimeMs: r.mtime_ms || 0, size: r.size || 0,
  }));
}

/** 单个文件的元信息；索引里没有则返回 null。 */
export function getFileMeta(urlPath: string): { urlPath: string; title: string; name: string; dir: string; frontmatter: Record<string, unknown>; mtimeMs: number; size: number } | null {
  const r = init().prepare('SELECT path, title, name, dir, frontmatter, mtime_ms, size FROM files WHERE path=?').get(urlPath) as any;
  if (!r) return null;
  return {
    urlPath: r.path, title: r.title || r.name || r.path, name: r.name || r.path.split('/').pop(), dir: r.dir,
    frontmatter: JSON.parse(r.frontmatter || '{}'), mtimeMs: r.mtime_ms || 0, size: r.size || 0,
  };
}

// ---------- 收藏 / 置顶 ----------
export function listFavorites() {
  const d = init();
  const rows = d.prepare(`
    SELECT fav.path, fav.pinned, fav.added_at, f.title, f.dir
    FROM favorites fav LEFT JOIN files f ON f.path = fav.path
    ORDER BY fav.pinned DESC, fav.added_at DESC
  `).all();
  return rows.map((r: any) => ({ path: r.path, title: r.title || r.path.split('/').pop(), dir: r.dir, pinned: !!r.pinned, addedAt: r.added_at }));
}

export function setFavorite(path: string, pinned = false) {
  const d = init();
  d.prepare('INSERT INTO favorites(path, pinned, added_at) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET pinned=excluded.pinned').run(path, pinned ? 1 : 0, Date.now());
  return listFavorites();
}

export function removeFavorite(path: string) {
  const d = init();
  d.prepare('DELETE FROM favorites WHERE path=?').run(path);
  return listFavorites();
}

// ---------- 待办 / 到期任务（供 n8n 到期提醒使用） ----------
export function listTodos(root?: string) {
  const d = init();
  const rows = root
    ? d.prepare('SELECT path, body FROM files WHERE path LIKE ?').all(root + '/%')
    : d.prepare('SELECT path, body FROM files').all();
  const out: { path: string; line: string }[] = [];
  for (const r of rows) {
    for (const line of (r.body || '').split('\n')) {
      if (/^\s*- \[ \]/.test(line)) out.push({ path: r.path, line });
    }
  }
  return out;
}

const DUE_RE = /\(due:\s*(\d{4}-\d{2}-\d{2})\)/i;

export function listDueTasks(root?: string) {
  const d = init();
  const rows = root
    ? d.prepare('SELECT path, body FROM files WHERE path LIKE ?').all(root + '/%')
    : d.prepare('SELECT path, body FROM files').all();
  const out: { task: string; due: string; source: string }[] = [];
  for (const r of rows) {
    for (const line of (r.body || '').split('\n')) {
      if (!/^\s*- \[ \]/.test(line)) continue;
      const m = DUE_RE.exec(line);
      if (!m) continue;
      const task = line.replace(DUE_RE, '').replace(/^\s*- \[ \]\s*/, '').trim();
      out.push({ task, due: m[1], source: r.path });
    }
  }
  out.sort((a, b) => (a.due < b.due ? -1 : 1));
  return out;
}
