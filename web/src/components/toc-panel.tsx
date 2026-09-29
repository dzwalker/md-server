import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, List, NotebookPen } from 'lucide-react';
import { useStore } from '@/state/store';
import type { Heading, NoteRef, TocPart } from '@/lib/types';
import { renderExtras } from '@/lib/markdown-extras';
import { notePreview, scrollToNote } from '@/lib/notes';
import { cn } from '@/lib/utils';

interface TocNode {
  /** 标题 id；笔记节点是 `note:<行号>`（不指向 DOM id，点击按行号定位）。 */
  id: string;
  kind: 'heading' | 'note' | 'noteRoot';
  text: string;
  level: number;
  parts?: TocPart[];
  /** 笔记节点：正文里的行号（1-based）。 */
  noteLine?: number;
  children: TocNode[];
}

/** 笔记行号 → 它所属的标题 id（最后一个 data-line-start ≤ 笔记行号的标题）。 */
type NotesByHeading = Map<string, NoteRef[]>;

function noteNode(n: NoteRef, level: number): TocNode {
  return { id: `note:${n.line}`, kind: 'note', text: n.text, level, noteLine: n.line, children: [] };
}

/**
 * 目录树：标题 + （可选）挂在所属标题**下一级**的笔记。
 * 笔记在标题前面的（文首那段）挂在「文首」伪节点下，避免无声消失。
 */
function buildToc(headings: Heading[], notesByHeading: NotesByHeading, rootNotes: NoteRef[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const h of headings) {
    const notes = notesByHeading.get(h.id) || [];
    const node: TocNode = {
      id: h.id,
      kind: 'heading',
      text: h.text,
      level: h.level,
      parts: h.parts,
      children: notes.map((n) => noteNode(n, h.level + 1)),
    };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (!stack.length) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  if (rootNotes.length) {
    roots.unshift({
      id: 'note:root',
      kind: 'noteRoot',
      text: '文首',
      level: 1,
      children: rootNotes.map((n) => noteNode(n, 2)),
    });
  }
  return roots;
}

function flatten(nodes: TocNode[]): TocNode[] {
  const out: TocNode[] = [];
  const walk = (ns: TocNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * 标题里的公式：服务端只吐 `.katex-math` 占位符，这里按片段重建，再交给 renderExtras 用 KaTeX 渲染。
 * math 片段的 key 带上公式原文——React 复用旧节点时 renderExtras 会因 data-md-rendered 跳过，
 * 公式换了却还是旧的渲染结果。
 */
function headingContent(n: TocNode): ReactNode {
  if (!n.parts) return n.text;
  return n.parts.map((p: TocPart, i) =>
    p.type === 'math' ? (
      <span key={`${i}:${p.value}`} className="katex-math">
        {p.value}
      </span>
    ) : (
      <span key={i}>{p.value}</span>
    ),
  );
}

const TOC_NOTES_KEY = 'md-toc-notes';

export function TocPanel() {
  const { activeRender, activeDoc, registerTocControl } = useStore();
  const headings = activeRender?.headings || [];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 笔记开关：默认开（记住上次状态）。
  const [showNotes, setShowNotes] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TOC_NOTES_KEY) !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TOC_NOTES_KEY, showNotes ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [showNotes]);

  const [notesByHeading, setNotesByHeading] = useState<NotesByHeading>(() => new Map());
  const [rootNotes, setRootNotes] = useState<NoteRef[]>([]);

  const tree = useMemo(() => buildToc(headings, notesByHeading, rootNotes), [headings, notesByHeading, rootNotes]);
  const flat = useMemo(() => flatten(tree), [tree]);

  // 笔记直接从正文 DOM 取（`.md-note[data-note-line]`）：与渲染结果天然一致
  // （代码围栏里的「假笔记」不会出现在 DOM 里），也省掉一次接口往返。
  // 归属标题按行号算：用标题上的 data-line-start（见 render.ts 的 srcLinePlugin）。
  useEffect(() => {
    if (!showNotes) {
      setNotesByHeading(new Map());
      setRootNotes([]);
      return;
    }
    const el = document.querySelector('.md-content');
    if (!el) return;
    const heads = Array.from(el.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'))
      .map((h) => ({ id: h.id, line: Number(h.dataset.lineStart || 0) }))
      .filter((h) => h.id && h.line > 0)
      .sort((a, b) => a.line - b.line);
    const notes = Array.from(el.querySelectorAll<HTMLElement>('.md-note[data-note-line]'))
      .map((n) => ({ line: Number(n.dataset.noteLine || 0), text: n.dataset.noteRaw || '' }))
      .filter((n) => n.line > 0)
      .sort((a, b) => a.line - b.line);
    const byHeading: NotesByHeading = new Map();
    const root: NoteRef[] = [];
    for (const note of notes) {
      let owner: string | null = null;
      for (const h of heads) {
        if (h.line <= note.line) owner = h.id;
        else break;
      }
      if (!owner) {
        root.push(note);
        continue;
      }
      const arr = byHeading.get(owner);
      if (arr) arr.push(note);
      else byHeading.set(owner, [note]);
    }
    setNotesByHeading(byHeading);
    setRootNotes(root);
  }, [showNotes, activeDoc, activeRender]);

  useEffect(() => {
    setCollapsed(new Set());
  }, [activeDoc]);

  // 目录里的公式（标题含 $…$）用同一个 KaTeX 二次渲染通道补妆；没公式时这是个空转。
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    void renderExtras(el);
  }, [tree]);

  useEffect(() => {
    if (!flat.length) {
      setActiveId(null);
      return;
    }
    const heads = flat
      .map((n) => (n.kind === 'heading' ? document.getElementById(n.id) : null))
      .filter((el): el is HTMLElement => !!el);
    if (!heads.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) if (en.isIntersecting) setActiveId(en.target.id);
      },
      { rootMargin: '-10% 0px -80% 0px' },
    );
    heads.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, [flat, activeRender]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const expandToLevel = useCallback(
    (n: number) => {
      setCollapsed(new Set(flat.filter((x) => x.children.length && x.level >= n).map((x) => x.id)));
    },
    [flat],
  );
  const openAll = useCallback(() => setCollapsed(new Set()), []);

  // 把「层级」控制暴露给主区头部（放在「目录」按钮后面）
  useEffect(() => {
    registerTocControl({ expandToLevel, openAll });
    return () => registerTocControl(null);
  }, [registerTocControl, expandToLevel, openAll]);

  function onNodeClick(n: TocNode) {
    if (n.kind === 'note' && n.noteLine) {
      scrollToNote(n.noteLine);
      return;
    }
    document.getElementById(n.id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  function render(nodes: TocNode[], depth: number): ReactNode {
    return (
      <ul className={cn(depth > 0 && 'pl-3')}>
        {nodes.map((n) => {
          const isCollapsed = collapsed.has(n.id);
          const isNote = n.kind === 'note';
          return (
            <li key={n.id}>
              <div className="flex items-center">
                {n.children.length ? (
                  <button
                    type="button"
                    className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"
                    onClick={() => toggle(n.id)}
                  >
                    <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', !isCollapsed && 'rotate-90')} />
                  </button>
                ) : (
                  <span className="w-5 shrink-0" />
                )}
                {n.kind === 'noteRoot' ? (
                  <span className="min-w-0 flex-1 truncate px-1.5 py-0.5 text-sm text-muted-foreground">{n.text}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNodeClick(n)}
                    title={isNote ? notePreview(n.text) : undefined}
                    className={cn(
                      'min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-sm hover:bg-accent',
                      isNote
                        ? 'md-toc-note flex items-center gap-1 text-xs text-muted-foreground'
                        : n.level === 1 && 'font-medium',
                      activeId === n.id && 'bg-accent text-accent-foreground',
                    )}
                  >
                    {isNote ? (
                      <>
                        <NotebookPen className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{notePreview(n.text)}</span>
                      </>
                    ) : (
                      headingContent(n)
                    )}
                  </button>
                )}
              </div>
              {n.children.length && !isCollapsed ? render(n.children, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex max-h-[calc(100vh-9rem)] flex-col rounded-lg border bg-sidebar">
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-2">
        <List className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm font-medium">目录</span>
        <button
          type="button"
          onClick={() => setShowNotes((v) => !v)}
          aria-pressed={showNotes}
          title={showNotes ? '隐藏笔记' : '在目录里显示笔记'}
          className={cn(
            'rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground',
            showNotes && 'bg-accent text-accent-foreground',
          )}
        >
          <NotebookPen className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-0 flex-1" />
      </div>
      <div ref={listRef} className="md-toc-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1">
        {!tree.length ? (
          <div className="p-3 text-xs text-muted-foreground">无标题</div>
        ) : (
          render(tree, 0)
        )}
      </div>
    </div>
  );
}
