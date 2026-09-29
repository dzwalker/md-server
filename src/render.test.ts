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

// 背景：CommonMark 的 left/right-flanking 规则假设词与标点间有空格，中文里没有空格，
// 导致 `**"中文"**中文`、`汉字**（括号）**汉字` 这类写法退化成字面 `**`（commonmark-spec#650）。
// md-server 采用 opt-in 的 CJK-friendly 修订草案（markdown-it-cjk-friendly）修正。
describe('CJK-friendly 强调', () => {
  it('收尾 ** 后紧跟汉字：引号包住的强调能闭合', () => {
    const { html } = renderMarkdown('**"方差越小 → 权重越大"**这句话，写成矩阵形式就是"对角元取倒数"。');
    expect(html).toContain('<strong>&quot;方差越小 → 权重越大&quot;</strong>这句话');
    expect(html).not.toContain('**');
  });

  it('收尾 ** 前是全角右括号、后紧跟汉字', () => {
    const { html } = renderMarkdown('这个想法在**M2 的占据栅格图（occupancy grid map）**里会详细讲；');
    expect(html).toContain('<strong>M2 的占据栅格图（occupancy grid map）</strong>里会详细讲');
  });

  it('起始 ** 后紧跟引号、前是汉字', () => {
    const { html } = renderMarkdown('反过来看**"自由"那一支**，就会看到病灶：');
    expect(html).toContain('<strong>&quot;自由&quot;那一支</strong>，就会看到病灶');
  });

  it('韩文：收尾 * 前是右括号、后紧跟韩文', () => {
    const { html } = renderMarkdown('*스크립트(script)*라고');
    expect(html).toContain('<em>스크립트(script)</em>라고');
  });

  it('非 CJK 场景保持 CommonMark 原样（不加粗的仍不加粗）', () => {
    // 纯英文标点相邻，规范判定就是「不是强调」，不能被插件放宽
    expect(renderMarkdown('a**.test.**b').html).toContain('a**.test.**b');
    expect(renderMarkdown('The cat is called **"Nodoka"**.').html).toContain(
      '<strong>“Nodoka”</strong>.',
    );
    expect(renderMarkdown('**bold**text').html).toContain('<strong>bold</strong>text');
  });

  it('行内代码与代码块里的 ** 原样保留', () => {
    expect(renderMarkdown('`**not emph**`').html).toContain('<code>**not emph**</code>');
    expect(renderMarkdown('```\n**literal**中文\n```').html).toContain('**literal**中文');
  });
});

// 右侧「目录」直接用 headings[].text 渲染。此前 text 是「渲染后的标题 HTML 去标签」，
// 于是 markdown-it 转义的实体（" → &quot;）原样怼到界面上，公式也退化成裸 LaTeX。
describe('TOC 标题提取', () => {
  it('实体解码：未配对的引号/与号/尖括号还原成字符', () => {
    const { headings } = renderMarkdown('# 分辨率 5" 屏幕 &amp; <尖括号>');
    expect(headings[0].text).toBe('分辨率 5" 屏幕 & <尖括号>');
  });

  it('成对的直引号由 typographer 变弯引号（与正文一致，不是 &quot;）', () => {
    const { headings } = renderMarkdown('# 标题 "引号"');
    expect(headings[0].text).toBe('标题 “引号”');
  });

  it('源码里字面写的实体保持字面（与正文一致）', () => {
    const { headings } = renderMarkdown('# 转义 &amp;quot; 与 &amp;amp;');
    expect(headings[0].text).toBe('转义 &quot; 与 &amp;');
  });

  it('行内标记（加粗/代码/链接）退化为纯文本，且不带 parts', () => {
    const { headings } = renderMarkdown('# 中文 **加粗** 与 `代码` 与 [链接](http://x)');
    expect(headings[0].text).toBe('中文 加粗 与 代码 与 链接');
    expect(headings[0].parts).toBeUndefined();
  });

  it('行内公式拆成 parts，供目录里用 KaTeX 渲染', () => {
    const { headings } = renderMarkdown('## 公式 $E=mc^2$ 与 $a<b$ 结束');
    expect(headings[0].text).toBe('公式 E=mc^2 与 a<b 结束');
    expect(headings[0].parts).toEqual([
      { type: 'text', value: '公式 ' },
      { type: 'math', value: 'E=mc^2' },
      { type: 'text', value: ' 与 ' },
      { type: 'math', value: 'a<b' },
      { type: 'text', value: ' 结束' },
    ]);
  });

  it('标题以公式开头/结尾时不留空文本片段', () => {
    const { headings } = renderMarkdown('# $x^2$');
    expect(headings[0].parts).toEqual([{ type: 'math', value: 'x^2' }]);
    // 顺带：纯公式标题过去 slug 为空 → id=""，在目录里直接消失；现在要有可用 id
    expect(headings[0].id).toBe('x2');
  });

  it('公式片段与正文同源：只解一层实体，和正文 span 的文本一致', () => {
    const { html, headings } = renderMarkdown('# $a &lt; b$');
    expect(html).toContain('<span class="katex-math">a &amp;lt; b</span>');
    expect(headings[0].parts).toEqual([{ type: 'math', value: 'a &lt; b' }]);
  });

  it('$$ 公式（行内位置的 math_block）也进 parts', () => {
    const { headings } = renderMarkdown('# $$\\frac{a}{b}$$');
    expect(headings[0].parts).toEqual([{ type: 'math', value: '\\frac{a}{b}' }]);
  });
});
