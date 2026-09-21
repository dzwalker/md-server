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

// 只扫描一个 root（新增空间/目录时用），不触碰其他空间。
export function scanRoot(url: string, dir: string): MdFile[] {
  const out: MdFile[] = [];
  scanDir(url, dir, out);
  return out;
}

// 命中某个 root 的 fsPath 时返回 {rootUrl, rootDir}，否则 null。
function matchRoot(full: string): { url: string; dir: string } | null {
  const resolved = path.resolve(full);
  for (const r of ROOTS) {
    const rd = path.resolve(r.dir);
    if (resolved === rd || resolved.startsWith(rd + path.sep)) return { url: r.url, dir: rd };
  }
  return null;
}

// 只读单个文件构造 MdFile（增量索引用；不扫描整个空间）。
export function toMdFile(fsPath: string): MdFile | null {
  if (!/\.(md|markdown)$/i.test(fsPath)) return null;
  const m = matchRoot(fsPath);
  if (!m) return null;
  const full = path.resolve(fsPath);
  try {
    if (!fs.statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  return buildFile(m.url, m.dir, full);
}

// urlPath("/dir/a.md") -> 磁盘绝对路径；不在任何 root 内返回 null。
export function resolveUrlPath(urlPath: string): string | null {
  const segs = urlPath.split('/').filter(Boolean);
  if (!segs.length) return null;
  const root = ROOTS.find((r) => r.url === '/' + segs[0]);
  if (!root) return null;
  const rd = path.resolve(root.dir);
  const full = path.resolve(rd, segs.slice(1).join('/'));
  if (full !== rd && !full.startsWith(rd + path.sep)) return null;
  return full;
}

// 增量索引要删除的 urlPath：文件已不在磁盘上时仍能算出它属于哪个 root。
export function fsPathToUrlPath(fsPath: string): string | null {
  const m = matchRoot(fsPath);
  if (!m) return null;
  const rel = path.relative(path.resolve(m.dir), path.resolve(fsPath)).split(path.sep).join('/');
  return m.url + '/' + rel;
}

// 列出所有目录的 urlPath（含空间根与空目录），供 buildTree 补全无 md 文件的目录节点。
export function scanDirs(): string[] {
  const out: string[] = [];
  for (const r of ROOTS) {
    if (!fs.existsSync(r.dir)) continue;
    out.push(r.url);
    const stack = [r.dir];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || shouldSkip(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(r.dir, full).split(path.sep).join('/');
        out.push(r.url + '/' + rel);
        stack.push(full);
      }
    }
  }
  return out;
}

export interface TreeNode { name: string; path: string; type: 'dir' | 'file'; title?: string; children?: TreeNode[]; }

// buildTree 只需要路径与标题，因此索引表(listFileSummaries)也能直接喂进来。
export interface TreeFile { urlPath: string; title?: string; }

export function buildTree(files: TreeFile[], extraDirs: string[] = []): TreeNode[] {
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
  // 补全空目录（无 md 文件的目录也要在树中显示，例如刚新建的空间文件夹）
  for (const dirPath of extraDirs) {
    const segs = dirPath.split('/').filter(Boolean);
    let parentArr = root;
    for (let i = 0; i < segs.length; i++) {
      const key = '/' + segs.slice(0, i + 1).join('/');
      let node = map.get(key);
      if (!node) {
        node = { name: segs[i], path: key, type: 'dir', children: [] };
        map.set(key, node);
        parentArr.push(node);
      }
      parentArr = node.children!;
    }
  }
  const sort = (ns: TreeNode[]) => ns.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1));
  const walk = (ns: TreeNode[]) => { sort(ns); for (const n of ns) if (n.children) walk(n.children); };
  walk(root);
  return root;
}
