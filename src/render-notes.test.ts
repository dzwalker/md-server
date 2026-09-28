import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render.js';

describe('笔记行渲染（> note: 内容）', () => {
  it('渲染成笔记卡片：卡片标记 + 行号 + 原始正文', () => {
    const { html } = renderMarkdown('# 标题\n\n正文\n\n> note: 这是**重点**\n');
    expect(html).toContain('class="md-note"');
    expect(html).toContain('data-note-line="5"');
    expect(html).toContain('data-note-raw="这是**重点**"');
    expect(html).toContain('class="md-note-label">笔记<');
    // 正文走与页面同一套行内 md 渲染
    expect(html).toContain('<div class="md-note-body">这是<strong>重点</strong>');
  });

  it('紧跟段落（中间不空行）也能识别，且不吃掉后面的正文', () => {
    const { html } = renderMarkdown('第一段\n> note: 批注\n第二段\n');
    expect(html).toContain('data-note-line="2"');
    expect(html).toContain('class="md-note-body">批注');
    expect(html).toContain('data-line-start="1" data-line-end="1">第一段</p>');
    expect(html).toContain('data-line-start="3" data-line-end="3">第二段</p>');
  });

  it('原始正文里的引号 / & 会被转义，前端取回的是原文', () => {
    const raw = '他说 "引用" & <tag>';
    const { html } = renderMarkdown(`> note: ${raw}\n`);
    const m = /data-note-raw="([^"]*)"/.exec(html);
    expect(m).not.toBeNull();
    const decoded = (m as RegExpExecArray)[1]
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    expect(decoded).toBe(raw);
  });

  it('不误伤普通引用块与 `> notes:`', () => {
    const a = renderMarkdown('> 普通引用\n').html;
    expect(a).toContain('<blockquote data-line-start="1" data-line-end="1">');
    expect(a).not.toContain('md-note');
    const b = renderMarkdown('> notes: 复数不是笔记\n').html;
    expect(b).toContain('<blockquote ');
    expect(b).not.toContain('class="md-note"');
  });

  it('四空格缩进的 > note: 是代码块，不当作笔记', () => {
    const { html } = renderMarkdown('    > note: 这是代码\n');
    expect(html).toContain('<pre data-line-start="1" data-line-end="1">');
    expect(html).not.toContain('class="md-note"');
  });
});

describe('块级行号锚点（右键插入定位用）', () => {
  it('段落 / 标题 / 列表 / 表格 / 引用都带上首末行号', () => {
    const src = [
      '# 标题', // 1
      '', // 2
      '段落一', // 3
      '段落一续行', // 4
      '',
      '- a', // 6
      '- b', // 7
      '',
      '| x | y |', // 9
      '| - | - |', // 10
      '| 1 | 2 |', // 11
      '',
      '> 引用', // 13
      '',
    ].join('\n');
    const { html } = renderMarkdown(src);
    expect(html).toContain('data-line-start="1" data-line-end="1"'); // h1
    expect(html).toContain('data-line-start="3" data-line-end="4"'); // 段落
    // markdown-it 的列表 block 覆盖到分隔空行（第 8 行），插到它之后落点仍在列表下方
    expect(html).toContain('data-line-start="6" data-line-end="8"'); // 列表
    expect(html).toContain('data-line-start="9" data-line-end="11"'); // 表格
    expect(html).toContain('data-line-start="13" data-line-end="13"'); // 引用
  });

  it('笔记卡片自己带行号（可作为「插在这条笔记之后」的锚点）', () => {
    const { html } = renderMarkdown('a\n\n> note: x\n\nb\n');
    expect(html).toContain('data-note-line="3"');
    expect(html).toContain('data-line-start="3" data-line-end="3"');
  });
});
