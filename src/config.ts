import fs from 'node:fs';

export interface Root { url: string; dir: string; }
export interface SpaceSet { id: string; name: string; dirs: string[]; embed: boolean; }

// set 里填写的目录名都相对于这个挂载父目录（如 /data/workspace/investment）。
// 用户不需要在 UI 里写 /data/... 前缀，这里统一拼。
export const BASE_DIR = process.env.MD_BASE_DIR || '/data/workspace';
export const SETS_FILE = process.env.MD_SETS_FILE || '/app/sets.json';

const DEFAULT_SETS: SpaceSet[] = [
  { id: 'default', name: '默认', dirs: ['investment', 'learning-ad', 'personal', 'neolix-mgmt'], embed: false },
];

function loadSets(): SpaceSet[] {
  // 1) sets.json 配置文件（空间管理）
  try {
    if (fs.existsSync(SETS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETS_FILE, 'utf8'));
      if (Array.isArray(parsed) && parsed.length) return normalizeSets(parsed);
    }
  } catch { /* ignore */ }
  // 2) MD_SETS 环境变量（测试/开发）
  const env = process.env.MD_SETS;
  if (env) {
    try { const p = JSON.parse(env); if (Array.isArray(p) && p.length) return normalizeSets(p); } catch { /* ignore */ }
  }
  // 3) 默认
  return DEFAULT_SETS;
}

function normalizeSets(list: unknown[]): SpaceSet[] {
  return list
    .map((raw) => {
      const s = raw as Partial<SpaceSet> | null | undefined;
      const dirs = Array.isArray(s?.dirs)
        ? [...new Set((s.dirs as unknown[]).map((d) => String(d).trim()).filter(Boolean))]
        : [];
      return { id: String(s?.id || '').trim(), name: String(s?.name || '').trim(), dirs, embed: s?.embed === true };
    })
    .filter((s) => s.id && s.name);
}

// set.dirs 的条目叫「作用域」（scope）：可以是一级目录名，也可以是挂载根下的子路径，
// 例如 "notion-archive/学习成长"。它只决定空间「视图」看到哪块内容；
// 物理 root（扫描根 / URL 前缀 / 资产物理根）永远按作用域的第一段派生，保证文档 urlPath 与磁盘路径一致。
export function normalizeScope(raw: unknown): string {
  return String(raw ?? '').trim().replace(/^\/+|\/+$/g, '');
}

/** 作用域条目的第一段 = 物理 root 名（"notion-archive/学习成长" → "notion-archive"）。 */
export function rootNameOf(scope: string): string {
  return normalizeScope(scope).split('/')[0] || '';
}

/** urlPath 是否落在某个作用域条目下（等于该目录，或该目录里的文档）。 */
export function inScope(urlPath: string, scope: string): boolean {
  const s = normalizeScope(scope);
  if (!s) return false;
  const p = urlPath.startsWith('/') ? urlPath : '/' + urlPath;
  return p === '/' + s || p.startsWith('/' + s + '/');
}

/** 两个作用域条目是否重叠（相等，或一个包含另一个）。 */
export function scopesOverlap(a: string, b: string): boolean {
  const x = normalizeScope(a);
  const y = normalizeScope(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/');
}

// 由所有 set 的作用域并集派生 ROOTS（url = '/' + 第一段）。scanner / index / embed / graph 复用。
export function deriveRoots(sets: SpaceSet[], baseDir = BASE_DIR): Root[] {
  const seen = new Set<string>();
  const out: Root[] = [];
  for (const s of sets) {
    for (const d of s.dirs) {
      const top = rootNameOf(d);
      if (!top || seen.has(top)) continue;
      seen.add(top);
      out.push({ url: '/' + top, dir: baseDir + '/' + top });
    }
  }
  return out;
}

// 可变数组：reloadSets() 原地替换内容，所有 import 这些变量的模块读到最新值。
export const SETS: SpaceSet[] = loadSets();
export const ROOTS: Root[] = deriveRoots(SETS);
export const PORT = Number(process.env.MD_PORT || 3001);
export const EXCLUDES = ['node_modules', 'dist', 'out', '__pycache__', '.cache'];

export function reloadSets(): SpaceSet[] {
  const next = loadSets();
  SETS.length = 0;
  SETS.push(...next);
  const roots = deriveRoots(SETS);
  ROOTS.length = 0;
  ROOTS.push(...roots);
  return SETS;
}

// 某文件的 urlPath 是否属于「参与语义索引」的空间（任一 embed=true 的 set 的作用域包含它）。
export function isEmbedEnabled(urlPath: string, sets: SpaceSet[] = SETS): boolean {
  for (const s of sets) {
    if (!s.embed) continue;
    if (s.dirs.some((d) => inScope(urlPath, d))) return true;
  }
  return false;
}

// 校验 + 规整一组 set。id 只允许英文字母/数字/-/_，且以字母或数字开头、全局唯一。
export function validateSets(
  list: unknown,
): { ok: true; sets: SpaceSet[]; error?: undefined } | { ok: false; sets?: undefined; error: string } {
  if (!Array.isArray(list) || !list.length) {
    return { ok: false, error: 'expected non-empty array of {id, name, dirs}' };
  }
  const ids = new Set<string>();
  const sets: SpaceSet[] = [];
  for (const raw of list as unknown[]) {
    const s = (raw || {}) as Partial<SpaceSet>;
    const id = String(s.id || '').trim();
    const name = String(s.name || '').trim();
    if (!name) return { ok: false, error: '每个 set 都需要一个名称 (name)' };
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
      return { ok: false, error: `set id "${id}" 只能包含英文字母/数字/-/_，且以字母或数字开头` };
    }
    if (ids.has(id)) return { ok: false, error: `set id "${id}" 重复` };
    ids.add(id);
    const dirs: string[] = [];
    for (const d of (Array.isArray(s.dirs) ? s.dirs : []) as string[]) {
      const dd = String(d).trim();
      if (!dd) continue;
      // 作用域条目：挂载根下的相对路径，可以多段（如 notion-archive/学习成长）。
      if (dd.includes('\\')) {
        return { ok: false, error: `目录 "${dd}" 不能包含反斜杠` };
      }
      if (dd.startsWith('/')) {
        return { ok: false, error: `目录 "${dd}" 必须是挂载根目录下的相对路径（不要以 / 开头）` };
      }
      const segs = dd.split('/');
      if (segs.some((seg) => seg === '' || seg === '.' || seg === '..')) {
        return { ok: false, error: `目录 "${dd}" 不能包含 ".."、"." 或空段（不要以 / 结尾）` };
      }
      const entry = segs.join('/');
      if (dirs.includes(entry)) continue;
      const dup = dirs.find((prev) => scopesOverlap(prev, entry));
      if (dup) {
        return {
          ok: false,
          error: `同一 set 里 "${entry}" 与 "${dup}" 重叠（一个包含另一个），请只保留一个`,
        };
      }
      dirs.push(entry);
    }
    sets.push({ id, name, dirs, embed: s.embed === true });
  }
  return { ok: true, sets };
}
