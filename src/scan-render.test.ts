import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// 在加载 scanner/config 之前准备好临时文档空间并设置 MD_BASE_DIR + MD_SETS：
// config.ts 在模块加载时读取环境变量，因此这里必须先设环境再动态 import。
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-server-test-'));
fs.mkdirSync(path.join(tmpRoot, 't', 'sub'), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, 't', 'hello.md'), '# Hello\n\n正文 **bold**\n');
process.env.MD_BASE_DIR = tmpRoot;
process.env.MD_SETS = JSON.stringify([{ id: 't', name: 't', dirs: ['t'] }]);
process.env.MD_SETS_FILE = path.join(tmpRoot, 'sets.json'); // 不存在的文件，确保 MD_SETS 生效

const { scanAll } = await import('./scanner.js');
const { renderMarkdown } = await import('./render.js');

afterAll(() => {
  delete process.env.MD_BASE_DIR;
  delete process.env.MD_SETS;
  delete process.env.MD_SETS_FILE;
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
