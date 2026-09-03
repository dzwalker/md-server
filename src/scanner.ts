import fs from 'node:fs';
import path from 'node:path';
import { ROOTS, EXCLUDES } from './config.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const matter = require('gray-matter');

export interface MdFile {
  urlPath: string;
  fsPath: string;
  name: string;
  dir: string;
  title: string;
  mtimeMs: number;
  size: number;
  frontmatter: Record<string, unknown>;
}

function shouldSkip(name: string): boolean {
  if (name.startsWith('.')) return true;
  return EXCLUDES.includes(name);
}

function firstHeading(content: string): string | null {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function buildFile(rootUrl: string, rootDir: string, full: string): MdFile {
  const rel = path.relative(rootDir, full).split(path.sep).join('/');
  const urlPath = rootUrl + '/' + rel;
  const st = fs.statSync(full);
  let frontmatter: Record<string, unknown> = {};
  let title = path.basename(full, path.extname(full));
  try {
    const raw = fs.readFileSync(full, 'utf8');
    const parsed = matter(raw);
    frontmatter = (parsed.data as Record<string, unknown>) || {};
    title = (frontmatter.title as string) || firstHeading(parsed.content) || title;
  } catch { /* ignore */ }
  return {
    urlPath, fsPath: full, name: path.basename(full),
    dir: path.posix.dirname(urlPath), title,
    mtimeMs: st.mtimeMs, size: st.size, frontmatter,
  };
}

function scanDir(rootUrl: string, rootDir: string, out: MdFile[]) {
  if (!fs.existsSync(rootDir)) return;
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!shouldSkip(e.name)) stack.push(full); }
      else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) out.push(buildFile(rootUrl, rootDir, full));
    }
  }
}

export function scanAll(): MdFile[] {
  const out: MdFile[] = [];
  for (const r of ROOTS) scanDir(r.url, r.dir, out);
  return out.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
}

export interface TreeNode { name: string; path: string; type: 'dir' | 'file'; title?: string; children?: TreeNode[]; }

export function buildTree(files: MdFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const map = new Map<string, TreeNode>();
  for (const f of files) {
    const segs = f.urlPath.split('/').filter(Boolean);
    let cur: TreeNode | null = null;
    for (let i = 0; i < segs.length; i++) {
      const isFile = i === segs.length - 1;
      const key = '/' + segs.slice(0, i + 1).join('/');
      if (map.has(key)) { cur = map.get(key)!; continue; }
      const node: TreeNode = isFile
        ? { name: segs[i], path: f.urlPath, type: 'file', title: f.title }
        : { name: segs[i], path: key, type: 'dir', children: [] };
      map.set(key, node);
      if (cur) cur.children!.push(node); else root.push(node);
      cur = node;
    }
  }
  const sort = (ns: TreeNode[]) => ns.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1));
  const walk = (ns: TreeNode[]) => { sort(ns); for (const n of ns) if (n.children) walk(n.children); };
  walk(root);
  return root;
}
