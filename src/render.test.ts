import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render.js';

describe('renderMarkdown 冒烟', () => {
  it('提取标题并渲染 anchor', () => {
    const { html, headings } = renderMarkdown('# 你好世界\n\n正文内容');
    expect(headings).toEqual([{ level: 1, text: '你好世界', id: '你好世界' }]);
    expect(html).toContain('<h1');
    expect(html).toContain('你好世界');
  });

  it('代码块走 highlight.js 高亮', () => {
    const { html } = renderMarkdown('```js\nconst a = 1;\n```');
    expect(html).toContain('class="hljs"');
    expect(html).toContain('language-js');
  });

  it('任务列表渲染为 checkbox', () => {
    const { html } = renderMarkdown('- [ ] 待办项');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('待办项');
  });

  it('数学块渲染为 katex 占位', () => {
    const { html } = renderMarkdown('$$a^2 + b^2 = c^2$$');
    expect(html).toContain('katex-block');
    expect(html).toContain('a^2 + b^2 = c^2');
  });
});
