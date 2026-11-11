import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RotateCw } from 'lucide-react';
import { api } from '@/lib/api';
import { renderExtras } from '@/lib/markdown-extras';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BlockSourceEditor } from './block-source-editor';
import { MilkdownEditor } from './milkdown-editor';
import type { EditorMode, RichEditorHandle } from './rich-editor-types';
import { getBlockHtml, setBlockHtml } from '@/lib/block-cache';

/**
 * 正文编辑器（见 specs/doc-editing/）。
 *
 * 三种模式（文档头右侧切换）：
 * - `blocks`（默认）：单栏分块编辑。空闲块用服务端渲染结果展示，点某一块原地变成带格式装饰的
 *   源码（CodeMirror 6）。**连续的「行内块」（段落/标题/列表/引用/笔记/分割线）会合并成一个
 *   编辑区**，点一下就能同时看到并修改多段；表格/围栏代码/图表/块级公式/原始 HTML/frontmatter/
 *   脚注定义这类「源码 ≠ 渲染结果」的块单独成块，光标进入才显示源码。
 * - `source`：整篇源码（纯文本框）。
 * - `milkdown`：Milkdown（Crepe，ProseMirror）富文本编辑器（默认）；
 *   保存路径是 remark 序列化，会重排原文（见 plan.md 的代价说明）。
 *
 * 多篇同时编辑：每篇的草稿由父组件按路径保存（`EditorDraft`），切 tab 时本组件卸载前
 * 把「有改动」的草稿交出去，切回来再通过 `initialDraft` 恢复，不重新读盘。
 *
 * 真源永远是 Markdown 文本：分块编辑只替换被编辑区的源码行，未编辑的行逐字保留。
 */

/** 编辑单元类型：`region` = 合并后的行内块编辑区，其余是「独立块」。 */
type UnitKind =
  | 'region'
  | 'table'
  | 'code'
  | 'mermaid'
  | 'math'
  | 'frontmatter'
  | 'footnote'
  | 'html'
  | 'source'
  | 'gap';

interface Segment {
  kind: 'unit' | 'gap';
  cls: UnitKind;
  /** 该段覆盖的源码行（不含行尾换行）。 */
  src: string[];
  /** 服务端渲染出的 HTML。 */
  html?: string;
  /** 独立块的显示名（表格/代码块…）。 */
  label?: string;
}

interface ParsedBlock {
  start: number;
  end: number;
  /** 独立块的类型；行内块统一为 'region'。 */
  cls: UnitKind;
  html: string;
  /** true = 可以并进编辑区（段落/标题/列表/引用/笔记/分割线）。 */
  inline: boolean;
}

const KIND_LABEL: Partial<Record<UnitKind, string>> = {
  table: '表格',
  code: '代码块',
  mermaid: '图表',
  math: '公式块',
  frontmatter: '文档信息',
  footnote: '脚注',
  html: 'HTML',
};

/** 把服务端渲染出的顶层元素归类：行内块（可合并）vs 独立块。 */
function classifyEl(el: Element): { cls: UnitKind; html: string; inline: boolean } {
  const tag = el.tagName.toLowerCase();
  const html = (el as HTMLElement).outerHTML;
  if (tag === 'table') return { cls: 'table', html, inline: false };
  if (tag === 'pre') {
    return { cls: el.classList.contains('mermaid-src') ? 'mermaid' : 'code', html, inline: false };
  }
  if (tag === 'details' && el.classList.contains('md-frontmatter')) {
    return { cls: 'frontmatter', html, inline: false };
  }
  if (tag === 'span' && el.classList.contains('katex-block')) return { cls: 'math', html, inline: false };
  if (tag === 'section' && el.classList.contains('footnotes')) return { cls: 'footnote', html, inline: false };
  if (tag === 'div' && el.classList.contains('md-note')) return { cls: 'region', html, inline: true };
  if (tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'ul' || tag === 'ol' || tag === 'blockquote' || tag === 'hr') {
    return { cls: 'region', html, inline: true };
  }
  return { cls: 'html', html, inline: false };
}

/**
 * 从渲染结果里取块的行区间。
 *
 * 没有行号锚点的顶层元素（原始 HTML 块）直接跳过——它们覆盖的源码会落到「未覆盖区间」，
 * 以源码块的形式出现，照样可编辑。
 */
export function parseBlocks(html: string, totalLines: number): ParsedBlock[] {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const out: ParsedBlock[] = [];
  let prevEnd = 0;
  for (const child of Array.from(holder.children)) {
    const el = child as HTMLElement;
    const start = Number(el.dataset.lineStart || 0);
    const end = Number(el.dataset.lineEnd || 0);
    if (!start || !end || end < start || start <= prevEnd) continue;
    if (start > totalLines) continue;
    const clampedEnd = Math.min(end, totalLines);
    out.push({ start, end: clampedEnd, ...classifyEl(el) });
    prevEnd = clampedEnd;
  }
  return out;
}

/**
 * 把整篇源码切成「段」：
 * - 连续的行内块 → 一个 region（一次编辑多段）；
 * - 独立块 → 各自一段；
 * - 块之间的空白行 → gap（不显示输入框，原样回写）；
 * - 块之间的非空行（原始 HTML、脚注定义、YAML 头）→ source 源码段。
 */
export function buildSegments(text: string, html: string): Segment[] {
  const lines = text.split('\n');
  const total = lines.length;
  const blocks = parseBlocks(html, total);
  const segs: Segment[] = [];
  let cursor = 0;

  const pushUncovered = (from: number, to: number) => {
    if (to <= from) return;
    const src = lines.slice(from, to);
    if (src.every((l) => l.trim() === '')) segs.push({ kind: 'gap', cls: 'gap', src });
    else segs.push({ kind: 'unit', cls: 'source', src });
  };

  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    pushUncovered(cursor, b.start - 1);
    if (b.inline) {
      // 合并连续的行内块（中间的空白行也一起进这一段的源码）
      let j = i;
      while (j + 1 < blocks.length && blocks[j + 1].inline) j += 1;
      const last = blocks[j];
      segs.push({
        kind: 'unit',
        cls: 'region',
        src: lines.slice(b.start - 1, last.end),
        html: blocks
          .slice(i, j + 1)
          .map((x) => x.html)
          .join('\n'),
      });
      cursor = last.end;
      i = j + 1;
    } else {
      segs.push({
        kind: 'unit',
        cls: b.cls,
        src: lines.slice(b.start - 1, b.end),
        html: b.html,
        label: KIND_LABEL[b.cls],
      });
      cursor = b.end;
      i += 1;
    }
  }
  pushUncovered(cursor, total);

  // 顶部 YAML frontmatter 无行号锚点 → 落在源码段里；给它一个准确的名字。
  if (lines[0] === '---') {
    const close = lines.findIndex((l, i2) => i2 > 0 && (l === '---' || l === '...'));
    if (close > 0) {
      const seg = segs.find((x) => x.kind === 'unit' && x.cls === 'source' && x.src.length >= close + 1);
      if (seg) seg.label = '文档信息（YAML）';
    }
  }

  // 空文档：给一个空的编辑区，点进去就能写。
  if (!segs.some((s) => s.kind === 'unit')) {
    const firstGap = segs.findIndex((s) => s.kind === 'gap');
    if (firstGap >= 0) segs[firstGap] = { kind: 'unit', cls: 'region', src: segs[firstGap].src };
    else segs.push({ kind: 'unit', cls: 'region', src: [''] });
  }
  return segs;
}

/** 段序列 → 整篇源码（段与段之间补回换行）。 */
function segmentsText(segs: Segment[]): string {
  return segs.map((s) => s.src.join('\n')).join('\n');
}

/** 文档头 YAML frontmatter 的拆分结果（分隔符原样保留，正文单独给编辑器）。 */
interface FrontmatterPart {
  /** 是否有 frontmatter（必须是文件第一行 `---` 且有闭合行）。 */
  has: boolean;
  /** 开分隔符（固定 `---`）。 */
  open: string;
  /** 闭分隔符（`---` 或 `...`，原样保留）。 */
  close: string;
  /** 分隔符之间的 YAML 原文（编辑框里的内容）。 */
  inner: string;
}

/**
 * 把文档拆成「文档信息（frontmatter）」与「正文」。
 *
 * 编辑态里 frontmatter 不进任何编辑器（Crepe/CM6 都会把它当普通文本或吃掉），
 * 而是单独渲染成一个默认折叠的区域，点开是一个普通 textarea。
 */
export function splitFrontmatter(text: string): { fm: FrontmatterPart; body: string } {
  const none: FrontmatterPart = { has: false, open: '---', close: '---', inner: '' };
  if (!text.startsWith('---\n') && text !== '---') return { fm: none, body: text };
  const lines = text.split('\n');
  const closeIdx = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
  if (closeIdx < 0) return { fm: none, body: text };
  return {
    fm: {
      has: true,
      open: '---',
      close: lines[closeIdx],
      inner: lines.slice(1, closeIdx).join('\n'),
    },
    body: lines.slice(closeIdx + 1).join('\n'),
  };
}

/** 把「文档信息」+「正文」拼回整篇源码（分隔符保留原样）。 */
export function joinFrontmatter(fm: FrontmatterPart, inner: string, body: string): string {
  if (!fm.has) return body;
  // frontmatter 与正文之间保留一个空行：富文本编辑器（remark/turndown）序列化时
  // 会把正文开头的空行吃掉，这里拼回时统一补一个，避免每存一次就少一个空行。
  const gap = body === '' || body.startsWith('\n') ? '' : '\n';
  return `${fm.open}\n${inner}\n${fm.close}\n${gap}${body}`;
}

/** 切 tab 时交给父组件的草稿快照（只有「有改动」的才会保存）。 */
export interface EditorDraft {
  /** 整篇 markdown（含 frontmatter）。 */
  text: string;
  /** 载入时的磁盘原文（用于脏判断）。 */
  original: string;
  mtimeMs?: number;
}

export interface DocEditorHandle {
  /** 保存：force=true 时不带 mtime（用户确认「覆盖保存」）。失败会抛错。 */
  save: (opts?: { force?: boolean }) => Promise<void>;
  isDirty: () => boolean;
}

interface DocEditorProps {
  path: string;
  mode: EditorMode;
  /** 切回这篇文档时恢复的草稿（有改动才会被保存，所以非空即为「上次没存」）。 */
  initialDraft?: EditorDraft;
  /** 打开文档时顺手缓存的原文（来自 `/api/render?raw=1`），有它就不用再发一次请求。 */
  preload?: { content: string; mtimeMs?: number };
  /** 卸载（切走 / 关闭）前把未保存的草稿交出去。 */
  onDraft?: (draft: EditorDraft) => void;
  /** 保存成功：父组件负责退出编辑态并重渲染这篇文档。 */
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** 保存失败（非冲突）时给父组件的提示。 */
  onError?: (message: string) => void;
}

export const DocEditor = forwardRef<DocEditorHandle, DocEditorProps>(function DocEditor(
  { path, mode, initialDraft, preload, onDraft, onSaved, onDirtyChange, onError },
  ref,
) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 正在编辑的单元 + 点进来时的鼠标位置。 */
  const [active, setActive] = useState<{ index: number; caret?: { x: number; y: number } } | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [richText, setRichText] = useState('');
  /** frontmatter 拆分结果（open/close 分隔符 + 是否有） */
  const fmRef = useRef<FrontmatterPart>({ has: false, open: '---', close: '---', inner: '' });
  /** 编辑框里的 YAML 原文（不含分隔线） */
  const [fmInner, setFmInner] = useState('');
  const fmInnerRef = useRef('');
  const updateFmInner = useCallback((v: string) => {
    fmInnerRef.current = v;
    setFmInner(v);
  }, []);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const eolRef = useRef('\n');
  const mtimeRef = useRef<number | undefined>(undefined);
  const originalRef = useRef('');
  const richRef = useRef<RichEditorHandle>(null);
  const prevModeRef = useRef<EditorMode>(mode);
  /** 最后一次已知的整篇源码：模式切换时用它给目标模式的 state 播种（否则会读到旧值）。 */
  const lastGoodRef = useRef('');

  // load() 只在挂载时跑一次，用 ref 读当前模式，避免把 mode 放进依赖导致切换模式时重载。
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /**
   * 取「分块」用的渲染结果并切段。
   *
   * 两个优化：
   * - 只在 blocks 模式才需要（A1）：Milkdown/源码模式不请求 `/api/render-block`；
   * - 会话内按 `path + mtime` 缓存（B1）：同一版本反复进出编辑态不重复渲染。
   */
  const loadSegments = useCallback(
    async (body: string, mtimeMs?: number): Promise<Segment[]> => {
      const cached = getBlockHtml(path, mtimeMs);
      if (cached) return buildSegments(body, cached);
      const r = await api.renderBlock(path, body);
      setBlockHtml(path, mtimeMs, r.html);
      return buildSegments(body, r.html);
    },
    [path],
  );

  /** 载入：有草稿/预取就用它们，否则读磁盘原文；只有分块模式才需要渲染结果。 */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let text: string;
      let original: string;
      let mtimeMs: number | undefined;
      if (initialDraft) {
        eolRef.current = initialDraft.text.includes('\r\n') ? '\r\n' : '\n';
        text = initialDraft.text.replace(/\r\n/g, '\n');
        original = initialDraft.original.replace(/\r\n/g, '\n');
        mtimeMs = initialDraft.mtimeMs;
      } else if (preload) {
        // 打开文档时已经缓存过原文：这里零网络，编辑器可以立刻挂上。
        eolRef.current = preload.content.includes('\r\n') ? '\r\n' : '\n';
        text = preload.content.replace(/\r\n/g, '\n');
        original = text;
        mtimeMs = preload.mtimeMs;
      } else {
        const raw = await api.rawFile(path);
        eolRef.current = raw.content.includes('\r\n') ? '\r\n' : '\n';
        text = raw.content.replace(/\r\n/g, '\n');
        original = text;
        mtimeMs = raw.mtimeMs;
      }
      const { fm, body } = splitFrontmatter(text);
      mtimeRef.current = mtimeMs;
      originalRef.current = original;
      fmRef.current = fm;
      fmInnerRef.current = fm.inner;
      setFmInner(fm.inner);
      setSourceText(body);
      setRichText(body);
      lastGoodRef.current = body;
      setActive(null);
      setConflict(false);
      // 只有「分块」模式才需要渲染结果（默认 Milkdown 不再白等这一次请求）
      if (modeRef.current === 'blocks') setSegments(await loadSegments(body, mtimeMs));
      else setSegments(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  // 卸载（切 tab / 关闭）前把「有改动」的草稿交给父组件，切回来时用 initialDraft 恢复。
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => {
    return () => {
      if (textRef.current !== originalRef.current) {
        onDraftRef.current?.({
          text: textRef.current,
          original: originalRef.current,
          mtimeMs: mtimeRef.current,
        });
      }
    };
  }, []);

  /** 正文（不含 frontmatter）：各模式各自持有 */
  const bodyText = useMemo(() => {
    if (mode === 'blocks') return segments ? segmentsText(segments) : '';
    if (mode === 'source') return sourceText;
    return richText;
  }, [mode, segments, sourceText, richText]);

  /** 整篇源码 = frontmatter + 正文（保存与脏判断都用它） */
  const text = useMemo(() => joinFrontmatter(fmRef.current, fmInner, bodyText), [fmInner, bodyText]);

  const dirty = !loading && !loadError && text !== originalRef.current;
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /** 进入富文本/源码模式：把当前分块内容同步过去（从「最后一次已知内容」取，避免读到旧 state）。 */
  useEffect(() => {
    if (mode === 'source') setSourceText(lastGoodRef.current);
    else if (mode !== 'blocks') setRichText(lastGoodRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /** 从富文本/源码模式切回分块：按当前源码重新分块（块结构可能已经被改过）。 */
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (mode !== 'blocks' || prev === 'blocks') return;
    let alive = true;
    setLoading(true);
    // 延后一帧：切走富文本时，它的卸载回调会先把最新 markdown flush 回 lastGoodRef，
    // 这里立刻读会读到 flush 之前的值。
    const timer = window.setTimeout(() => {
      if (!alive) return;
      loadSegments(lastGoodRef.current, mtimeRef.current)
        .then((segs) => {
          if (alive) setSegments(segs);
        })
        .catch(() => {
          /* 渲染失败就退回纯源码段 */
          if (alive) setSegments([{ kind: 'unit', cls: 'source', src: lastGoodRef.current.split('\n') }]);
        })
        .finally(() => {
          if (alive) {
            setLoading(false);
            setActive(null);
          }
        });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [mode, path, loadSegments]);

  const setSegmentSrc = useCallback((index: number, src: string[]) => {
    setSegments((cur) => {
      if (!cur) return cur;
      const next = cur.slice();
      next[index] = { ...next[index], src };
      lastGoodRef.current = segmentsText(next);
      return next;
    });
  }, []);

  /** 用户是否已经在这篇文档里动过（键鼠/输入）。用于区分「载入时的规范化」和真实编辑。 */
  const touchedRef = useRef(false);
  const markTouched = useCallback(() => {
    touchedRef.current = true;
  }, []);

  /**
   * 富文本编辑器回调：写 state 的同时更新「最后一次已知内容」。
   *
   * Crepe 装载时会把 markdown 重新序列化（列表符号、表格分隔行、空行等被规范化），
   * 这会在用户什么都没动的情况下就和磁盘原文不同。所以：**在用户没动过、且切换进来之前
   * 内容本就等于磁盘原文**时，把基线对齐到规范化结果——否则一进编辑态就显示「有未保存改动」，
   * 还会在 tab 上出现脏标记、关闭时多余地弹确认。
   */
  const onRichChange = useCallback((v: string) => {
    if (!touchedRef.current) {
      const before = joinFrontmatter(fmRef.current, fmInnerRef.current, lastGoodRef.current);
      if (before === originalRef.current) {
        originalRef.current = joinFrontmatter(fmRef.current, fmInnerRef.current, v);
      }
    }
    lastGoodRef.current = v;
    setRichText(v);
  }, []);

  /** 取保存用的整篇源码：富文本模式同步 flush 一次，避免防抖丢最后几个字。 */
  const currentContent = useCallback(() => {
    let body = bodyText;
    if (mode === 'milkdown') {
      try {
        const flushed = richRef.current?.flush?.();
        if (typeof flushed === 'string' && flushed.length) body = flushed;
      } catch {
        /* ignore */
      }
    }
    return joinFrontmatter(fmRef.current, fmInner, body);
  }, [mode, bodyText, fmInner]);

  const doSave = useCallback(
    async (opts?: { force?: boolean }) => {
      if (loading || loadError) return;
      setSaving(true);
      setConflict(false);
      try {
        const content = currentContent().replace(/\n/g, eolRef.current);
        const res = await api.saveDoc({ path, content, mtimeMs: opts?.force ? undefined : mtimeRef.current });
        // 保存后**不退出编辑态**：把基线（原文 + mtime）更新到刚写入的版本，
        // 于是脏标记清零、保存按钮变灰，但光标位置/滚动/编辑器实例都保持不变，可以接着写。
        originalRef.current = currentContent();
        mtimeRef.current = res.mtimeMs;
        onSaved();
      } catch (e) {
        const msg = e instanceof Error ? e.message : '保存失败';
        if (/外部修改/.test(msg)) setConflict(true);
        else onError?.(msg);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [path, loading, loadError, currentContent, onSaved, onError],
  );

  useImperativeHandle(
    ref,
    () => ({
      save: doSave,
      isDirty: () => dirty,
    }),
    [doSave, dirty],
  );

  if (loading) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">载入中…</div>;
  }
  if (loadError) {
    return (
      <div className="px-6 py-10 text-sm">
        <div className="mb-2 text-destructive">{loadError}</div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RotateCw className="h-3.5 w-3.5" /> 重新载入
        </Button>
      </div>
    );
  }

  return (
    <div
      className="md-editor"
      onKeyDown={markTouched}
      onPaste={markTouched}
      onCut={markTouched}
      onDrop={markTouched}
      onInput={markTouched}
    >
      {conflict && (
        <div className="md-editor-conflict">
          <span>磁盘上的文件在编辑期间被外部修改过，直接保存会覆盖它。</span>
          <Button variant="outline" size="sm" onClick={() => void doSave({ force: true })}>
            覆盖保存
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            放弃修改并重新载入
          </Button>
        </div>
      )}

      {fmRef.current.has && (
        <details className="md-frontmatter-edit">
          <summary>
            <span className="md-frontmatter-edit-label">文档信息</span>
            <span className="md-frontmatter-edit-hint">YAML（点击展开编辑）</span>
          </summary>
          <textarea
            className="md-frontmatter-edit-input"
            value={fmInner}
            spellCheck={false}
            rows={Math.min(12, Math.max(2, fmInner.split('\n').length))}
            onChange={(e) => updateFmInner(e.target.value)}
          />
        </details>
      )}

      {mode === 'source' ? (
        <textarea
          className="md-editor-source"
          value={sourceText}
          spellCheck={false}
          onChange={(e) => {
            lastGoodRef.current = e.target.value;
            setSourceText(e.target.value);
          }}
        />
      ) : mode === 'milkdown' ? (
        <MilkdownEditor key="milkdown" ref={richRef} value={richText} docPath={path} onChange={onRichChange} />
      ) : (
        <div className="md-editor-blocks md-content">
          {(segments ?? []).map((seg, i) =>
            seg.kind === 'gap' ? (
              <div key={i} className="md-editor-gap" />
            ) : (
              <Unit
                key={i}
                path={path}
                seg={seg}
                editing={active?.index === i}
                caretAt={active?.index === i ? active.caret : undefined}
                onStartEdit={(caret) => setActive({ index: i, caret })}
                onStopEdit={() => setActive((cur) => (cur?.index === i ? null : cur))}
                onChange={(src) => setSegmentSrc(i, src)}
              />
            ),
          )}
        </div>
      )}

      {saving && <div className="md-editor-saving">保存中…</div>}
    </div>
  );
});

interface UnitProps {
  path: string;
  seg: Segment;
  editing: boolean;
  caretAt?: { x: number; y: number };
  onStartEdit: (caret?: { x: number; y: number }) => void;
  onStopEdit: () => void;
  onChange: (src: string[]) => void;
}

/**
 * 单个编辑单元：渲染态 ↔ 源码态。
 *
 * 编辑区（region）是「多段合并」的：点进去看到的是这一整段区域的源码（含空行），
 * 收起时按区域重新渲染一次。独立块（表格/代码/图表…）同理，只是尺寸会随源码行数变化。
 */
function Unit({ path, seg, editing, caretAt, onStartEdit, onStopEdit, onChange }: UnitProps) {
  const src = seg.src.join('\n');
  const label = seg.label;
  const displayRef = useRef<HTMLDivElement>(null);
  const htmlSrcRef = useRef(src);
  const srcRef = useRef(src);
  srcRef.current = src;
  const [html, setHtml] = useState(seg.html ?? '');
  const [rendering, setRendering] = useState(false);
  // 外部（模式切换后重建分块）给了新的渲染结果时，同步进来；
  // 否则组件按 index 复用会一直显示旧 HTML，丢掉在富文本模式里改的内容。
  const appliedPropRef = useRef(seg.html);
  useEffect(() => {
    if (seg.html === appliedPropRef.current) return;
    appliedPropRef.current = seg.html;
    if (editing) return;
    setHtml(seg.html ?? '');
    htmlSrcRef.current = seg.src.join('\n');
  }, [seg.html, seg.src, editing]);

  // 渲染态下的二次渲染（KaTeX / mermaid）
  useEffect(() => {
    if (editing || !displayRef.current) return;
    void renderExtras(displayRef.current);
  }, [editing, html]);

  // 收起编辑后，源码变了就重新渲染这一个单元（独立块或整个编辑区）。
  useEffect(() => {
    if (editing) return;
    if (seg.cls === 'source') return;
    if (srcRef.current === htmlSrcRef.current) return;
    let alive = true;
    const next = srcRef.current;
    setRendering(true);
    api
      .renderBlock(path, next)
      .then((r) => {
        if (!alive) return;
        setHtml(r.html);
        htmlSrcRef.current = next;
      })
      .catch(() => {
        /* 渲染失败：保留上一版 HTML，源码仍是真源 */
      })
      .finally(() => {
        if (alive) setRendering(false);
      });
    return () => {
      alive = false;
    };
  }, [editing, path, seg.cls]);

  // 纯源码段（未被渲染结果覆盖的行：原始 HTML、脚注定义、YAML 头）
  if (seg.cls === 'source') {
    return (
      <div className="md-block" data-kind={seg.cls}>
        <div className="md-block-head">
          <span className="md-block-label">{seg.label || '源码'}</span>
        </div>
        <BlockSourceEditor value={src} docPath={path} onChange={(v) => onChange(v.split('\n'))} onFinish={() => {}} />
      </div>
    );
  }

  if (!editing) {
    return (
      <div
        className={cn('md-block', !html.trim() && 'md-block-empty')}
        data-kind={seg.cls}
        data-editing="false"
        title={seg.cls === 'region' ? '点击编辑这一段' : '点击编辑这一块'}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          onStartEdit({ x: e.clientX, y: e.clientY });
        }}
      >
        {label && (
          <div className="md-block-head">
            <span className="md-block-label">{label}</span>
            <span className="md-block-head-hint">{rendering ? '渲染中…' : '点击编辑'}</span>
          </div>
        )}
        {!html.trim() && <span className="md-block-placeholder">点击开始输入…</span>}
        <div ref={displayRef} className="md-block-rendered" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  return (
    <div className="md-block" data-kind={seg.cls} data-editing="true">
      {label && (
        <div className="md-block-head">
          <span className="md-block-label">{label}</span>
          <span className="md-block-head-hint">Esc 收起</span>
        </div>
      )}
      <BlockSourceEditor
        value={src}
        docPath={path}
        autoFocus
        caretAt={caretAt}
        onChange={(v) => onChange(v.split('\n'))}
        onFinish={onStopEdit}
      />
      <button type="button" className="md-block-done" onClick={onStopEdit}>
        完成
      </button>
    </div>
  );
}
