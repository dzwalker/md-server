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

/**
 * 正文编辑器（单栏，见 specs/doc-editing/）。
 *
 * 交互模型（像 Typora/Obsidian，没有「上面源码、下面预览」的分栏）：
 * - 进入编辑态后整篇仍按**服务端渲染结果**显示（和预览页一模一样）；
 * - 点某一块 → 这一块原地变成源码，但源码是**带格式装饰的**（加粗/斜体/行内代码/链接/
 *   双链/行内公式/图片都按渲染形态显示，标记符号在光标不在其中时隐藏）；
 * - 光标离开 / Esc / 点「完成」→ 这一块回到渲染态（源码变了才重新请求一次服务端渲染）；
 * - 表格 / 围栏代码 / mermaid / 块级公式 / frontmatter / 原始 HTML：空闲时显示服务端渲染
 *   结果，点进去就是源码（「光标进入才显示源码」）。
 *
 * 真源永远是 Markdown 文本：编辑只替换块的源码行，未编辑的行逐字保留。
 */

/** 块类型：决定显示名与「空闲时显示什么」。 */
type BlockKind =
  | 'text'
  | 'note'
  | 'table'
  | 'code'
  | 'mermaid'
  | 'math'
  | 'frontmatter'
  | 'rule'
  | 'footnote'
  | 'html'
  | 'quote'
  | 'list'
  | 'source'
  | 'gap';

interface Segment {
  kind: 'block' | 'gap';
  cls: BlockKind;
  /** 该段覆盖的源码行（不含行尾换行）。 */
  src: string[];
  /** 服务端渲染出的 HTML（`source` 段没有）。 */
  html?: string;
  /** 覆盖 KIND_LABEL 的显示名（如「文档信息」）。 */
  label?: string;
}

interface ParsedBlock {
  start: number;
  end: number;
  cls: BlockKind;
  html: string;
}

/** 编辑器里给非正文块显示的小标签（让用户知道自己在看什么）。 */
const KIND_LABEL: Partial<Record<BlockKind, string>> = {
  table: '表格',
  code: '代码块',
  mermaid: '图表',
  math: '公式块',
  frontmatter: '文档信息',
  rule: '分割线',
  footnote: '脚注',
  html: 'HTML',
};

/** 把服务端渲染出的顶层元素归类（依据标签与 markdown-it 的 class 约定）。 */
function classifyEl(el: Element): { cls: BlockKind; html: string } {
  const tag = el.tagName.toLowerCase();
  const html = (el as HTMLElement).outerHTML;
  if (tag === 'table') return { cls: 'table', html };
  if (tag === 'pre') return { cls: el.classList.contains('mermaid-src') ? 'mermaid' : 'code', html };
  if (tag === 'hr') return { cls: 'rule', html };
  if (tag === 'details' && el.classList.contains('md-frontmatter')) return { cls: 'frontmatter', html };
  if (tag === 'span' && el.classList.contains('katex-block')) return { cls: 'math', html };
  if (tag === 'section' && el.classList.contains('footnotes')) return { cls: 'footnote', html };
  if (tag === 'div' && el.classList.contains('md-note')) return { cls: 'note', html };
  if (tag === 'blockquote') return { cls: 'quote', html };
  if (tag === 'ul' || tag === 'ol') return { cls: 'list', html };
  if (tag === 'p' || /^h[1-6]$/.test(tag)) {
    return { cls: 'text', html };
  }
  return { cls: 'html', html };
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

/** 把整篇源码按块区间切成段：块之间的空白行 → gap，块之间夹着的非空行 → source 源码块。 */
export function buildSegments(text: string, html: string): Segment[] {
  const lines = text.split('\n');
  const total = lines.length;
  const blocks = parseBlocks(html, total);
  const segs: Segment[] = [];
  let cursor = 0;
  const pushUncovered = (from: number, to: number) => {
    if (to <= from) return;
    const src = lines.slice(from, to);
    // 纯空行区间只是排版空白：保留原文用于回写，但不在编辑区显示输入框。
    if (src.every((l) => l.trim() === '')) segs.push({ kind: 'gap', cls: 'gap', src });
    else segs.push({ kind: 'block', cls: 'source', src });
  };
  for (const b of blocks) {
    pushUncovered(cursor, b.start - 1);
    segs.push({ kind: 'block', cls: b.cls, src: lines.slice(b.start - 1, b.end), html: b.html });
    cursor = b.end;
  }
  pushUncovered(cursor, total);

  // 顶部 frontmatter 的渲染结果不带行号锚点（见 render.test.ts 的约定：它不是笔记定位目标），
  // 所以它落进源码段；这里给它一个准确的名字，避免只写「源码」。
  if (lines[0] === '---') {
    const close = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
    if (close > 0) {
      const seg = segs.find((x) => x.kind === 'block' && x.cls === 'source' && x.src.length >= close + 1);
      if (seg) seg.label = '文档信息（YAML）';
    }
  }

  // 空文档：没有任何块时给一个空的**文本块**（不是源码块）——新建文件后第一次输入
  // 也应该按富文本的方式编辑。
  if (!segs.some((s) => s.kind === 'block')) {
    const firstGap = segs.findIndex((s) => s.kind === 'gap');
    if (firstGap >= 0) segs[firstGap] = { kind: 'block', cls: 'text', src: segs[firstGap].src };
    else segs.push({ kind: 'block', cls: 'text', src: [''] });
  }
  return segs;
}

/** 段序列 → 整篇源码（段与段之间补回换行）。 */
function segmentsText(segs: Segment[]): string {
  return segs.map((s) => s.src.join('\n')).join('\n');
}

export interface DocEditorHandle {
  /** 保存：force=true 时不带 mtime（用户确认「覆盖保存」）。失败会抛错。 */
  save: (opts?: { force?: boolean }) => Promise<void>;
  isDirty: () => boolean;
}

interface DocEditorProps {
  path: string;
  /** 保存成功：父组件负责退出编辑态并重渲染这篇文档。 */
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** 保存失败（非冲突）时给父组件的提示。 */
  onError?: (message: string) => void;
}

export const DocEditor = forwardRef<DocEditorHandle, DocEditorProps>(function DocEditor(
  { path, onSaved, onDirtyChange, onError },
  ref,
) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 正在编辑的块 + 点进来时的鼠标位置（用于把光标放到点到的位置）。 */
  const [active, setActive] = useState<{ index: number; caret?: { x: number; y: number } } | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const eolRef = useRef('\n');
  const mtimeRef = useRef<number | undefined>(undefined);
  const originalRef = useRef('');

  /** 载入磁盘原文 + 服务端渲染，切成块段。 */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const raw = await api.rawFile(path);
      const eol = raw.content.includes('\r\n') ? '\r\n' : '\n';
      const text = raw.content.replace(/\r\n/g, '\n');
      const r = await api.renderBlock(path, text);
      eolRef.current = eol;
      mtimeRef.current = raw.mtimeMs;
      originalRef.current = text;
      setSegments(buildSegments(text, r.html));
      setSourceText(text);
      setActive(null);
      setConflict(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const text = useMemo(() => {
    if (sourceMode) return sourceText;
    return segments ? segmentsText(segments) : '';
  }, [segments, sourceMode, sourceText]);

  const dirty = !loading && !loadError && text !== originalRef.current;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /** 改某一段的源码（编辑块时调用）。 */
  const setSegmentSrc = useCallback((index: number, src: string[]) => {
    setSegments((cur) => {
      if (!cur) return cur;
      const next = cur.slice();
      next[index] = { ...next[index], src };
      return next;
    });
  }, []);

  const doSave = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!segments && !sourceMode) return;
      setSaving(true);
      setConflict(false);
      try {
        const content = text.replace(/\n/g, eolRef.current);
        await api.saveDoc({
          path,
          content,
          mtimeMs: opts?.force ? undefined : mtimeRef.current,
        });
        originalRef.current = text;
        onSaved();
      } catch (e) {
        const msg = e instanceof Error ? e.message : '保存失败';
        // 409 是并发冲突：磁盘在编辑期间被别处改过。不覆盖，交给用户选择。
        // 冲突条本身已经说明了原因，不再额外弹一条同样的轻提示。
        if (/外部修改/.test(msg)) setConflict(true);
        else onError?.(msg);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [path, text, segments, sourceMode, onSaved, onError],
  );

  useImperativeHandle(
    ref,
    () => ({
      save: doSave,
      isDirty: () => dirty,
    }),
    [doSave, dirty],
  );

  /** 整篇源码 ↔ 单栏编辑：从源码模式切回来要按当前源码重新分块（块结构可能已经变了）。 */
  const toggleSourceMode = useCallback(async () => {
    if (!sourceMode) {
      setSourceText(segments ? segmentsText(segments) : '');
      setActive(null);
      setSourceMode(true);
      return;
    }
    setSourceMode(false);
    setLoading(true);
    try {
      const r = await api.renderBlock(path, sourceText);
      setSegments(buildSegments(sourceText, r.html));
    } catch {
      /* 渲染失败也要能继续编辑：按纯源码块展示 */
      setSegments([{ kind: 'block', cls: 'source', src: sourceText.split('\n') }]);
    } finally {
      setLoading(false);
      setActive(null);
    }
  }, [path, segments, sourceMode, sourceText]);

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
    <div className="md-editor px-6 py-6">
      <div className="md-editor-toolbar">
        <span className="md-editor-hint">
          {dirty ? '有未保存的修改' : '未修改'} · 点任意块编辑，Esc 收起，⌘S 保存
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => void toggleSourceMode()}>
          {sourceMode ? '单栏编辑' : '整篇源码'}
        </Button>
      </div>

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

      {sourceMode ? (
        <textarea
          className="md-editor-source"
          value={sourceText}
          spellCheck={false}
          onChange={(e) => setSourceText(e.target.value)}
        />
      ) : (
        <div className="md-editor-blocks">
          {(segments ?? []).map((seg, i) =>
            seg.kind === 'gap' ? (
              <div key={i} className="md-editor-gap" />
            ) : (
              <BlockEditor
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

interface BlockEditorProps {
  path: string;
  seg: Segment;
  editing: boolean;
  caretAt?: { x: number; y: number };
  onStartEdit: (caret?: { x: number; y: number }) => void;
  onStopEdit: () => void;
  onChange: (src: string[]) => void;
}

/**
 * 单块：渲染态 ↔ 源码态。
 *
 * 源码态用 CodeMirror 单栏编辑（带格式装饰）；收起时若源码变了，只重新渲染这一块，
 * 不整篇重载 —— 保持滚动位置与其它块的渲染成果。
 */
function BlockEditor({ path, seg, editing, caretAt, onStartEdit, onStopEdit, onChange }: BlockEditorProps) {
  const src = seg.src.join('\n');
  const label = seg.label || KIND_LABEL[seg.cls];
  const displayRef = useRef<HTMLDivElement>(null);
  // 当前 html 对应的源码：收起时据此判断「这一块到底改没改」。
  const htmlSrcRef = useRef(src);
  const srcRef = useRef(src);
  srcRef.current = src;
  const [html, setHtml] = useState(seg.html ?? '');
  const [rendering, setRendering] = useState(false);

  // 渲染态下的二次渲染（KaTeX / mermaid）：只在块处于渲染态时做。
  useEffect(() => {
    if (editing || !displayRef.current) return;
    void renderExtras(displayRef.current);
  }, [editing, html]);

  // 收起编辑后，源码变了就重新渲染这一块（只请求一次，不等输入）。
  useEffect(() => {
    if (editing) return;
    if (seg.cls === 'source') return; // 纯源码段没有整体渲染
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

  // 纯源码段（未被渲染结果覆盖的行，如原始 HTML 块、脚注定义、YAML 头）：
  // 没有整体渲染结果，直接给源码编辑器（也是带装饰的）。
  if (seg.cls === 'source') {
    return (
      <div className="md-block" data-kind={seg.cls}>
        <div className="md-block-head">
          <span className="md-block-label">{seg.label || '源码'}</span>
        </div>
        <BlockSourceEditor
          value={src}
          docPath={path}
          onChange={(v) => onChange(v.split('\n'))}
          onFinish={() => {}}
        />
      </div>
    );
  }

  if (!editing) {
    return (
      <div
        className={cn('md-block', !html.trim() && 'md-block-empty')}
        data-kind={seg.cls}
        data-editing="false"
        title="点击编辑这一块"
        onClick={(e) => {
          // 渲染态里链接/图片不该跳转（编辑态不导航），mermaid 工具条按钮除外。
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
        {/* md-content：复用预览页那一整套排版样式（标题/表格/代码/引用/列表/图片…） */}
        <div
          ref={displayRef}
          className="md-block-rendered md-content"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  return (
    <div className="md-block" data-kind={seg.cls} data-editing="true">
      {/* 有标签的块（表格/代码/图表…）两个状态都保留同一行标签，高度不变；正文块没有标签 */}
      {label && (
        <div className="md-block-head">
          <span className="md-block-label">{label}</span>
          <span className="md-block-head-hint">Esc 收起</span>
        </div>
      )}
      {seg.cls === 'quote' ? (
        <div className="md-quote-edit">
          <BlockSourceEditor
            value={src}
            docPath={path}
            autoFocus
            caretAt={caretAt}
            onChange={(v) => onChange(v.split('\n'))}
            onFinish={onStopEdit}
          />
        </div>
      ) : seg.cls === 'list' ? (
        <div className="md-list-edit">
          <BlockSourceEditor
            value={src}
            docPath={path}
            autoFocus
            caretAt={caretAt}
            onChange={(v) => onChange(v.split('\n'))}
            onFinish={onStopEdit}
          />
        </div>
      ) : seg.cls === 'note' ? (
        <div className="md-note md-note-editing">
          <div className="md-note-label">笔记</div>
          <BlockSourceEditor
            value={src}
            docPath={path}
            autoFocus
            caretAt={caretAt}
            onChange={(v) => onChange(v.split('\n'))}
            onFinish={onStopEdit}
          />
        </div>
      ) : (
        <BlockSourceEditor
          value={src}
          docPath={path}
          autoFocus
          caretAt={caretAt}
          onChange={(v) => onChange(v.split('\n'))}
          onFinish={onStopEdit}
        />
      )}
      {/* 悬浮在右侧，不占布局高度 */}
      <button type="button" className="md-block-done" onClick={onStopEdit}>
        完成
      </button>
    </div>
  );
}
