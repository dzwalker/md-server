import fs from 'node:fs';
import path from 'node:path';
import { EXCLUDES } from './config.js';

/**
 * 只读目录浏览（空间管理的「选择目录」弹窗用，见 specs/space-scope/）。
 *
 * 只列目录、不读文件内容；目标路径必须落在 BASE_DIR 内（软链指向外面也算越界），
 * 隐藏目录（`.` 开头）与构建产物目录（EXCLUDES）不列。
 */

export interface BrowseEntry {
  /** 目录名（不带路径）。 */
  name: string;
  /** 相对 BASE_DIR 的路径，可直接作为 set 的作用域条目（如 `notion-archive/学习成长`）。 */
  path: string;
  /** 该目录（含子孙目录）下的 md 篇数，由调用方注入统计函数，缺省为 0。 */
  mdCount: number;
  /** 是否有下一级目录（决定 UI 是否显示「进入」箭头）。 */
  hasChildren: boolean;
}

export interface BrowseResult {
  /** 挂载根（服务端真实路径，仅用于展示）。 */
  baseDir: string;
  /** 当前目录相对 BASE_DIR 的路径，根目录为 ''。 */
  path: string;
  /** 上一级相对路径；根目录为 null。 */
  parent: string | null;
  entries: BrowseEntry[];
}

export class BrowseError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'BrowseError';
    this.status = status;
  }
}

/** 规整用户给的相对目录：去掉首尾 `/`，拒绝 `..` / `.` / 空段 / 反斜杠。 */
export function normalizeBrowsePath(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!s) return '';
  if (s.includes('\\')) throw new BrowseError(`非法目录：${s}`);
  const segs = s.split('/');
  if (segs.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new BrowseError(`非法目录：${s}`);
  }
  return segs.join('/');
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function shouldSkip(name: string): boolean {
  return name.startsWith('.') || EXCLUDES.includes(name);
}

/** 解析并校验浏览目标：必须落在 baseDir 内（软链也不能越界），且是真实存在的目录。 */
export function resolveBrowseDir(baseDir: string, rel: string): string {
  const base = path.resolve(baseDir);
  const baseReal = realpathOrSelf(base);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new BrowseError('目录越界');
  let st: fs.Stats;
  try {
    st = fs.statSync(full);
  } catch {
    throw new BrowseError(`目录不存在：${rel || '/'}`, 404);
  }
  if (!st.isDirectory()) throw new BrowseError(`不是目录：${rel}`, 400);
  const real = fs.realpathSync(full);
  if (real !== baseReal && !real.startsWith(baseReal + path.sep)) throw new BrowseError('目录越界');
  return real;
}

function hasChildDir(dir: string): boolean {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .some((e) => e.isDirectory() && !shouldSkip(e.name));
  } catch {
    return false;
  }
}

/**
 * 列出 BASE_DIR 下某一层的目录。
 * @param mdCount 可选：给某个应用内 urlPath 前缀（如 `/notion-archive/学习成长`）统计 md 篇数。
 */
export function listBrowseDirs(opts: {
  baseDir: string;
  rel?: string;
  mdCount?: (urlPath: string) => number;
}): BrowseResult {
  const rel = normalizeBrowsePath(opts.rel);
  const dir = resolveBrowseDir(opts.baseDir, rel);
  const entries: BrowseEntry[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || shouldSkip(e.name)) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    entries.push({
      name: e.name,
      path: childRel,
      mdCount: opts.mdCount ? opts.mdCount('/' + childRel) : 0,
      hasChildren: hasChildDir(path.join(dir, e.name)),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const parent = rel ? (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '') : null;
  return { baseDir: opts.baseDir, path: rel, parent, entries };
}
