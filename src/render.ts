import MarkdownIt from 'markdown-it';
import cjkFriendly from 'markdown-it-cjk-friendly';
import hljs from 'highlight.js';
import path from 'node:path';
import { NOTE_LINE_RE } from './notes.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const anchorModule = require('markdown-it-anchor');
const emojiModule = require('markdown-it-emoji');
const taskListsModule = require('markdown-it-task-lists');
const footnoteModule = require('markdown-it-footnote');

const anchor = (anchorModule as any).default || anchorModule;
const emoji = (emojiModule as any).full || (emojiModule as any).default?.full || emojiModule;
const taskLists = (taskListsModule as any).default || taskListsModule;
const footnote = (footnoteModule as any).default || footnoteModule;

/** 目录条目里的一段内容：纯文本，或需要前端用 KaTeX 渲染的行内公式。 */
export interface TocPart { type: 'text' | 'math'; value: string; }
export interface TocHeading {
  level: number;
  /** 纯文本（实体已解码、公式为 LaTeX 原文）：无 parts 时直接显示，也用于无障碍标签。 */
  text: string;
  id: string;
  /** 仅在标题里出现公式时给出：有序片段，前端据此在目录中渲染 KaTeX。 */
  parts?: TocPart[];
}
export interface RenderResult { html: string; headings: TocHeading[]; }

const md = MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(str: string, lang: string): string {
    if (lang === 'mermaid') {
      return `<pre class="mermaid-src"><code class="language-mermaid">${md.utils.escapeHtml(str)}</code></pre>`;
    }
    if (lang && hljs.getLanguage(lang) && str.length < 50000) {
      try {
        return `<pre class="hljs"><code class="language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch { /* ignore */ }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(anchor, {
  level: [1, 2, 3, 4, 5, 6],
  // 默认取词只认 text/code_inline：整条标题就是一个公式（`### $F_1$`）时会得到空 slug → id=""，
  // 这类标题既进不了目录也点不动。默认取词为空时兜底把公式源码算进去。
  getTokensText: (tokens: any[]) => {
    const text = tokens
      .filter((t) => t.type === 'text' || t.type === 'code_inline')
      .map((t) => t.content)
      .join('');
    if (text.trim()) return text;
    return tokens
      .filter((t) => t.type === 'math_inline' || t.type === 'math_block')
      .map((t) => t.content)
      .join('');
  },
  slugify: (s: string) =>
    s.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\w\u4e00-\u9fff\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
});
md.use(emoji);
md.use(taskLists, { enabled: true });
md.use(footnote);
// CJK-friendly 强调（opt-in 的 CommonMark 修订草案，见 specs/cjk-friendly-emphasis/spec.md）：
// 不加这一条时 `**"中文"**中文`、`汉字**（括号）**汉字` 这类写法会退化成字面 `**`
// （CommonMark 的 left/right-flanking 规则假设词与标点间有空格，见 commonmark-spec#650）。
// 该插件只在中/日/韩字符与 CJK 标点相邻时生效，CommonMark 官方 652 例输出不变。
md.use(cjkFriendly);
md.use(katexPlugin);
md.use(wikilinkPlugin);
md.use(notePlugin);
md.use(srcLinePlugin);

/**
 * 笔记行（`> note: 内容`）→ 笔记卡片（见 specs/notes/spec.md）。
 *
 * 必须排在 blockquote 之前，否则这一行会先被当成普通引用块吃掉。
 * 卡片上带三个 data 属性，供前端就地编辑（详见 specs/notes/plan.md）：
 *   - data-note-line：笔记所在行号（1-based）
 *   - data-note-raw ：笔记正文的**原始 markdown**（编辑器初值，不能从渲染结果反推）
 *   - data-line-start / data-line-end：与普通块统一的行号锚点
 */
function notePlugin(md: MarkdownIt) {
  md.block.ruler.before('blockquote', 'md_note', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const from = state.bMarks[startLine];
    const to = state.eMarks[startLine];
    const rawLine = state.src.slice(from, to);
    const m = NOTE_LINE_RE.exec(rawLine);
    if (!m) return false;
    if (silent) return true;
    const token = state.push('md_note', 'div', 0);
    token.block = true;
    token.content = m[1];
    token.map = [startLine, startLine + 1];
    token.attrSet('data-note-line', String(startLine + 1));
    token.attrSet('data-note-raw', m[1]);
    token.attrSet('data-line-start', String(startLine + 1));
    token.attrSet('data-line-end', String(startLine + 1));
    state.line = startLine + 1;
    return true;
  });

  md.renderer.rules.md_note = (tokens: any[], idx: number, _options: any, env: any) => {
    const t = tokens[idx];
    const raw = String(t.attrGet('data-note-raw') ?? '');
    return (
      `<div class="md-note" data-note-line="${md.utils.escapeHtml(t.attrGet('data-note-line') || '')}"` +
      ` data-note-raw="${md.utils.escapeHtml(raw)}"` +
      ` data-line-start="${md.utils.escapeHtml(t.attrGet('data-line-start') || '')}"` +
      ` data-line-end="${md.utils.escapeHtml(t.attrGet('data-line-end') || '')}">` +
      `<div class="md-note-label">笔记</div>` +
      `<div class="md-note-body">${md.renderInline(raw, env)}</div>` +
      `</div>\n`
    );
  };
}

/**
 * 给每个顶层块打上源文件行号锚点：前端右键「插入笔记」时据此知道
 * 「插在这个块之后的一行」，不靠文本模糊匹配（详见 specs/notes/plan.md）。
 * data-line-start = 块首行（1-based），data-line-end = 块末行的行号（含）。
 */
function srcLinePlugin(md: MarkdownIt) {
  md.core.ruler.push('src_line_attrs', (state: any) => {
    for (const token of state.tokens) {
      if (!token.map || token.level !== 0 || token.nesting < 0) continue;
      if (token.type === 'inline' || token.type === 'md_note') continue;
      token.attrSet('data-line-start', String(token.map[0] + 1));
      token.attrSet('data-line-end', String(token.map[1]));
    }
  });
}

// 把 [[目标]] / [[目标|别名]] / [[目标#锚点]] 渲染成可点击链接。
// 目标解析（basename → 真实 urlPath）在前端点击时进行（store.fileIndex）。
function wikilinkPlugin(md: MarkdownIt) {
  const rule = (state: any, silent: boolean): boolean => {
    const src = state.src as string;
    const pos = state.pos as number;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false; // [[
    let end = pos + 2;
    while (end < state.posMax - 1) {
      if (src.charCodeAt(end) === 0x5d && src.charCodeAt(end + 1) === 0x5d) break;
      end++;
    }
    if (end >= state.posMax - 1) return false; // 没有闭合 ]]
    const raw = src.slice(pos + 2, end);
    if (!raw.trim()) return false;

    let target = raw;
    let alias = '';
    const pipe = raw.indexOf('|');
    if (pipe >= 0) {
      alias = raw.slice(pipe + 1).trim();
      target = raw.slice(0, pipe).trim();
    }
    let anchor = '';
    const hash = target.indexOf('#');
    if (hash >= 0) {
      anchor = target.slice(hash + 1).trim();
      target = target.slice(0, hash).trim();
    }
    if (!target) return false;
    const text = alias || target;

    if (!silent) {
      const token = state.push('wikilink', '', 0);
      token.content = text;
      token.attrSet('class', 'wikilink');
      token.attrSet('data-target', target);
      token.attrSet('data-anchor', anchor);
      token.attrSet('href', '#');
    }
    state.pos = end + 2;
    return true;
  };
  md.inline.ruler.before('emphasis', 'wikilink', rule);

  md.renderer.rules.wikilink = (tokens: any[], idx: number) => {
    const t = tokens[idx];
    const target = md.utils.escapeHtml(t.attrGet('data-target') || '');
    const anchor = md.utils.escapeHtml(t.attrGet('data-anchor') || '');
    const text = md.utils.escapeHtml(t.content);
    return `<a class="wikilink" href="#" data-target="${target}" data-anchor="${anchor}">${text}</a>`;
  };
}

function katexPlugin(md: MarkdownIt) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    const max = state.posMax;
    if (state.src.charCodeAt(start) !== 0x24) return false;
    if (start + 1 < max && state.src.charCodeAt(start + 1) === 0x24) {
      let pos = start + 2;
      while (pos + 1 < max) {
        if (state.src.charCodeAt(pos) === 0x24 && state.src.charCodeAt(pos + 1) === 0x24) {
          const content = state.src.slice(start + 2, pos).trim();
          if (content.length === 0) return false;
          if (!silent) { const token = state.push('math_block', '', 0); token.content = content; }
          state.pos = pos + 2;
          return true;
        }
        if (state.src.charCodeAt(pos) === 0x0a) return false;
        pos++;
      }
      return false;
    }
    if (start + 1 >= max) return false;
    let pos = start + 1;
    while (pos < max) {
      if (state.src.charCodeAt(pos) === 0x24) {
        const content = state.src.slice(start + 1, pos);
        if (content.length === 0) return false;
        if (!silent) { const token = state.push('math_inline', '', 0); token.content = content; }
        state.pos = pos + 1;
        return true;
      }
      if (state.src.charCodeAt(pos) === 0x0a) return false;
      pos++;
    }
    return false;
  });

  md.block.ruler.after('blockquote', 'math_block', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (pos + 2 > max) return false;
    if (state.src.slice(pos, pos + 2) !== '$$') return false;
    const afterOpen = state.src.slice(pos + 2, max);
    const closeIdx = afterOpen.indexOf('$$');
    if (closeIdx >= 0) {
      const trailing = afterOpen.slice(closeIdx + 2).trim();
      if (trailing.length !== 0) return false;
      const content = afterOpen.slice(0, closeIdx).trim();
      if (content.length === 0) return false;
      if (silent) return true;
      const token = state.push('math_block', '', 0);
      token.content = content;
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    }
    let nextLine = startLine + 1;
    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      if (lineMax - lineStart >= 2 && state.src.slice(lineStart, lineStart + 2) === '$$') {
        if (state.src.slice(lineStart + 2, lineMax).trim().length !== 0) { nextLine++; continue; }
        const content = state.src.slice(pos + 2, lineStart).trim();
        if (content.length === 0) return false;
        if (silent) return true;
        const token = state.push('math_block', '', 0);
        token.content = content;
        token.map = [startLine, nextLine + 1];
        state.line = nextLine + 1;
        return true;
      }
      const lineContent = state.src.slice(lineStart, lineMax).trimEnd();
      if (lineContent.length >= 2 && lineContent.endsWith('$$')) {
        const closePos = lineStart + lineContent.length - 2;
        const content = state.src.slice(pos + 2, closePos).trim();
        if (content.length === 0) return false;
        if (silent) return true;
        const token = state.push('math_block', '', 0);
        token.content = content;
        token.map = [startLine, nextLine + 1];
        state.line = nextLine + 1;
        return true;
      }
      nextLine++;
    }
    return false;
  });
}

(md as any).renderer.rules.math_inline = (tokens: any[], idx: number) =>
  `<span class="katex-math">${md.utils.escapeHtml(tokens[idx].content)}</span>`;
(md as any).renderer.rules.math_block = (tokens: any[], idx: number) => {
  const t = tokens[idx];
  // 数学块是自定义 token：这里手动带上行号锚点，右键才能定位到它。
  const start = t.attrGet('data-line-start');
  const end = t.attrGet('data-line-end');
  const anchor = start && end ? ` data-line-start="${start}" data-line-end="${end}"` : '';
  return `<span class="katex-block"${anchor}>${md.utils.escapeHtml(t.content)}</span>\n`;
};

const defaultImageRenderer = (md as any).renderer.rules.image ||
  ((tokens: any[], idx: number, options: any, _env: any, self: any) => self.renderToken(tokens, idx, options));
(md as any).renderer.rules.image = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx];
  const src = token.attrGet('src');
  const baseDir = (env && env.baseDir) || '';
  if (src && !/^(https?:|data:|#|\/\/)/i.test(src) && !src.startsWith('/')) {
    const abs = path.posix.normalize(path.posix.join(baseDir, src));
    token.attrSet('src', '/api/asset' + abs);
  }
  return defaultImageRenderer(tokens, idx, options, env, self);
};

// 标题内容用 [\s\S]：行内位置的 `$$…$$` 走 math_block 渲染器，会在 </hN> 前留一个换行。
const headingRegex = /<h([1-6])\s+id="([^"]+)"[^>]*>([\s\S]+?)<\/h[1-6]>/g;

// 正文里的公式占位符（见 katexPlugin 的 renderer 规则）。
const katexSpanRegex = /<span class="katex-(?:math|block)"[^>]*>([\s\S]*?)<\/span>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function fromCodePoint(code: number): string | null {
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

/**
 * 还原 markdown-it escapeHtml 出来的实体。
 *
 * 目录直接用标题 HTML 去标签后的文本，实体（`"` → `&quot;`）会原样显示在界面上，
 * 所以要解码一次；只解一次，源码里字面写的 `&quot;`（渲染成 `&amp;quot;`）仍显示为字面量，
 * 与正文的显示语义保持一致。
 */
function decodeEntities(input: string): string {
  return input.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (whole, dec, hex, named) => {
    if (dec !== undefined) return fromCodePoint(parseInt(dec, 10)) ?? whole;
    if (hex !== undefined) return fromCodePoint(parseInt(hex, 16)) ?? whole;
    const key = String(named).toLowerCase();
    return key in NAMED_ENTITIES ? NAMED_ENTITIES[key] : whole;
  });
}

function pushTextPart(parts: TocPart[], html: string) {
  const value = decodeEntities(html.replace(/<[^>]*>/g, ''));
  if (!value) return;
  const prev = parts[parts.length - 1];
  if (prev && prev.type === 'text') prev.value += value;
  else parts.push({ type: 'text', value });
}

/**
 * 标题的行内 HTML → 目录条目：纯文本 + （有公式时）有序片段。
 *
 * 加粗/代码/链接只取文字；公式单独成段，前端在目录里用 KaTeX 渲染，
 * 而不是把 `E=mc^2` 这样的裸 LaTeX 显示出来。
 */
function headingContent(innerHtml: string): { text: string; parts?: TocPart[] } {
  const parts: TocPart[] = [];
  let hasMath = false;
  let last = 0;
  katexSpanRegex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = katexSpanRegex.exec(innerHtml)) !== null) {
    pushTextPart(parts, innerHtml.slice(last, m.index));
    parts.push({ type: 'math', value: decodeEntities(m[1]) });
    hasMath = true;
    last = m.index + m[0].length;
  }
  pushTextPart(parts, innerHtml.slice(last));
  // math_block 渲染器会补一个换行：裁掉目录条目首尾的空白（中间的照旧，靠 HTML 折叠空格）
  if (parts.length && parts[0].type === 'text') parts[0].value = parts[0].value.replace(/^\s+/, '');
  if (parts.length && parts[0].type === 'text' && !parts[0].value) parts.shift();
  const tail = parts[parts.length - 1];
  if (tail && tail.type === 'text') {
    tail.value = tail.value.replace(/\s+$/, '');
    if (!tail.value) parts.pop();
  }
  const text = parts.map((p) => p.value).join('');
  return hasMath ? { text, parts } : { text };
}

export function renderMarkdown(content: string, baseDir = ''): RenderResult {
  const rendered = md.render(content, { baseDir });
  const headings: TocHeading[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(rendered)) !== null) {
    const { text, parts } = headingContent(match[3]);
    const heading: TocHeading = { level: parseInt(match[1], 10), text, id: match[2] };
    if (parts) heading.parts = parts;
    headings.push(heading);
  }
  return { html: rendered, headings };
}
