import fs from 'node:fs';
import path from 'node:path';
import { WriteError, statMdFile } from './file-write.js';

/**
 * 编辑态图片上传：把粘贴/拖拽进来的图片落到**当前文档所在目录下的 `assets/`**，
 * 返回可用于 markdown 的相对路径（`assets/xxx.png`）。
 *
 * 为什么要落在文档目录：笔记里的图片一直是相对路径，阅读态由 `render.ts` 改写成
 * `/api/asset/*`；相对路径还能在 Typora/Obsidian/GitHub 里直接打开，不绑定本服务。
 *
 * 安全与身份：
 * - 只接受常见图片 MIME（按 MIME 决定扩展名，不信任文件名后缀，防「改后缀传脚本」）；
 * - 大小上限 10MB；写进固定 `assets/` 子目录，文件名只保留字母/数字/中文/`_`/`-`；
 * - 新建目录与文件都尽量对齐文档目录的属主（容器以 root 跑时不会把文件变成 root:root）。
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

export interface UploadResult {
  /** 相对文档目录的路径（写进 markdown 用，如 `assets/图片-20261104-120000-ab12.png`）。 */
  relPath: string;
  /** 应用内 urlPath（如 `/personal/notes/assets/xxx.png`），便于前端直接预览。 */
  urlPath: string;
  size: number;
}

function sanitizeBase(originalName?: string): string {
  const base = String(originalName || '')
    .replace(/\.[^.]+$/, '')
    .normalize('NFKC');
  const cleaned = base
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || 'image';
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 把新文件的属主对齐到文档目录（best effort：拿不到 uid/gid 的平台跳过）。 */
function alignOwner(target: string, ownerRef: fs.Stats, mode: number) {
  if (typeof process.getuid === 'function' && process.getuid() === ownerRef.uid && process.getgid() === ownerRef.gid) {
    // 进程身份已经等于目录属主，不需要也不能 chown
  } else {
    try {
      fs.chownSync(target, ownerRef.uid, ownerRef.gid);
    } catch {
      /* 非 root 或无权限时忽略：至少不要让上传失败 */
    }
  }
  try {
    fs.chmodSync(target, mode);
  } catch {
    /* ignore */
  }
}

/**
 * 保存一张图片到文档目录下的 `assets/`。
 *
 * @param docFsPath 目标文档的磁盘路径（必须存在且是 .md）
 * @param docUrlPath 目标文档的 urlPath（用于拼返回的 urlPath）
 */
export function saveDocImage(
  docFsPath: string,
  docUrlPath: string,
  contentType: string,
  data: Buffer,
  originalName?: string,
): UploadResult {
  statMdFile(docFsPath);
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  const ext = MIME_EXT[ct];
  if (!ext) throw new WriteError(`不支持的图片类型：${ct || '未知'}`, 415);
  if (!data || data.length === 0) throw new WriteError('图片内容为空', 400);
  if (data.length > MAX_UPLOAD_BYTES) {
    throw new WriteError(`图片过大（上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB）`, 413);
  }

  const docDir = path.dirname(docFsPath);
  const assetsDir = path.join(docDir, 'assets');
  const docDirStat = fs.statSync(docDir);
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    alignOwner(assetsDir, docDirStat, 0o755);
  }

  const base = sanitizeBase(originalName);
  let fileName = `${base}-${stamp()}-${Math.random().toString(36).slice(2, 6)}${ext}`;
  let filePath = path.join(assetsDir, fileName);
  for (let i = 1; fs.existsSync(filePath) && i < 20; i += 1) {
    fileName = `${base}-${stamp()}-${Math.random().toString(36).slice(2, 6)}${ext}`;
    filePath = path.join(assetsDir, fileName);
  }
  try {
    fs.writeFileSync(filePath, data, { flag: 'wx' });
  } catch (e) {
    throw new WriteError(`图片写入失败：${e instanceof Error ? e.message : String(e)}`, 500);
  }
  alignOwner(filePath, docDirStat, 0o644);

  const relPath = 'assets/' + fileName;
  const urlDir = docUrlPath.slice(0, docUrlPath.lastIndexOf('/'));
  return { relPath, urlPath: `${urlDir}/${relPath}`, size: data.length };
}
