import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render.js';

// 文档顶部 YAML frontmatter（`---\n...\n---`）渲染成默认收起的「文档信息」折叠块。
// 以前 markdown-it 会把结尾的 `---` 当 Setext 下划线，把整块 frontmatter 变成 <h2> 混进目录。
describe('顶部 frontmatter 折叠块', () => {
  const doc = [
    '---',
    'title: E2E 标题',
    'date: 2026-10-08',
    'type: 主文档',
    'evidence: 见 https://example.com/x 与 **重点**',
    '---',
    '',
    '# 正文标题',
    '',
    '正文。',
  ].join('\n');

  it('渲染成 <details>，且默认不带 open（收起）', () => {
    const { html } = renderMarkdown(doc);
    expect(html).toContain('<details class="md-frontmatter">');
    expect(html).toMatch(/<details class="md-frontmatter">\s*<summary/);
    // 不出现打开属性
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('不再把整块 YAML 渲染成 <h2>，目录里也没有它', () => {
    const { html, headings } = renderMarkdown(doc);
    expect(html).not.toContain('<h2');
    expect(headings.map((h) => h.text)).toEqual(['正文标题']);
  });

  it('key/value 逐条渲染；日期只显示日期；值支持行内 markdown', () => {
    const { html } = renderMarkdown(doc);
    expect(html).toContain('<dt>title</dt>');
    expect(html).toContain('<dd>E2E 标题</dd>');
    // date 被 gray-matter 解析成 Date：只留 YYYY-MM-DD
    expect(html).toContain('<dd>2026-10-08</dd>');
    // evidence 里的链接与加粗在折叠区里也生效
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('<strong>重点</strong>');
  });

  it('只消费不删行：frontmatter 之后的块行号锚点仍然正确', () => {
    const { html } = renderMarkdown(doc);
    // frontmatter 占 1~6 行（含首尾分隔线），正文标题在第 8 行 → 行号未因消费 frontmatter 而偏移
    expect(html).toContain('<h1 id="正文标题" tabindex="-1" data-line-start="8" data-line-end="8">');
    // frontmatter 自身不带行号锚点（不是笔记块的定位目标）
    expect(html).not.toMatch(/<details[^>]*data-line-end/);
  });

  it('没有闭合分隔线时不算 frontmatter，交回默认渲染（<hr>）', () => {
    const { html } = renderMarkdown('---\n\n正文');
    expect(html).toContain('<hr');
    expect(html).not.toContain('md-frontmatter');
  });

  it('文档开头不是 --- 时不受影响（Setext 标题照常）', () => {
    const { html } = renderMarkdown('普通段落\n---\n');
    expect(html).not.toContain('md-frontmatter');
    expect(html).toContain('<h2');
  });
});

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

// 正文里指向本地「非 md 文件」的相对链接（互动 HTML / PDF / CSV…）：
// 因 SPA 把地址栏重写成 /set/<id>，相对 href 会被浏览器按错误基址解析 → 被重定向回默认空间。
// 服务端按文档目录改写为绝对 /api/asset 路径（与图片一致），浏览器即可正确内联打开。
describe('正文本地资源链接改写', () => {
  const base = '/learning-ad/concepts';

  it('相对非 md 资源 → 绝对 /api/asset（基于文档目录）', () => {
    const { html } = renderMarkdown('[互动页](interactive/derivative-interactive.html)', base);
    expect(html).toContain('href="/api/asset/learning-ad/concepts/interactive/derivative-interactive.html"');
  });

  it('../ 上跳也按文档目录规范化', () => {
    const { html } = renderMarkdown('[图](../images/a.png)', base);
    expect(html).toContain('href="/api/asset/learning-ad/images/a.png"');
  });

  it('保留 query / #锚点', () => {
    const { html } = renderMarkdown('[页](interactive/x.html#sec-1)', base);
    expect(html).toContain('href="/api/asset/learning-ad/concepts/interactive/x.html#sec-1"');
  });

  it('脚本源码等文本类型同样可点开', () => {
    const { html } = renderMarkdown('[脚本](interactive/build.py)', base);
    expect(html).toContain('href="/api/asset/learning-ad/concepts/interactive/build.py"');
  });

  it('相对 md 链接不动（走前端文档路由）', () => {
    const { html } = renderMarkdown('[另一篇](./other.md)', base);
    expect(html).toContain('href="./other.md"');
    expect(html).not.toContain('/api/asset');
  });

  it('无扩展名的相对链接不动（当文档链接）', () => {
    const { html } = renderMarkdown('[姊妹篇](sibling)', base);
    expect(html).toContain('href="sibling"');
  });

  it('外链 / 绝对路径 / 纯锚点不动', () => {
    const { html } = renderMarkdown(
      '[外链](https://example.com/a.html)\n\n[绝对](/learning-ad/x.html)\n\n[锚点](#top)',
      base,
    );
    expect(html).toContain('href="https://example.com/a.html"');
    expect(html).toContain('href="/learning-ad/x.html"');
    expect(html).toContain('href="#top"');
    expect(html).not.toContain('/api/asset');
  });
});
