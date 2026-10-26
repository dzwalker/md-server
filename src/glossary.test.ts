import { describe, it, expect } from 'vitest';
import {
  buildGlossaryIndex,
  isGlossaryFileName,
  normalizeGlossaryName,
  parseGlossaryMarkdown,
  spaceDirsForPath,
  type ParsedGlossaryTerm,
} from './glossary.js';
import { renderMarkdown } from './render.js';

/** 构造一个只用于测试的术语索引（sourcePath 排序与 glossaryForDoc 一致）。 */
function makeIndex(terms: ParsedGlossaryTerm[], sourcePath = '/a/术语表.md') {
  return buildGlossaryIndex([{ sourcePath, terms }], 'v1');
}

/** 从渲染 HTML 里取出全部术语标注：[[key, 文本]]。 */
function termsIn(html: string): [string, string][] {
  return [...html.matchAll(/<span class="glossary-term" data-glossary="([^"]*)">([\s\S]*?)<\/span>/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  );
}

describe('术语表文件命名', () => {
  it('包含 术语表 / glossary（不区分大小写）即生效', () => {
    for (const name of ['术语表.md', '术语表-AD.md', 'glossary.md', 'GLOSSARY_neolix.md', '项目术语表.markdown']) {
      expect(isGlossaryFileName(name)).toBe(true);
    }
    for (const name of ['术语.md', 'gloss.md', 'readme.md', 'glossary.txt']) {
      expect(isGlossaryFileName(name)).toBe(false);
    }
  });

  it('规范化名字：trim + 压缩空白 + 英文小写', () => {
    expect(normalizeGlossaryName('  CLIP  ')).toBe('clip');
    expect(normalizeGlossaryName('NDS  平台')).toBe('nds 平台');
    expect(normalizeGlossaryName('图像模型')).toBe('图像模型');
  });
});

describe('术语表解析', () => {
  const doc = [
    '---',
    'title: 术语表',
    '---',
    '',
    '# 术语表',
    '',
    '## CLIP',
    '别名：clip、对比语言-图像预训练',
    '**Aliases:** vision encoder',
    'CLIP 是把图像和文本映射到同一向量空间的对比学习模型。',
    '',
    '第二段定义。',
    '',
    '## NDS',
    'Neolix 的数据闭环平台。',
    '',
    '### 子标题属于定义',
    '细节。',
    '',
    '## 没有定义',
    '',
    '## 代码里的假标题',
    '```md',
    '## 不应被解析',
    '别名：x',
    '```',
    '真正的定义。',
  ].join('\n');

  it('按 ## 切术语块、剥离 frontmatter、别名合并多行', () => {
    const terms = parseGlossaryMarkdown(doc, '/a/术语表.md');
    expect(terms.map((t) => t.name)).toEqual(['CLIP', 'NDS', '代码里的假标题']);
    // 别名 "clip" 与主名称 CLIP 规范化后同名，去重时丢弃（浮层里的名字列表不需要大小写两份）
    expect(terms[0].aliases).toEqual(['对比语言-图像预训练', 'vision encoder']);
    expect(terms[0].definition).toContain('第二段定义。');
    expect(terms[1].definition).toContain('### 子标题属于定义');
  });

  it('没有定义正文的块丢弃；代码围栏里的 ## / 别名: 不当结构', () => {
    const terms = parseGlossaryMarkdown(doc, '/a/术语表.md');
    expect(terms.some((t) => t.name === '没有定义')).toBe(false);
    expect(terms.some((t) => t.name === '不应被解析')).toBe(false);
    expect(terms[2].aliases).toEqual([]);
    expect(terms[2].definition).toContain('## 不应被解析');
  });

  it('标题里的行内 markdown 被清掉；别名去重且不含主名称', () => {
    const terms = parseGlossaryMarkdown(['## **CLIP** 模型', '别名：CLIP 模型、clip model', '定义。'].join('\n'), '/a/glossary.md');
    expect(terms[0].name).toBe('CLIP 模型');
    expect(terms[0].aliases).toEqual(['clip model']);
  });

  it('别名分隔：顿号/逗号/分号/竖线；TCP/IP 不拆开', () => {
    const terms = parseGlossaryMarkdown(['## X', '别名：A、B，C;D|E / F', '定义。'].join('\n'), '/a/glossary.md');
    expect(terms[0].aliases).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const tcp = parseGlossaryMarkdown(['## TCP/IP', '定义。'].join('\n'), '/a/glossary.md');
    expect(tcp[0].name).toBe('TCP/IP');
  });
});

describe('空间作用域聚合', () => {
  it('文档一级目录 → 所有包含它的 set 的目录并集（排序）', () => {
    const sets = [
      { dirs: ['a', 'b'] },
      { dirs: ['b', 'c'] },
      { dirs: ['d'] },
    ];
    expect(spaceDirsForPath('/b/doc.md', sets)).toEqual(['a', 'b', 'c']);
    expect(spaceDirsForPath('/a/doc.md', sets)).toEqual(['a', 'b']);
    expect(spaceDirsForPath('/z/doc.md', sets)).toEqual([]);
  });

  it('同一个名字多处定义：按文件顺序聚合、完全相同定义去重、前 3 条由渲染层截断', () => {
    const index = buildGlossaryIndex(
      [
        { sourcePath: '/a/术语表.md', terms: [{ name: 'CLIP', aliases: [], definition: '定义一', sourcePath: '/a/术语表.md' }] },
        { sourcePath: '/b/术语表.md', terms: [{ name: 'CLIP', aliases: [], definition: '定义二', sourcePath: '/b/术语表.md' }] },
        { sourcePath: '/c/术语表.md', terms: [{ name: 'CLIP', aliases: [], definition: '定义一', sourcePath: '/c/术语表.md' }] },
        { sourcePath: '/d/术语表.md', terms: [{ name: 'CLIP', aliases: [], definition: '定义四', sourcePath: '/d/术语表.md' }] },
      ],
      'v1',
    );
    const entry = index.names.get('clip')!;
    expect(entry.defs.map((d) => d.raw)).toEqual(['定义一', '定义二', '定义四']);
  });

  it('别名与主名称指向同一份定义', () => {
    const index = makeIndex([
      { name: 'CLIP', aliases: ['clip', '对比语言-图像预训练'], definition: '定义', sourcePath: '/a/术语表.md' },
    ]);
    const en = index.names.get('clip')!;
    const zh = index.names.get('对比语言-图像预训练')!;
    expect(en).toEqual(zh);
    expect(en.names).toEqual(['CLIP', '对比语言-图像预训练']);
    expect(en.defs.map((d) => d.raw)).toEqual(['定义']);
  });
});

describe('匹配：长词优先与英文全词边界', () => {
  const terms: ParsedGlossaryTerm[] = [
    { name: 'CLIP', aliases: [], definition: 'CLIP 定义', sourcePath: '/a/术语表.md' },
    { name: 'CLIP模型', aliases: [], definition: 'CLIP 模型定义', sourcePath: '/a/术语表.md' },
    { name: 'lip', aliases: [], definition: 'lip 定义', sourcePath: '/a/术语表.md' },
  ];
  const index = () => makeIndex(terms); // 每次新索引：matcher 是有状态的 g 正则

  it('同起点长词优先：CLIP模型 整段命中，不会再拆出 CLIP', () => {
    expect(termsIn(renderMarkdown('CLIP模型很强。', '', index()).html)).toEqual([['clip模型', 'CLIP模型']]);
  });

  it('长词不匹配时回退到短词', () => {
    expect(termsIn(renderMarkdown('CLIP 模型很强。', '', index()).html)).toEqual([['clip', 'CLIP']]);
  });

  it('英文全词：CLIP2 / clipx / a_clip 不命中；标点/中文边界与单词独立命中', () => {
    expect(termsIn(renderMarkdown('CLIP2', '', index()).html)).toEqual([]);
    expect(termsIn(renderMarkdown('clipx', '', index()).html)).toEqual([]);
    expect(termsIn(renderMarkdown('a_clip', '', index()).html)).toEqual([]);
    // 标点是单词边界：a.clip 里的 clip 算独立词（符合「全词」定义）
    expect(termsIn(renderMarkdown('a.clip', '', index()).html)).toEqual([['clip', 'clip']]);
    expect(termsIn(renderMarkdown('用clip做检索', '', index()).html)).toEqual([['clip', 'clip']]);
    expect(termsIn(renderMarkdown('clip 与 CLIP', '', index()).html)).toEqual([
      ['clip', 'clip'],
      ['clip', 'CLIP'],
    ]);
  });

  it('lip 不会在 clip 里命中（英文全词边界）', () => {
    const onlyLip = makeIndex([{ name: 'lip', aliases: [], definition: '唇', sourcePath: '/a/术语表.md' }]);
    expect(termsIn(renderMarkdown('clip', '', onlyLip).html)).toEqual([]);
    expect(termsIn(renderMarkdown('lip', '', onlyLip).html)).toEqual([['lip', 'lip']]);
  });

  it('中文子串匹配；中文术语不要求词边界', () => {
    const zh = makeIndex([{ name: '图像模型', aliases: [], definition: '定义', sourcePath: '/a/术语表.md' }]);
    expect(termsIn(renderMarkdown('大图像模型', '', zh).html)).toEqual([['图像模型', '图像模型']]);
  });

  it('中文长词优先；跨起点重叠按左优先（spec 约定行为）', () => {
    const longer = makeIndex([
      { name: '大语言模型', aliases: [], definition: '长', sourcePath: '/a/术语表.md' },
      { name: '语言模型', aliases: [], definition: '短', sourcePath: '/a/术语表.md' },
    ]);
    expect(termsIn(renderMarkdown('大语言模型', '', longer).html)).toEqual([['大语言模型', '大语言模型']]);

    const overlap = makeIndex([
      { name: '语言', aliases: [], definition: 'x', sourcePath: '/a/术语表.md' },
      { name: '言模型', aliases: [], definition: 'y', sourcePath: '/a/术语表.md' },
    ]);
    expect(termsIn(renderMarkdown('语言模型', '', overlap).html)).toEqual([['语言', '语言']]);
  });

  it('匹配器不使用 lookaround（名字多时会让 V8 退化到慢路径）', () => {
    const big = makeIndex(
      Array.from({ length: 900 }, (_, i) => ({
        name: `TERM${i}`,
        aliases: [],
        definition: `第 ${i} 个术语`,
        sourcePath: '/a/术语表.md',
      })),
    );
    expect(big.matcher.source).not.toContain('(?<');
    expect(big.matcher.source).not.toContain('(?!');
  });

  it('大小写不敏感：命中文本保留原文大小写', () => {
    expect(termsIn(renderMarkdown('Clip 与 cLiP', '', index()).html)).toEqual([
      ['clip', 'Clip'],
      ['clip', 'cLiP'],
    ]);
  });
});

describe('匹配位置：标题 / 代码 / 链接 / 笔记', () => {
  const index = () => makeIndex([{ name: 'CLIP', aliases: [], definition: '定义', sourcePath: '/a/术语表.md' }]);

  it('标题里标注，目录文本不受影响', () => {
    const r = renderMarkdown('# CLIP 是什么', '', index());
    expect(termsIn(r.html)).toEqual([['clip', 'CLIP']]);
    expect(r.headings.map((h) => h.text)).toEqual(['CLIP 是什么']);
    expect(r.headings[0].id).toContain('clip');
  });

  it('代码块 / 行内代码 / 链接文字不标注', () => {
    const doc = ['```', 'CLIP', '```', '', '`CLIP` 与 [CLIP](https://example.com) 以及正文 CLIP。'].join('\n');
    const html = renderMarkdown(doc, '', index()).html;
    expect(termsIn(html)).toEqual([['clip', 'CLIP']]);
  });

  it('笔记卡片里的术语也标注', () => {
    const html = renderMarkdown('> note: 用 CLIP 做检索', '', index()).html;
    expect(html).toContain('md-note-body');
    expect(termsIn(html)).toEqual([['clip', 'CLIP']]);
  });
});

describe('渲染响应里的定义 payload', () => {
  it('只带命中名字的定义；同名字超过 3 条时截断并给 total', () => {
    const files = ['/a/术语表.md', '/b/术语表.md', '/c/术语表.md', '/d/术语表.md'].map((sourcePath, i) => ({
      sourcePath,
      terms: [
        { name: 'CLIP', aliases: ['clip'], definition: `定义${i + 1}`, sourcePath } as ParsedGlossaryTerm,
        { name: 'NDS', aliases: [], definition: '不会命中', sourcePath } as ParsedGlossaryTerm,
      ],
    }));
    const index = buildGlossaryIndex(files, 'v9');
    const r = renderMarkdown('CLIP 与 CLIP', '', index);
    expect(r.glossaryVersion).toBe('v9');
    expect(Object.keys(r.glossary!.terms)).toEqual(['clip']);
    const info = r.glossary!.terms.clip;
    expect(info.names).toEqual(['CLIP']); // 别名 clip 与主名称规范化同名，去重后只剩一份
    expect(info.total).toBe(4);
    expect(info.defs).toHaveLength(3);
    expect(info.defs.map((d) => d.source)).toEqual(['术语表.md', '术语表.md', '术语表.md']);
    expect(info.defs[0].html).toContain('定义1');
  });

  it('没有命中任何术语时不带 glossary（响应保持精简）', () => {
    const index = makeIndex([{ name: 'CLIP', aliases: [], definition: '定义', sourcePath: '/a/术语表.md' }]);
    const r = renderMarkdown('普通正文。', '', index);
    expect(r.glossary).toBeUndefined();
    expect(r.glossaryVersion).toBe('v1');
  });

  it('不传术语索引时：HTML 与旧版一致，不带 glossary 字段', () => {
    const doc = '# 标题\n\n正文 CLIP。';
    const r = renderMarkdown(doc);
    expect(r.html).not.toContain('glossary-term');
    expect(r.glossary).toBeUndefined();
    expect(r.glossaryVersion).toBe('');
  });
});
