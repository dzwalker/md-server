import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// 在加载 scanner/config 之前准备好临时文档空间并设置 MD_ROOTS：
// config.ts 在模块加载时读取环境变量，因此这里必须先设环境再动态 import。
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-server-test-'));
fs.mkdirSync(path.join(tmpRoot, 'sub'));
fs.writeFileSync(path.join(tmpRoot, 'hello.md'), '# Hello\n\n正文 **bold**\n');
process.env.MD_ROOTS = JSON.stringify([{ url: '/t', dir: tmpRoot }]);
process.env.MD_ROOTS_FILE = path.join(tmpRoot, 'roots.json'); // 不存在的文件，确保 MD_ROOTS 生效

const { scanAll } = await import('./scanner.js');
const { renderMarkdown } = await import('./render.js');

afterAll(() => {
  delete process.env.MD_ROOTS;
  delete process.env.MD_ROOTS_FILE;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('scanAll + renderMarkdown 端到端冒烟', () => {
  it('扫描临时目录并渲染一篇 markdown', () => {
    const files = scanAll();
    expect(files).toHaveLength(1);
    expect(files[0].title).toBe('Hello');
    expect(files[0].urlPath).toBe('/t/hello.md');

    const { html, headings } = renderMarkdown(fs.readFileSync(files[0].fsPath, 'utf8'), files[0].dir);
    expect(headings).toEqual([{ level: 1, text: 'Hello', id: 'hello' }]);
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
  });
});
