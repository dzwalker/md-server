import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createDocFile,
  docFileName,
  MAX_DOC_BYTES,
  renameDocFile,
  saveDocFile,
  stripDocExt,
  validateDocBaseName,
} from './docs.js';
import { WriteError } from './file-write.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-server-docs-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

let seq = 0;
function writeTmp(content: string, name = `doc-${seq++}.md`): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function statusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    // 文件级错误（不存在/权限）由共用底座 file-write.ts 抛 WriteError，业务错误是它的子类 DocError。
    expect(e).toBeInstanceOf(WriteError);
    return (e as WriteError).status;
  }
  throw new Error('should throw');
}

describe('文件名规则（validateDocBaseName）', () => {
  it('规整：去首尾空白、去掉一层 md 扩展名', () => {
    expect(validateDocBaseName('  周报 2026  ')).toBe('周报 2026');
    expect(validateDocBaseName('周报.md')).toBe('周报');
    expect(validateDocBaseName('a.MARKDOWN')).toBe('a');
    expect(stripDocExt('x.md')).toBe('x');
    expect(docFileName('周报')).toBe('周报.md');
    expect(docFileName('周报.md')).toBe('周报.md');
  });

  it('非法名字一律 400 且带上可读原因', () => {
    expect(() => validateDocBaseName('')).toThrowError(/不能为空/);
    expect(() => validateDocBaseName('   ')).toThrowError(/不能为空/);
    expect(() => validateDocBaseName('.hidden')).toThrowError(/不能以 \. 开头/);
    expect(() => validateDocBaseName('a/b')).toThrowError(/不能包含/);
    expect(() => validateDocBaseName('a\\b')).toThrowError(/不能包含/);
    expect(() => validateDocBaseName('a:b')).toThrowError(/不能包含/);
    expect(() => validateDocBaseName('..')).toThrowError(/不合法/);
    expect(() => validateDocBaseName('名.')).toThrowError(/不能以 \. 结尾/);
    expect(() => validateDocBaseName('长'.repeat(121))).toThrowError(/过长/);
  });
});

describe('整篇保存 saveDocFile', () => {
  it('逐字保真：CRLF、无末尾换行、缩进都按提交内容落盘', () => {
    const p = writeTmp('# t\r\n\r\n正文\r\n');
    saveDocFile(p, '# t\r\n\r\n正文改了\r\n   缩进代码\r\n');
    expect(fs.readFileSync(p, 'utf8')).toBe('# t\r\n\r\n正文改了\r\n   缩进代码\r\n');

    const q = writeTmp('a\nb');
    saveDocFile(q, 'a\nb\nc');
    expect(fs.readFileSync(q, 'utf8')).toBe('a\nb\nc');
  });

  it('内容没变时不重写（mtime 不动）', () => {
    const p = writeTmp('# 原文\n');
    const before = fs.statSync(p);
    const r = saveDocFile(p, '# 原文\n', before.mtimeMs);
    expect(r.mtimeMs).toBe(before.mtimeMs);
    expect(r.size).toBe(before.size);
  });

  it('mtime 乐观锁：对不上 409，磁盘内容不动', () => {
    const p = writeTmp('原始\n');
    const stale = 1;
    expect(statusOf(() => saveDocFile(p, '覆盖\n', stale))).toBe(409);
    expect(fs.readFileSync(p, 'utf8')).toBe('原始\n');
  });

  it('属主 / 属组 / 权限位与写前一致（容器 root 跑时不能把用户文件变成 root:root）', () => {
    const p = writeTmp('# t\n\n正文\n');
    fs.chmodSync(p, 0o640);
    const before = fs.statSync(p);
    saveDocFile(p, '# t\n\n正文（已编辑）\n');
    const after = fs.statSync(p);
    expect(after.uid).toBe(before.uid);
    expect(after.gid).toBe(before.gid);
    expect(after.mode & 0o777).toBe(0o640);
    expect(fs.readFileSync(p, 'utf8')).toBe('# t\n\n正文（已编辑）\n');
  });

  it('目录里不留临时文件', () => {
    const p = writeTmp('a\n');
    saveDocFile(p, 'b\n');
    expect(fs.readdirSync(tmpDir).filter((f) => f.includes('.mddoc-'))).toEqual([]);
  });

  it('只允许 .md；不存在 404；超大 413', () => {
    const txt = path.join(tmpDir, 'x.txt');
    fs.writeFileSync(txt, 'a');
    expect(statusOf(() => saveDocFile(txt, 'b'))).toBe(400);
    expect(statusOf(() => saveDocFile(path.join(tmpDir, 'nope.md'), 'b'))).toBe(404);

    const p = writeTmp('a\n');
    const huge = 'x'.repeat(MAX_DOC_BYTES + 1);
    expect(statusOf(() => saveDocFile(p, huge))).toBe(413);
    expect(fs.readFileSync(p, 'utf8')).toBe('a\n');
  });
});

describe('新建 createDocFile', () => {
  it('创建空文件并返回大小', () => {
    const p = path.join(tmpDir, 'new-empty.md');
    const r = createDocFile(p);
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, 'utf8')).toBe('');
    expect(r.size).toBe(0);
    expect(r.mtimeMs).toBeGreaterThan(0);
  });

  it('同名已存在 409，且不覆盖原内容', () => {
    const p = writeTmp('原有内容\n', 'exists.md');
    expect(statusOf(() => createDocFile(p))).toBe(409);
    expect(fs.readFileSync(p, 'utf8')).toBe('原有内容\n');
  });

  it('目录不存在 404；非 md 400', () => {
    expect(statusOf(() => createDocFile(path.join(tmpDir, 'no-dir', 'a.md')))).toBe(404);
    expect(statusOf(() => createDocFile(path.join(tmpDir, 'a.txt')))).toBe(400);
  });
});

describe('改名 renameDocFile', () => {
  it('同目录改名：旧路径消失、内容与身份不变', () => {
    const old = writeTmp('内容\n', 'old-name.md');
    fs.chmodSync(old, 0o644);
    const before = fs.statSync(old);
    const neu = path.join(tmpDir, 'new-name.md');
    renameDocFile(old, neu);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.readFileSync(neu, 'utf8')).toBe('内容\n');
    const after = fs.statSync(neu);
    expect(after.uid).toBe(before.uid);
    expect(after.gid).toBe(before.gid);
    expect(after.mode & 0o777).toBe(0o644);
  });

  it('目标已存在 409（不静默覆盖）', () => {
    const a = writeTmp('A\n', 'r-a.md');
    const b = writeTmp('B\n', 'r-b.md');
    expect(statusOf(() => renameDocFile(a, b))).toBe(409);
    expect(fs.readFileSync(b, 'utf8')).toBe('B\n');
    expect(fs.existsSync(a)).toBe(true);
  });

  it('跨目录 400；非 md 400；源不存在 404', () => {
    const a = writeTmp('A\n', 'm-a.md');
    const sub = fs.mkdtempSync(path.join(tmpDir, 'sub-'));
    expect(statusOf(() => renameDocFile(a, path.join(sub, 'm-a.md')))).toBe(400);
    expect(statusOf(() => renameDocFile(a, path.join(tmpDir, 'm-a.txt')))).toBe(400);
    expect(statusOf(() => renameDocFile(path.join(tmpDir, 'missing.md'), path.join(tmpDir, 'z.md')))).toBe(404);
  });

  it('改名到同名是空操作', () => {
    const a = writeTmp('A\n', 'same.md');
    renameDocFile(a, a);
    expect(fs.readFileSync(a, 'utf8')).toBe('A\n');
  });
});
