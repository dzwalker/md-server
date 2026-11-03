import fs from 'node:fs';
import path from 'node:path';
import { WriteError, statMdFile, checkMtimeLock, writeFileAtomic, type WriteResult } from './file-write.js';

/**
 * 正文文档的文件级操作：**整篇保存 / 新建 / 改名**。
 *
 * 与「笔记行」(`notes.ts`) 的分工：笔记只改文件里被识别为 `> note:` 的那一行；
 * 这里改的是整篇正文（编辑器持有全文源码，未编辑的行逐字带回）。
 * 落盘的安全边界（原子写、属主/权限保持、mtime 乐观锁、只允许 .md）全部复用
 * `file-write.ts`，本模块只做参数校验与文件系统语义。
 *
 * `index.ts` 的 `/api/docs*` 路由只做路由与参数解析，业务都在这里（可单测）。
 */

/** 业务错误：路由按 `status` 映射 HTTP 码（父类 WriteError 统一兜底）。 */
export class DocError extends WriteError {
  constructor(message: string, status = 400) {
    super(message, status);
    this.name = 'DocError';
  }
}

/** 一次性提交的正文上限（防御性；正常 md 远小于此）。 */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/** 文件名里不允许出现的字符：路径分隔符、Windows 保留字符、控制字符。 */
const ILLEGAL_NAME_CHARS = /[\\/<>:"|?*\u0000-\u001f]/;

/** 去掉用户写进来的 md 扩展名（只去掉一层），便于「文件名」与「完整名」两种输入口径统一。 */
export function stripDocExt(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '');
}

/**
 * 校验并规整「文档基名」（不含扩展名）。
 *
 * 规则：去首尾空白；不允许空；不允许以 `.` 开头（隐藏文件不参与扫描）；
 * 不允许路径分隔符与 Windows 保留字符；不允许以 `.` 结尾（跨平台会不合法）；最长 120 字符。
 */
export function validateDocBaseName(raw: unknown): string {
  let name = String(raw ?? '').trim();
  name = stripDocExt(name).trim();
  if (!name) throw new DocError('文件名不能为空', 400);
  if (name === '.' || name === '..') throw new DocError('文件名不合法', 400);
  if (name.startsWith('.')) throw new DocError('文件名不能以 . 开头', 400);
  if (name.endsWith('.')) throw new DocError('文件名不能以 . 结尾', 400);
  if (ILLEGAL_NAME_CHARS.test(name)) throw new DocError('文件名不能包含 / \\ : * ? " < > | 等字符', 400);
  if (name.length > 120) throw new DocError('文件名过长（最多 120 个字符）', 400);
  return name;
}

/** 由基名与扩展名拼出完整文件名。 */
export function docFileName(base: string, ext = '.md'): string {
  return stripDocExt(base) + ext;
}

function dirOf(fsPath: string): string {
  const dir = path.dirname(fsPath);
  let st: fs.Stats;
  try {
    st = fs.statSync(dir);
  } catch {
    throw new DocError('目标目录不存在', 404);
  }
  if (!st.isDirectory()) throw new DocError('目标目录不存在', 404);
  return dir;
}

/**
 * 整篇保存正文。
 *
 * `content` 就是编辑器的全文源码：调用方必须把「没改的行」逐字带回来，
 * 这里不做任何换行/空白规整（CRLF、末尾换行、缩进都按提交内容原样落盘）。
 * 内容与磁盘完全相同则直接返回当前状态，不重写（不无谓地改 mtime）。
 */
export function saveDocFile(fsPath: string, content: string, expectMtimeMs?: number): WriteResult {
  const before = statMdFile(fsPath);
  checkMtimeLock(before, expectMtimeMs);
  const next = String(content ?? '');
  if (Buffer.byteLength(next, 'utf8') > MAX_DOC_BYTES) {
    throw new DocError(`正文过大（上限 ${Math.round(MAX_DOC_BYTES / 1024)} KB）`, 413);
  }
  const raw = fs.readFileSync(fsPath, 'utf8');
  if (raw === next) return { mtimeMs: before.mtimeMs, size: before.size };
  return writeFileAtomic(fsPath, next, before, 'mddoc');
}

/**
 * 新建空文档（内容默认空串；文件已存在 → 409）。
 *
 * 用 `flag: 'wx'` 一次完成「不存在才创建」，避免先 stat 再写之间的竞态；
 * 新建文件不需要搬属主/权限（它本来就没有原身份）。
 */
export function createDocFile(fsPath: string, content = ''): WriteResult {
  if (!/\.(md|markdown)$/i.test(fsPath)) throw new DocError('只能新建 .md 文件', 400);
  dirOf(fsPath);
  try {
    // wx：目标已存在则失败（EEXIST），不会覆盖别人的文件。
    fs.writeFileSync(fsPath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'EEXIST') throw new DocError('同名文件已存在', 409);
    if (code === 'ENOENT') throw new DocError('目标目录不存在', 404);
    if (code === 'EACCES' || code === 'EPERM') throw new DocError('没有写入权限', 403);
    throw new DocError(`新建失败：${e instanceof Error ? e.message : String(e)}`, 500);
  }
  const st = fs.statSync(fsPath);
  return { mtimeMs: st.mtimeMs, size: st.size };
}

/**
 * 改名（v1 只允许**同目录**换基名，不移动目录）。
 *
 * 文件系统 rename 会把目标已存在的文件**静默覆盖**，所以必须先挡掉同名目标；
 * 改名不改变 inode，属主/权限/内容天然保持。
 */
export function renameDocFile(oldFsPath: string, newFsPath: string): void {
  if (oldFsPath === newFsPath) return;
  statMdFile(oldFsPath);
  if (!/\.(md|markdown)$/i.test(newFsPath)) throw new DocError('只能改成 .md 文件', 400);
  if (path.dirname(oldFsPath) !== path.dirname(newFsPath)) {
    throw new DocError('只支持同目录改名', 400);
  }
  if (fs.existsSync(newFsPath)) throw new DocError('同名文件已存在', 409);
  try {
    fs.renameSync(oldFsPath, newFsPath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') throw new DocError('文件不存在', 404);
    if (code === 'EACCES' || code === 'EPERM') throw new DocError('没有写入权限', 403);
    throw new DocError(`改名失败：${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
