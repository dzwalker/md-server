import fs from 'node:fs';

export interface Root { url: string; dir: string; }

const DEFAULT_ROOTS: Root[] = [
  { url: '/docs', dir: '/data/docs' },
];

export const ROOTS_FILE = process.env.MD_ROOTS_FILE || '/app/roots.json';

function loadRoots(): Root[] {
  // 1) roots.json 配置文件（多空间管理）
  try {
    if (fs.existsSync(ROOTS_FILE)) {
      const roots = JSON.parse(fs.readFileSync(ROOTS_FILE, 'utf8'));
      if (Array.isArray(roots) && roots.length) return roots as Root[];
    }
  } catch (e) { /* ignore */ }
  // 2) MD_ROOTS 环境变量
  const env = process.env.MD_ROOTS;
  if (env) { try { const r = JSON.parse(env); if (Array.isArray(r) && r.length) return r as Root[]; } catch { /* ignore */ } }
  // 3) 默认
  return DEFAULT_ROOTS;
}

// 可变数组：reloadRoots() 原地替换内容，所有 import ROOTS 的模块读到最新值。
export const ROOTS: Root[] = loadRoots();
export const PORT = Number(process.env.MD_PORT || 3001);
export const EXCLUDES = ['node_modules', 'dist', 'out', '__pycache__', '.cache'];

export function reloadRoots(): Root[] {
  const next = loadRoots();
  ROOTS.length = 0;
  ROOTS.push(...next);
  return ROOTS;
}
