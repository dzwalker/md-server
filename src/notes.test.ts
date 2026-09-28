import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyNoteOp,
  applyNoteToFile,
  buildNoteLine,
  deleteNote,
  insertNote,
  isNoteLine,
  NoteError,
  noteTextOf,
  normalizeNoteText,
  toNoteOpInput,
  updateNote,
} from './notes.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-server-notes-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function writeTmp(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

describe('笔记行识别', () => {
  it('识别标准写法与紧凑写法', () => {
    expect(isNoteLine('> note: 内容')).toBe(true);
    expect(isNoteLine('>note:内容')).toBe(true);
    expect(isNoteLine('> Note: 内容')).toBe(true);
    expect(isNoteLine('  > note: 最多三空格缩进')).toBe(true);
    expect(isNoteLine('> note:')).toBe(true);
  });

  it('不误伤普通引用块与四空格缩进（代码块）', () => {
    expect(isNoteLine('> notes: 复数不是笔记')).toBe(false);
    expect(isNoteLine('> 普通引用')).toBe(false);
    expect(isNoteLine('    > note: 四空格是代码块')).toBe(false);
    expect(isNoteLine('正文里提到 > note: 不算')).toBe(false);
  });

  it('取正文时去掉前缀', () => {
    expect(noteTextOf('> note:  前后有空格  ')).toBe(' 前后有空格  ');
    expect(noteTextOf('> 普通引用')).toBeNull();
  });
});

describe('笔记文本规范化', () => {
  it('单行语法：换行折叠成空格', () => {
    expect(normalizeNoteText('第一行\n第二行')).toBe('第一行 第二行');
    expect(buildNoteLine('  a\n\n b  ')).toBe('> note: a b');
  });

  it('空内容被拒绝', () => {
    expect(() => insertNote('a\n', 1, '   ')).toThrow(NoteError);
  });
});

describe('插入笔记', () => {
  it('插在指定行之后（就在下一行，不加空行）', () => {
    const r = insertNote('# 标题\n\n正文\n\n结尾\n', 3, '批注');
    expect(r.line).toBe(4);
    expect(r.content).toBe('# 标题\n\n正文\n> note: 批注\n\n结尾\n');
  });

  it('afterLine=0 插到最前，afterLine=总行数 追加到文末', () => {
    expect(insertNote('a\nb\n', 0, 'x').content).toBe('> note: x\na\nb\n');
    expect(insertNote('a\nb\n', 2, 'x').content).toBe('a\nb\n> note: x\n');
  });

  it('保持 CRLF 与「无末尾换行」', () => {
    expect(insertNote('a\r\nb\r\n', 1, 'x').content).toBe('a\r\n> note: x\r\nb\r\n');
    expect(insertNote('a\nb', 1, 'x').content).toBe('a\n> note: x\nb');
    expect(insertNote('', 0, 'x').content).toBe('> note: x');
  });

  it('行号越界报 409', () => {
    try {
      insertNote('a\n', 9, 'x');
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(NoteError);
      expect((e as NoteError).status).toBe(409);
    }
  });
});

describe('改写 / 删除笔记', () => {
  it('改写保留原有前缀写法', () => {
    const r = updateNote('a\n  > note:  旧\nb\n', 2, '新');
    // 前缀（缩进 + `note:`）逐字保留，正文被规范化成新内容
    expect(r.content).toBe('a\n  > note: 新\nb\n');
    expect(r.line).toBe(2);
  });

  it('目标行不是笔记行 → 409（不误改正文）', () => {
    expect(() => updateNote('a\n正文\n', 2, 'x')).toThrowError(/不是笔记行/);
    expect(() => deleteNote('a\n> 普通引用\n', 2)).toThrowError(/不是笔记行/);
    expect(() => updateNote('a\n', 5, 'x')).toThrowError(/不存在/);
  });

  it('删除只删那一行', () => {
    expect(deleteNote('a\n> note: 批注\nb\n', 2).content).toBe('a\nb\n');
    // 删掉全文唯一一行 → 空文件（不留悬空换行）
    expect(deleteNote('> note: x\n', 1).content).toBe('');
  });

  it('applyNoteOp 分发与非法 op', () => {
    expect(applyNoteOp('a\n', { op: 'insert', afterLine: 1, text: 'x' }).content).toBe('a\n> note: x\n');
    expect(applyNoteOp('> note: x\n', { op: 'delete', line: 1 }).content).toBe('');
    expect(() => applyNoteOp('a\n', { op: 'nope' as never, line: 1 })).toThrowError(/不支持的 op/);
    expect(() => applyNoteOp('a\n', { op: 'update', text: 'x' })).toThrowError(/行号/);
  });
});

describe('落盘 applyNoteToFile', () => {
  it('插入后磁盘上真的多了一行，且其它内容逐字不变', () => {
    const p = writeTmp('insert.md', '# 标题\n\n正文\n');
    const r = applyNoteToFile(p, { op: 'insert', afterLine: 3, text: '这是一条**笔记**' });
    expect(r.line).toBe(4);
    expect(fs.readFileSync(p, 'utf8')).toBe('# 标题\n\n正文\n> note: 这是一条**笔记**\n');
    expect(r.mtimeMs).toBeGreaterThan(0);
  });

  it('CRLF 文件写回后仍是 CRLF', () => {
    const p = writeTmp('crlf.md', '# t\r\n\r\nbody\r\n');
    applyNoteToFile(p, { op: 'insert', afterLine: 3, text: 'x' });
    const raw = fs.readFileSync(p, 'utf8');
    expect(raw).toBe('# t\r\n\r\nbody\r\n> note: x\r\n');
    expect(raw.includes('\n\n\n')).toBe(false);
  });

  it('mtime 乐观锁：对得上才写，对不上 409 且文件不动', () => {
    const p = writeTmp('lock.md', 'a\n');
    const { mtimeMs } = fs.statSync(p);
    applyNoteToFile(p, { op: 'insert', afterLine: 1, text: 'ok', expectMtimeMs: mtimeMs });
    const after = fs.readFileSync(p, 'utf8');
    try {
      applyNoteToFile(p, { op: 'insert', afterLine: 1, text: 'stale', expectMtimeMs: 1 });
      throw new Error('should throw');
    } catch (e) {
      expect((e as NoteError).status).toBe(409);
    }
    expect(fs.readFileSync(p, 'utf8')).toBe(after);
  });

  // 回归：路由以前把线路上的 mtimeMs 原样传进业务层，乐观锁因此静默失效（外部改动被覆盖）。
  it('HTTP 字段 mtimeMs 会被归一化成乐观锁', () => {
    expect(toNoteOpInput({ op: 'insert', mtimeMs: 123 }).expectMtimeMs).toBe(123);
    expect(toNoteOpInput({ op: 'insert' }).expectMtimeMs).toBeUndefined();
    expect(toNoteOpInput(undefined).expectMtimeMs).toBeUndefined();

    const p = writeTmp('lock-wire.md', 'a\n');
    const stale = 1;
    expect(() => applyNoteToFile(p, toNoteOpInput({ op: 'insert', afterLine: 1, text: 'x', mtimeMs: stale }))).toThrowError(/外部修改/);
    const fresh = fs.statSync(p).mtimeMs;
    applyNoteToFile(p, toNoteOpInput({ op: 'insert', afterLine: 1, text: 'y', mtimeMs: fresh }));
    expect(fs.readFileSync(p, 'utf8')).toBe('a\n> note: y\n');
  });

  it('只允许 md 文件；文件不存在 404', () => {
    const txt = writeTmp('note.txt', 'a\n');
    expect(() => applyNoteToFile(txt, { op: 'insert', afterLine: 1, text: 'x' })).toThrowError(/只允许/);
    expect(() => applyNoteToFile(path.join(tmpDir, 'nope.md'), { op: 'insert', afterLine: 0, text: 'x' })).toThrowError(/不存在/);
  });

  it('不改写正文：update 打在正文行上会被拒绝，文件保持原样', () => {
    const p = writeTmp('guard.md', '# 标题\n正文\n');
    expect(() => applyNoteToFile(p, { op: 'update', line: 2, text: 'x' })).toThrowError(/不是笔记行/);
    expect(fs.readFileSync(p, 'utf8')).toBe('# 标题\n正文\n');
  });
});
