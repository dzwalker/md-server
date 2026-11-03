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

/**
 * 正文块编辑器（见 specs/doc-editing/）。
 *
 * 设计要点：
 * 1. **唯一真源是整篇源码**：进入编辑时取磁盘原文，按服务端渲染结果里的
 *    `data-line-start/data-line-end` 锚点切成「行区间段」；编辑某一块就是替换这一段的源码行，
 *    未编辑的行逐字保留（空行 / frontmatter / 脚注定义都不会丢）。
 * 2. **格式实时渲染**：活跃块每次输入（防抖 250ms）把这一块的源码交给
 *    `POST /api/render-block`（服务端同一套 markdown-it 管线，目录/术语表上下文一致），
 *    在块下方显示实时预览。表格 / 代码 / 图表 / 块级公式 / 原始 HTML 等重型块**不**实时渲染
 *    （列宽抖动、3.3MB mermaid 库、光标跳动），只在失焦或点「预览」时渲染一次。
 * 3. **块与块之间的空白行不进编辑区**：它们只是排版，按原样保留在段序列里。
 * 4. 文本域里 Enter 换行、Tab 插两个空格、Esc 收起草稿回到渲染态；⌘S 保存由父组件接。
 */

/** 块类型：决定「编辑时是否实时预览」与界面上给的小标签。 */
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

/** 只有这几类块值得实时渲染：段落/标题/列表/引用（text）与笔记卡片（note）。 */
const LIVE_KINDS = new Set<BlockKind>(['text', 'note']);

/** 编辑器里给非实时块显示的小标签（让用户知道自己在看什么）。 */
const KIND_LABEL: Partial<Record<BlockKind, string>> = {
  table: '表格',
  code: '代码块',
  mermaid: '图表',
  math: '公式块',
  frontmatter: '文档信息',
  rule: '分割线',
  footnote: '脚注',
  html: 'HTML',
  source: '源码',
};

/** 把服务端渲染出的顶层元素归类（判断依据是标签与 markdown-it 的 class 约定）。 */
function classifyEl(el: Element): { cls: BlockKind; html: string } {
  const tag = el.tagName.toLowerCase();
  const html = (el as HTMLElement).outerHTML;
  if (tag === 'table') return { cls: 'table', html };
  if (tag === 'pre') {
    return { cls: el.classList.contains('mermaid-src') ? 'mermaid' : 'code', html };
  }
  if (tag === 'hr') return { cls: 'rule', html };
  if (tag === 'details' && el.classList.contains('md-frontmatter')) return { cls: 'frontmatter', html };
  if (tag === 'span' && el.classList.contains('katex-block')) return { cls: 'math', html };
  if (tag === 'section' && el.classList.contains('footnotes')) return { cls: 'footnote', html };
  if (tag === 'div' && el.classList.contains('md-note')) return { cls: 'note', html };
  if (tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'ul' || tag === 'ol' || tag === 'blockquote') {
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
  // 也应该有实时预览，而不是从「源码」模式开始。
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
  const [active, setActive] = useState<number | null>(null);
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

  /** 整篇源码 ↔ 分块：从源码模式切回来要按当前源码重新分块（块结构可能已经变了）。 */
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
          {dirty ? '有未保存的修改' : '未修改'} · 点任意块编辑，⌘S 保存
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => void toggleSourceMode()}>
          {sourceMode ? '分块编辑' : '整篇源码'}
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
              <div key={i} className="md-editor-gap" style={{ height: `${Math.min(seg.src.length, 4) * 0.6}em` }} />
            ) : (
              <BlockEditor
                key={i}
                path={path}
                seg={seg}
                editing={active === i}
                onStartEdit={() => setActive(i)}
                onStopEdit={() => setActive((cur) => (cur === i ? null : cur))}
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
  onStartEdit: () => void;
  onStopEdit: () => void;
  onChange: (src: string[]) => void;
}

/** 单块编辑器：渲染态 ↔ 源码态；live 块在源码态下方显示实时预览。 */
function BlockEditor({ path, seg, editing, onStartEdit, onStopEdit, onChange }: BlockEditorProps) {
  const src = seg.src.join('\n');
  const live = LIVE_KINDS.has(seg.cls);
  const label = KIND_LABEL[seg.cls];
  const displayRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 渲染态用的 HTML：编辑过的块用「最新一次服务端渲染结果」，否则用服务端整篇渲染里的那一段。
  const [html, setHtml] = useState(seg.html ?? '');
  // live 块的实时预览；非 live 块只在失焦/点「预览」时更新一次。
  const [previewHtml, setPreviewHtml] = useState(seg.html ?? '');
  const [rendering, setRendering] = useState(false);
  // 组字结束后不一定有新输入事件：用一个计数器把预览 effect 再踢一次。
  const [tick, setTick] = useState(0);
  const srcRef = useRef(src);
  // 当前 `html` / `previewHtml` 对应的源码：失焦时用来判断「这一块到底改没改」。
  const renderedSrcRef = useRef(src);

  srcRef.current = src;

  /** 调服务端渲染这一段源码。 */
  const renderBlock = useCallback(async (): Promise<string | null> => {
    try {
      const r = await api.renderBlock(path, srcRef.current);
      renderedSrcRef.current = srcRef.current;
      return r.html;
    } catch {
      return null;
    }
  }, [path]);

  // live 块：输入防抖后实时预览（中文输入法组字期间不发请求）。
  const composingRef = useRef(false);
  useEffect(() => {
    if (!editing || !live) return;
    const id = window.setTimeout(() => {
      if (composingRef.current) return;
      setRendering(true);
      void renderBlock().then((next) => {
        if (next !== null) {
          setPreviewHtml(next);
          // 预览已经是最新渲染：失焦时就不必再请求一次。
          if (srcRef.current === renderedSrcRef.current) setHtml(next);
        }
        setRendering(false);
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [editing, live, src, renderBlock, tick]);

  // 渲染态下的二次渲染（KaTeX / mermaid）：只在块处于渲染态时做。
  useEffect(() => {
    if (editing || !displayRef.current) return;
    void renderExtras(displayRef.current);
  }, [editing, html]);

  // 预览区里的公式（KaTeX）需要客户端渲染。
  useEffect(() => {
    if (!editing || !live || !previewRef.current) return;
    void renderExtras(previewRef.current);
  }, [editing, live, previewHtml]);

  // 进入源码态：自适应高度 + 聚焦并把光标放到末尾。
  useEffect(() => {
    if (!editing) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, 40)}px`;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [editing]);

  // 常驻文本域（源码块）挂载后也要自适应高度。
  useEffect(() => {
    if (seg.cls !== 'source' || editing) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, 40)}px`;
  }, [seg.cls, editing, src]);

  const autosize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, 40)}px`;
  }, []);

  /** 收起源码态：内容变了就重新渲染一次（失焦渲染），没变直接回渲染态。 */
  const finish = useCallback(async () => {
    onStopEdit();
    if (srcRef.current === renderedSrcRef.current) return;
    setRendering(true);
    const next = await renderBlock();
    if (next !== null) {
      setHtml(next);
      setPreviewHtml(next);
    }
    setRendering(false);
  }, [onStopEdit, renderBlock]);

  if (!editing) {
    // 纯源码段（未被渲染结果覆盖的行，如原始 HTML 块、脚注定义）：没有整体渲染结果，
    // 一直显示源码框（直接可编辑）；想看渲染效果就点「预览」渲染一次。
    if (seg.cls === 'source') {
      return (
        <div className="md-block" data-kind={seg.cls}>
          <div className="md-block-head">
            <span className="md-block-label">{seg.label || '源码'}</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-1.5 text-xs"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setRendering(true);
                void renderBlock().then((next) => {
                  if (next !== null) setPreviewHtml(next);
                  setRendering(false);
                });
              }}
            >
              预览{rendering ? '中…' : ''}
            </Button>
          </div>
          <textarea
            ref={taRef}
            className="md-block-source"
            value={src}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value.split('\n'))}
            onInput={autosize}
          />
          {previewHtml && (
            <div className="md-block-preview md-content" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
        </div>
      );
    }
    return (
      <div
        className={cn('md-block', !html.trim() && 'md-block-empty')}
        data-kind={seg.cls}
        title="点击编辑这一块"
        onClick={(e) => {
          // 渲染态里链接/图片不该跳转（编辑态不导航），mermaid 工具条按钮除外。
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          onStartEdit();
        }}
      >
        {!html.trim() && <span className="md-block-placeholder">点击开始输入…</span>}
        {label && (
          <div className="md-block-head">
            <span className="md-block-label">{label}</span>
            <span className="md-block-head-hint">点击编辑</span>
          </div>
        )}
        <div ref={displayRef} className="md-block-rendered" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  return (
    <div className={cn('md-block md-block-editing')} data-kind={seg.cls}>
      <div className="md-block-head">
        <span className="md-block-label">{label || '编辑中'}</span>
        <button
          type="button"
          className="md-block-done"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void finish()}
        >
          完成
        </button>
      </div>
      <textarea
        ref={taRef}
        className="md-block-source"
        value={src}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        onInput={autosize}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          setTick((v) => v + 1);
        }}
        onBlur={() => void finish()}
        onKeyDown={(e) => {
          // 中文输入法组字过程中的按键不算
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            void finish();
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const ta = e.currentTarget;
            const { selectionStart, selectionEnd, value } = ta;
            const next = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd);
            onChange(next.split('\n'));
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = selectionStart + 2;
              autosize();
            });
          }
        }}
      />
      {live && (
        <div className="md-block-preview-wrap">
          <span className="md-block-preview-label">
            实时预览{rendering ? ' · 渲染中…' : ''}
          </span>
          <div
            ref={previewRef}
            className="md-block-preview md-content"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      )}
      {!live && (
        <div className="md-block-preview-wrap">
          <span className="md-block-preview-label">
            该块不实时渲染{rendering ? ' · 渲染中…' : ''}（失焦或点「预览」后渲染一次）
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setRendering(true);
              void renderBlock().then((next) => {
                if (next !== null) setPreviewHtml(next);
                setRendering(false);
              });
            }}
          >
            预览
          </Button>
          {previewHtml && (
            <div
              className="md-block-preview md-content"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </div>
      )}
    </div>
  );
}
