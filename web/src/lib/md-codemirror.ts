import { EditorState, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { ensureKatex } from './markdown-extras';

/**
 * 块级 Markdown 单栏编辑器（CodeMirror 6，**按需动态加载**）。
 *
 * 设计（见 specs/doc-editing/plan.md §7）：
 * - 真源永远是 Markdown 文本；这里只做「视图装饰」，不改内容语义 ——
 *   加粗/斜体/行内代码/链接/双链在源码上直接呈现格式，标记符号在光标不落在其中时隐藏，
 *   光标进入就还原成源码（Typora / Obsidian 的手感）。
 * - 图片、行内公式用 widget 直接渲染（KaTeX / img），光标进入同样还原为源码。
 * - 表格 / 围栏代码 / mermaid / 块级公式 / frontmatter / 原始 HTML 不做行内装饰：
 *   它们由外层块组件在「未编辑」时用服务端渲染的 HTML 显示，进入编辑才变成源码。
 * - 仅当用户点「编辑」时才 `import('./md-codemirror')`，阅读路径零成本。
 */

export interface MountOptions {
  parent: HTMLElement;
  /** 初始源码（之后编辑器自己持有，父组件不要反向覆盖，否则会打断输入法与撤销栈）。 */
  value: string;
  /** 文档所在目录（如 /personal/notes），用于把相对图片路径改写成 /api/asset/*。 */
  baseDir: string;
  autoFocus?: boolean;
  /** 点击进入编辑时的鼠标位置：据此把光标放在点到的位置（拿不到就放末尾）。 */
  caretAt?: { x: number; y: number };
  onChange: (value: string) => void;
  /** Esc / 失焦：外层收起这一块的草稿（回到渲染态）。 */
  onFinish: () => void;
  /** ⌘S / Ctrl+S：交给外层保存整篇。 */
  onSave?: () => void;
}

export interface MountedEditor {
  view: EditorView;
  destroy(): void;
}

/** 行内公式：光标不在其中时用 KaTeX 渲染成 widget。 */
class MathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-md-math-widget';
    void ensureKatex().then((k) => {
      try {
        k?.render(this.tex, span, { throwOnError: false });
      } catch {
        span.textContent = this.tex;
      }
    });
    return span;
  }
}

/** 图片：光标不在其中时直接显示图片（相对路径按文档目录改写成 /api/asset/*）。 */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    if (!this.alt) {
      const ph = document.createElement('span');
      ph.className = 'cm-md-image-alt';
      ph.textContent = this.src.split('/').pop() || this.src;
      return ph;
    }
    const img = document.createElement('img');
    img.className = 'cm-md-image';
    img.src = this.src;
    img.alt = this.alt;
    img.title = '光标移入可编辑图片语法';
    return img;
  }
  ignoreEvent() {
    return true;
  }
}

/** 相对路径 → /api/asset/*（与服务端 render.ts 的改写口径一致）。 */
function resolveImageSrc(src: string, baseDir: string): string {
  if (/^(https?:|data:|#|\/\/)/i.test(src) || src.startsWith('/')) return src;
  const parts = (baseDir + '/' + src).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return '/api/asset/' + out.join('/');
}

/**
 * 行内/行级装饰：语法树（Lezer）+ 少量正则兜底。
 *
 * 正则兜底是为了补齐 Lezer（CommonMark）不认识、但我们服务端渲染认识的两类东西：
 * `[[双链]]`、`$行内公式$`；另外 CJK 紧贴强调（`**"中文"**中文`）在 CommonMark 里不成立，
 * 但我们的 markdown-it 装了 cjk-friendly 插件会渲染成加粗 —— 这里用保守正则补一份，
 * 保证「编辑时看到的」与「保存后看到的」一致。
 */
function buildDecorations(view: EditorView, baseDir: string): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const sels = state.selection.ranges;
  const touches = (from: number, to: number) => sels.some((r) => r.from <= to && r.to >= from);

  const marks: Range<Decoration>[] = [];
  // replace 类装饰（藏标记 / 换成 widget）不能相互重叠：统一收集后做一次贪心去重
  const replaces: { from: number; to: number; dec: Decoration }[] = [];
  const lines: Range<Decoration>[] = [];
  const codeRanges: [number, number][] = [];

  const addMark = (from: number, to: number, cls: string) => {
    if (to > from) marks.push(Decoration.mark({ class: cls }).range(from, to));
  };
  const addHide = (from: number, to: number) => {
    if (to > from) replaces.push({ from, to, dec: Decoration.replace({}) });
  };
  const addLine = (pos: number, cls: string) => {
    lines.push(Decoration.line({ class: cls }).range(pos));
  };
  /** 给 [from, to] 覆盖的每一行加行级样式（用行号迭代，避免 Text.lineAfter 不存在）。 */
  const addLines = (from: number, to: number, cls: string) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let n = first; n <= last; n += 1) addLine(doc.line(n).from, cls);
  };

  const tree = syntaxTree(state);
  tree.iterate({
    enter: (n) => {
      const from = n.from;
      const to = n.to;
      const name = n.name;

      // ---- 块级 ----
      const heading = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(name);
      if (heading) {
        const level = Number(heading[1]);
        addLines(from, to, `cm-md-heading cm-md-h${level}`);
        if (!touches(from, to)) {
          const mark = n.node.getChild('HeaderMark');
          if (mark) {
            // `#` 后面那个空格也一起藏掉，视觉上更像渲染结果
            const end = doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to;
            addHide(mark.from, end);
          }
        }
        return;
      }
      if (name === 'Blockquote') {
        addLines(from, to, 'cm-md-quote');
        return;
      }
      if (name === 'FencedCode' || name === 'CodeBlock' || name === 'HTMLBlock') {
        codeRanges.push([from, to]);
        addLines(from, to, name === 'HTMLBlock' ? 'cm-md-htmlblock' : 'cm-md-codeblock');
        return;
      }
      if (name === 'Table') {
        addLines(from, to, 'cm-md-table');
        return;
      }
      if (name === 'HorizontalRule') {
        addLine(doc.lineAt(from).from, 'cm-md-hr');
        return;
      }

      // ---- 行内 ----
      if (name === 'StrongEmphasis' || name === 'Emphasis') {
        const cls = name === 'StrongEmphasis' ? 'cm-md-strong' : 'cm-md-em';
        const inner = n.node.getChildren('EmphasisMark');
        if (inner.length >= 2) {
          const start = inner[0].to;
          const end = inner[inner.length - 1].from;
          addMark(start, end, cls);
          if (!touches(from, to)) {
            addHide(inner[0].from, inner[0].to);
            addHide(inner[inner.length - 1].from, inner[inner.length - 1].to);
          }
        } else {
          addMark(from, to, cls);
        }
        return;
      }
      if (name === 'InlineCode') {
        codeRanges.push([from, to]);
        const inner = n.node.getChildren('CodeMark');
        if (inner.length >= 2) {
          addMark(inner[0].to, inner[inner.length - 1].from, 'cm-md-inlinecode');
          if (!touches(from, to)) {
            addHide(inner[0].from, inner[0].to);
            addHide(inner[inner.length - 1].from, inner[inner.length - 1].to);
          }
        }
        return;
      }
      if (name === 'Link' || name === 'Autolink') {
        if (touches(from, to)) return;
        const text = doc.sliceString(from, to);
        const m = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(text);
        if (m) {
          const textFrom = from + 1;
          addMark(textFrom, textFrom + m[1].length, 'cm-md-link');
          // 只留可读文字：`[` 与 `](url)` 都藏掉
          addHide(from, textFrom);
          addHide(textFrom + m[1].length, to);
        } else {
          addMark(from, to, 'cm-md-link');
        }
        return;
      }
      if (name === 'Image') {
        codeRanges.push([from, to]);
        if (touches(from, to)) return;
        const m = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(doc.sliceString(from, to));
        if (m) {
          replaces.push({
            from,
            to,
            dec: Decoration.replace({ widget: new ImageWidget(resolveImageSrc(m[2], baseDir), m[1]) }),
          });
        }
        return;
      }
    },
  });

  // ---- 正则兜底：双链 / 行内公式（跳过代码区域） ----
  const inCode = (pos: number) => codeRanges.some(([f, t]) => pos >= f && pos <= t);
  const text = doc.toString();

  for (const m of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const at = m.index ?? 0;
    if (inCode(at)) continue;
    const from = at;
    const to = at + m[0].length;
    addMark(from, to, 'cm-md-wikilink');
    if (!touches(from, to)) {
      addHide(from, from + 2);
      addHide(to - 2, to);
    }
  }

  for (const m of text.matchAll(/(?<!\\)\$([^$\n]+)\$/g)) {
    const at = m.index ?? 0;
    if (inCode(at)) continue;
    const from = at;
    const to = at + m[0].length;
    if (touches(from, to)) {
      addMark(from, to, 'cm-md-math-src');
      continue;
    }
    replaces.push({
      from,
      to,
      dec: Decoration.replace({ widget: new MathWidget(m[1].replace(/\s+/g, ' ').trim()) }),
    });
  }

  // CJK 紧贴强调：CommonMark 不认，但我们服务端（cjk-friendly）会加粗
  for (const m of text.matchAll(/\*\*(?=\S)([^*\n]+?)\*\*/g)) {
    const at = m.index ?? 0;
    if (inCode(at)) continue;
    const from = at;
    const inner = m[1];
    const bodyFrom = from + 2;
    addMark(bodyFrom, bodyFrom + inner.length, 'cm-md-strong');
    if (!touches(from, from + m[0].length)) {
      addHide(from, bodyFrom);
      addHide(bodyFrom + inner.length, bodyFrom + inner.length + 2);
    }
  }

  // replace 装饰不能相互重叠（CodeMirror 会抛错）：按起点排序后贪心去重
  replaces.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept: Range<Decoration>[] = [];
  let lastTo = -1;
  for (const r of replaces) {
    if (r.from < lastTo) continue;
    kept.push(r.dec.range(r.from, r.to));
    lastTo = r.to;
  }

  const all = [...marks, ...kept, ...lines];
  all.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decoration.set(all, true);
}

/** 输入法组字期间不重建装饰（否则候选词窗口会闪/错位）。 */
function mdDecorations(baseDir: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, baseDir);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          this.decorations = buildDecorations(u.view, baseDir);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

/** 列表自动续行：行末回车补上同样的前缀；空列表项回车则取消列表。 */
function continueList(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false;
  const m = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/.exec(line.text);
  if (!m) return false;
  const indent = m[1];
  let marker = m[2];
  const rest = line.text.slice(indent.length + marker.length);
  if (!rest.trim()) {
    // 空的列表项：回车把这一行清成空行（结束列表）
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } });
    return true;
  }
  const ordered = /^(\d+)([.)])\s+$/.exec(marker);
  if (ordered) marker = `${Number(ordered[1]) + 1}${ordered[2]} `;
  else if (/^[-*+]\s+\[[ xX]\]\s+$/.test(marker)) marker = marker.replace(/\[[ xX]\]/, '[ ]');
  const insert = '\n' + indent + marker;
  view.dispatch({
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
  });
  return true;
}

export function mountMarkdownBlock(opts: MountOptions): MountedEditor {
  const { parent, value, baseDir } = opts;

  const state = EditorState.create({
    doc: value,
    extensions: [
      history(),
      markdown({ base: markdownLanguage, addKeymap: false }),
      EditorView.lineWrapping,
      mdDecorations(baseDir),
      keymap.of([
        { key: 'Escape', run: () => { opts.onFinish(); return true; } },
        { key: 'Mod-s', run: () => { opts.onSave?.(); return true; } },
        { key: 'Enter', run: continueList },
        indentWithTab,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onChange(u.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        // 失焦收起这一块：延后一拍，让「点别的块」的 click 先落地
        blur: () => {
          window.setTimeout(() => opts.onFinish(), 0);
          return false;
        },
      }),
      EditorView.theme({
        '&': { backgroundColor: 'transparent', fontSize: 'inherit' },
        '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
        '.cm-content': { padding: '0', caretColor: 'var(--md-accent, #0969da)' },
        '.cm-line': { padding: '0 2px' },
        '&.cm-focused': { outline: 'none' },
        '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--md-accent, #0969da) 20%, transparent) !important' },
      }),
    ],
  });

  const view = new EditorView({ state, parent });

  if (opts.autoFocus) view.focus();
  if (opts.caretAt) {
    const pos = view.posAtCoords({ x: opts.caretAt.x, y: opts.caretAt.y });
    view.dispatch({ selection: { anchor: pos ?? view.state.doc.length } });
  } else {
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  }

  return {
    view,
    destroy() {
      view.destroy();
    },
  };
}
