import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, saveDocImage } from './upload.js';
import { WriteError } from './file-write.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-server-upload-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function docFile(name = 'note.md'): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, '# 标题\n');
  return p;
}

function statusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(WriteError);
    return (e as WriteError).status;
  }
  throw new Error('should throw');
}

describe('图片上传 saveDocImage', () => {
  it('落到文档目录的 assets/ 并返回相对路径（markdown 里用它）', () => {
    const doc = docFile();
    const r = saveDocImage(doc, '/space/note.md', 'image/png', PNG, '截图 2026.png');
    expect(r.relPath.startsWith('assets/')).toBe(true);
    expect(r.relPath.endsWith('.png')).toBe(true);
    // 文件名只保留字母/数字/中文/_-，空格与特殊字符被折叠成 -
    expect(r.relPath).toMatch(/^assets\/截图-2026-\d{8}-\d{6}-[a-z0-9]+\.png$/);
    expect(r.urlPath).toBe('/space/' + r.relPath);
    const abs = path.join(tmpDir, r.relPath);
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs).equals(PNG)).toBe(true);
  });

  it('扩展名按 MIME 决定，不看文件名后缀', () => {
    const doc = docFile();
    const r = saveDocImage(doc, '/space/note.md', 'image/jpeg', PNG, 'evil.php');
    expect(r.relPath.endsWith('.jpg')).toBe(true);
    expect(r.relPath).not.toContain('.php');
  });

  it('不支持的 MIME 415；空数据 400；超大 413', () => {
    const doc = docFile();
    expect(statusOf(() => saveDocImage(doc, '/space/note.md', 'text/html', PNG))).toBe(415);
    expect(statusOf(() => saveDocImage(doc, '/space/note.md', 'image/png', Buffer.alloc(0)))).toBe(400);
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    expect(statusOf(() => saveDocImage(doc, '/space/note.md', 'image/png', big))).toBe(413);
  });

  it('文档不存在 404（不会在错误位置建目录）', () => {
    const sub = fs.mkdtempSync(path.join(tmpDir, 'empty-'));
    expect(statusOf(() => saveDocImage(path.join(sub, 'nope.md'), '/space/nope.md', 'image/png', PNG))).toBe(404);
    expect(fs.existsSync(path.join(sub, 'assets'))).toBe(false);
  });

  it('同名/同秒上传不覆盖：每次生成唯一文件名', () => {
    const doc = docFile('note2.md');
    const a = saveDocImage(doc, '/space/note2.md', 'image/png', PNG, 'same.png');
    const b = saveDocImage(doc, '/space/note2.md', 'image/png', PNG, 'same.png');
    expect(a.relPath).not.toBe(b.relPath);
    expect(fs.existsSync(path.join(tmpDir, 'assets', path.basename(a.relPath)))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'assets', path.basename(b.relPath)))).toBe(true);
  });
});
