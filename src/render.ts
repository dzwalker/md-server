import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import path from 'node:path';
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

export interface TocHeading { level: number; text: string; id: string; }
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
  slugify: (s: string) =>
    s.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\w\u4e00-\u9fff\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
});
md.use(emoji);
md.use(taskLists, { enabled: true });
md.use(footnote);
md.use(katexPlugin);

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
(md as any).renderer.rules.math_block = (tokens: any[], idx: number) =>
  `<span class="katex-block">${md.utils.escapeHtml(tokens[idx].content)}</span>\n`;

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

const headingRegex = /<h([1-6])\s+id="([^"]+)"[^>]*>(.+?)<\/h[1-6]>/g;

export function renderMarkdown(content: string, baseDir = ''): RenderResult {
  const rendered = md.render(content, { baseDir });
  const headings: TocHeading[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(rendered)) !== null) {
    headings.push({ level: parseInt(match[1], 10), text: match[3].replace(/<[^>]+>/g, ''), id: match[2] });
  }
  return { html: rendered, headings };
}
