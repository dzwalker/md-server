import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { scanAll } from './scanner.js';
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
      path TEXT PRIMARY KEY, title TEXT, dir TEXT, frontmatter TEXT, body TEXT, mtime_ms INTEGER, size INTEGER
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
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(path UNINDEXED, body, tokenize='trigram');
  `);
  // 迁移：旧库补 pinyin 列
  const cols = (db.prepare('PRAGMA table_info(files)').all() as any[]).map((c) => c.name);
  if (!cols.includes('pinyin')) db.exec('ALTER TABLE files ADD COLUMN pinyin TEXT');
  return db;
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
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM files').run();
    d.prepare('DELETE FROM tags').run();
    d.prepare('DELETE FROM fts').run();
    d.prepare('DELETE FROM links').run();
    const insF = d.prepare('INSERT INTO files(path,title,dir,frontmatter,body,mtime_ms,size,pinyin) VALUES(?,?,?,?,?,?,?,?)');
    const insT = d.prepare('INSERT OR IGNORE INTO tags(file_path,tag) VALUES(?,?)');
    const insFts = d.prepare('INSERT INTO fts(path,body) VALUES(?,?)');
    const insL = d.prepare('INSERT INTO links(source,target) VALUES(?,?)');
    for (const f of files) {
      let body = '';
      try { body = matter(fs.readFileSync(f.fsPath, 'utf8')).content || ''; } catch { /* ignore */ }
      const pinyinStr = toPinyin(f.title + '\n' + body.slice(0, 2000));
      insF.run(f.urlPath, f.title, f.dir, JSON.stringify(f.frontmatter || {}), body, f.mtimeMs, f.size, pinyinStr);
      for (const t of extractTags(f.frontmatter)) insT.run(f.urlPath, t);
      insFts.run(f.urlPath, body);
      for (const w of extractWikilinks(body)) insL.run(f.urlPath, w);
    }
  });
  tx();
  return indexStats();
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
  if (t === ql) return 1000;
  if (t.startsWith(ql)) return 500;
  if (t.includes(ql)) return 200;
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

  // 关键词：多路召回 + 打分排序
  const cand = new Map<string, number>();
  const bump = (p: string, s: number) => { if (p) cand.set(p, Math.max(cand.get(p) || 0, s)); };

  // 1) 标题匹配（权重最高）
  for (const r of d.prepare('SELECT path, title FROM files WHERE title LIKE ?').all('%' + qq + '%') as any[]) {
    bump(r.path, titleBoost(r.title, qq));
  }

  // 2) FTS 全文（>=3 字符，trigram）
  if (qq.length >= 3) {
    try {
      const rows = d.prepare('SELECT fts.path FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?').all(qq, limit * 4) as any[];
      rows.forEach((r, i) => bump(r.path, 400 - i));
    } catch { /* trigram MATCH 对特殊字符可能抛错，忽略 */ }
  }

  // 3) 拼音匹配（ASCII 查询：支持 "touzi" 搜「投资」）
  if (isAscii(qq)) {
    for (const r of d.prepare('SELECT path FROM files WHERE pinyin LIKE ?').all('%' + qq.toLowerCase() + '%') as any[]) {
      bump(r.path, 250);
    }
  }

  // 4) 正文 LIKE 兜底（短词/中文/CJK、FTS 漏掉的）
  for (const r of d.prepare('SELECT path, title FROM files WHERE body LIKE ? OR title LIKE ?').all('%' + qq + '%', '%' + qq + '%') as any[]) {
    bump(r.path, 50 + titleBoost(r.title, qq));
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
