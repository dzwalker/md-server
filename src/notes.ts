import fs from 'node:fs';

/**
 * 笔记行（`> note: 内容`）。
 *
 * 约定：一条笔记 = md 文件里的**独立一行**，形如 `> note: 内容`（内容支持行内 markdown：
 * 加粗、[[双链]]、$公式$ 等，与正文同一套渲染规则）。它借用 Markdown 引用块语法，
 * 因此在别的编辑器（Typora / GitHub / Obsidian）里也能正常显示成引用块，不需要专有格式。
 *
 * 分层：本模块承担「笔记行」的全部业务——字符串增删改 + 单文件落盘；
 * `index.ts` 的 `/api/notes` 路由只做参数解析与错误码映射。
 */

/** 笔记行正则：行首最多 3 个空格（与 CommonMark blockquote 的缩进规则一致）。 */
export const NOTE_LINE_RE = /^ {0,3}> ?note:[ \t]?(.*)$/i;

/** HTTP 状态码携带的业务错误：路由把它翻译成响应码与 message。 */
export class NoteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'NoteError';
    this.status = status;
  }
}

export type NoteOp = 'insert' | 'update' | 'delete';

export interface NoteOpInput {
  /** 文档 urlPath（如 /personal/notes/a.md），仅路由层使用。 */
  path?: string;
  op: NoteOp;
  /** insert：插在该行之后（1-based；0 = 插到文件最前面；= 总行数 = 追加到文末）。 */
  afterLine?: number;
  /** update / delete：目标笔记行的行号（1-based）。 */
  line?: number;
  text?: string;
  /** 乐观锁：客户端渲染这份正文时看到的 mtimeMs，与磁盘不一致则拒绝写入。 */
  expectMtimeMs?: number;
  /** 线路（HTTP）字段：与 expectMtimeMs 同义，进业务前由 toNoteOpInput 归一化。 */
  mtimeMs?: number;
}

/** 把 HTTP 字段归一化成业务入参（`mtimeMs` → `expectMtimeMs`）。 */
export function toNoteOpInput(body: unknown): NoteOpInput {
  const b = (body || {}) as NoteOpInput;
  return {
    ...b,
    expectMtimeMs: typeof b.mtimeMs === 'number' ? b.mtimeMs : b.expectMtimeMs,
  };
}

export interface NoteOpResult {
  /** insert/update = 笔记行行号；delete = 被删掉的行号。 */
  line: number;
  mtimeMs: number;
  size: number;
}

export function isNoteLine(line: string): boolean {
  return NOTE_LINE_RE.test(line);
}

/** 取笔记正文（去掉 `> note:` 前缀）；非笔记行返回 null。 */
export function noteTextOf(line: string): string | null {
  const m = NOTE_LINE_RE.exec(line);
  return m ? m[1] : null;
}

/**
 * 组装一行笔记。内容里的换行折叠成空格——笔记是**单行**语法，
 * 不允许把一行拆成多行（否则会破坏「一条笔记 = 一行」的可编辑性）。
 */
export function buildNoteLine(text: string): string {
  return '> note: ' + normalizeNoteText(text);
}

export function normalizeNoteText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 用新正文替换笔记行，保留原有的前缀写法（缩进、`note:` 前后空格）。 */
export function replaceNoteText(line: string, text: string): string {
  const m = NOTE_LINE_RE.exec(line);
  if (!m) throw new NoteError('目标行不是笔记行', 409);
  const prefix = line.slice(0, line.length - m[1].length);
  return prefix + normalizeNoteText(text);
}

interface SplitContent {
  lines: string[];
  eol: string;
  endsWithEol: boolean;
}

/** 拆行：记录原文件的换行风格与末尾换行，写回时逐字保持（避免整篇 diff 噪音）。 */
export function splitLines(content: string): SplitContent {
  if (content === '') return { lines: [], eol: '\n', endsWithEol: false };
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const endsWithEol = /\r?\n$/.test(content);
  const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (endsWithEol) lines.pop();
  return { lines, eol, endsWithEol };
}

export function joinLines(parts: SplitContent): string {
  if (!parts.lines.length) return '';
  return parts.lines.join(parts.eol) + (parts.endsWithEol ? parts.eol : '');
}

function requireText(text: unknown): string {
  const t = normalizeNoteText(String(text ?? ''));
  if (!t) throw new NoteError('笔记内容不能为空', 400);
  return t;
}

/** 在 afterLine 之后插入一行笔记。 */
export function insertNote(content: string, afterLine: number, text: string): { content: string; line: number } {
  const parts = splitLines(content);
  const total = parts.lines.length;
  if (!Number.isInteger(afterLine) || afterLine < 0 || afterLine > total) {
    throw new NoteError(`插入位置超出范围（文件共 ${total} 行）`, 409);
  }
  const noteLine = buildNoteLine(requireText(text));
  parts.lines.splice(afterLine, 0, noteLine);
  return { content: joinLines(parts), line: afterLine + 1 };
}

/** 改写第 line 行的笔记正文。 */
export function updateNote(content: string, line: number, text: string): { content: string; line: number } {
  const parts = splitLines(content);
  const cur = parts.lines[line - 1];
  if (cur === undefined) throw new NoteError('笔记不存在（文件可能已被外部修改）', 409);
  if (!isNoteLine(cur)) throw new NoteError('目标行不是笔记行（文件可能已被外部修改）', 409);
  parts.lines[line - 1] = replaceNoteText(cur, requireText(text));
  return { content: joinLines(parts), line };
}

/** 删除第 line 行的笔记。 */
export function deleteNote(content: string, line: number): { content: string; line: number } {
  const parts = splitLines(content);
  const cur = parts.lines[line - 1];
  if (cur === undefined) throw new NoteError('笔记不存在（文件可能已被外部修改）', 409);
  if (!isNoteLine(cur)) throw new NoteError('目标行不是笔记行（文件可能已被外部修改）', 409);
  parts.lines.splice(line - 1, 1);
  return { content: joinLines(parts), line };
}

/** 按 op 分发到纯函数（便于单测）。 */
export function applyNoteOp(content: string, input: NoteOpInput): { content: string; line: number } {
  const text = input.text;
  if (input.op === 'insert') {
    return insertNote(content, Number(input.afterLine), String(text ?? ''));
  }
  const line = Number(input.line);
  if (!Number.isInteger(line) || line < 1) throw new NoteError('缺少合法的行号 line', 400);
  if (input.op === 'update') return updateNote(content, line, String(text ?? ''));
  if (input.op === 'delete') return deleteNote(content, line);
  throw new NoteError(`不支持的 op：${String(input.op)}`, 400);
}

/** 仅允许 md 文件被写。 */
function assertWritable(fsPath: string) {
  if (!/\.(md|markdown)$/i.test(fsPath)) throw new NoteError('只允许对 .md 文件写笔记', 400);
  let st: fs.Stats;
  try {
    st = fs.statSync(fsPath);
  } catch {
    throw new NoteError('文件不存在', 404);
  }
  if (!st.isFile()) throw new NoteError('目标不是文件', 400);
  return st;
}

/**
 * 落盘：读原文 → 改笔记行 → 临时文件 + rename 原子替换。
 * 只写这一条笔记涉及的行，其余内容逐字保持（含 CRLF、末尾换行）。
 *
 * **属主与权限必须显式搬过去**：临时文件是当前进程新建的，rename 会把它的
 * uid/gid/mode 一起变成新的文件身份。容器以 root 跑时，这里不做处理就会把
 * 用户 dev:dev 的 md 变成 root:root（用户那边的编辑器随即读写被拒）。
 */
export function applyNoteToFile(fsPath: string, input: NoteOpInput): NoteOpResult {
  const before = assertWritable(fsPath);
  // 客户端 mtime 只在显式传入时校验：并发编辑检测，避免覆盖别处的改动。
  if (typeof input.expectMtimeMs === 'number' && input.expectMtimeMs > 0) {
    if (Math.abs(before.mtimeMs - input.expectMtimeMs) > 0.5) {
      throw new NoteError('文件已被外部修改，请刷新后再编辑', 409);
    }
  }

  const raw = fs.readFileSync(fsPath, 'utf8');
  const { content: next, line } = applyNoteOp(raw, input);
  if (next === raw) {
    const st = fs.statSync(fsPath);
    return { line, mtimeMs: st.mtimeMs, size: st.size };
  }

  const tmp = `${fsPath}.mdnote-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, next, 'utf8');
    // 新文件的属主默认是「当前进程」：与源文件不一致时必须显式改回去。
    // 进程身份已经等于源文件属主时（普通用户自托管运行）不必、也无法 chown。
    const sameOwner = currentUid() === before.uid && currentGid() === before.gid;
    if (!sameOwner) {
      try {
        fs.chownSync(tmp, before.uid, before.gid);
      } catch (e) {
        throw new NoteError(
          `无法保持文件属主（当前进程 ${currentUid()}:${currentGid()}，文件 ${before.uid}:${before.gid}）：` +
            `${e instanceof Error ? e.message : String(e)}。拒绝写入以免把文件变成别的属主。`,
          500,
        );
      }
    }
    fs.chmodSync(tmp, before.mode & 0o777);
    fs.renameSync(tmp, fsPath);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (e instanceof NoteError) throw e;
    throw new NoteError(`写入失败：${e instanceof Error ? e.message : String(e)}`, 500);
  }
  const after = fs.statSync(fsPath);
  return { line, mtimeMs: after.mtimeMs, size: after.size };
}

/** 当前进程的 uid/gid（Windows 上没有这两个 API，返回 -1 表示不参与属主比较）。 */
function currentUid(): number {
  return typeof process.getuid === 'function' ? process.getuid() : -1;
}
function currentGid(): number {
  return typeof process.getgid === 'function' ? process.getgid() : -1;
}
