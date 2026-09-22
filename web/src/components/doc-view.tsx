import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Star, ListTree, Layers, PanelLeftOpen, Download } from 'lucide-react';
import { useStore, type OpenDoc } from '@/state/store';
import { api } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import type { Backlink, RenderResult } from '@/lib/types';
import { cn, stripMdExt } from '@/lib/utils';
import { renderExtras, highlightContent } from '@/lib/markdown-extras';
import { findAnchor, resolveMarkdownLink, resolveWikilink } from '@/lib/doc-links';
import { Button } from '@/components/ui/button';
import { useElementSize } from '@/hooks/use-element-size';
import { GraphView } from './graph-view';
import { TocPanel } from './toc-panel';
import {
  MD_MAX_WIDTH,
  PADDING_X,
  TOC_FLOAT_BREAKPOINT,
  TOC_GAP,
} from '@/lib/toc';

interface TabProps {
  doc: OpenDoc;
  active: boolean;
  showFilename: boolean;
  onActivate: () => void;
  onClose: () => void;
}

function SortableTab({ doc, active, showFilename, onActivate, onClose }: TabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: doc.path,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const isToolDoc = doc.path.startsWith('/__tools__/');
  const label = showFilename && !isToolDoc ? (stripMdExt(doc.path.split('/').pop() || '') || doc.title) : doc.title;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-active={active || undefined}
      className={cn(
        'group flex shrink-0 cursor-grab items-center gap-1.5 rounded-md px-3 py-1 text-sm',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        isDragging && 'z-10 opacity-60',
      )}
    >
      <span className="max-w-40 truncate" onClick={onActivate}>
        {label}
      </span>
      <button
        type="button"
        className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted-foreground/20 hover:text-foreground group-hover:opacity-100"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="关闭"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function DocView({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const {
    openDocs,
    activeDoc,
    activateDoc,
    closeDoc,
    reorderDocs,
    activeRender,
    cacheRender,
    activeQuery,
    dataVersion,
    openDoc,
    toggleFavorite,
    isFavorite,
    showFilename,
    mdTheme,
    mermaidTheme,
    tocWidth,
    tocExpandTo,
    tocOpenAll,
    fileIndex,
    scrollTarget,
    clearScrollTarget,
  } = useStore();

  const contentRef = useRef<HTMLDivElement>(null);
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const { ref: contentAreaRef, width: contentWidth } = useElementSize<HTMLDivElement>();
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [outlinks, setOutlinks] = useState<string[]>([]);
  const [tocOpen, setTocOpen] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // 工具型「文档」（如图谱）用保留路径 /__tools__/... 打开为 tab
  const isTool = !!activeDoc && activeDoc.startsWith('/__tools__/');

  // 拦截正文里对其它文档的链接：不整页刷新，走 SPA 打开新 tab 并带上锚点位置。
  function onContentClick(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;

    // 1) [[双链]]（服务端已渲染成 <a class="wikilink" data-target=... data-anchor=...>）
    if (a.classList.contains('wikilink')) {
      e.preventDefault();
      const wTarget = a.getAttribute('data-target') || '';
      const wAnchor = a.getAttribute('data-anchor') || '';
      const r = resolveWikilink(wTarget, fileIndex);
      if (r) openDoc(r.path, r.title, null, wAnchor || undefined);
      return;
    }

    const href = a.getAttribute('href') || '';
    if (!href) return;

    // 纯 #锚点（同文档内跳转）
    if (href.startsWith('#')) {
      e.preventDefault();
      let anchor = href.slice(1);
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        /* ignore */
      }
      const el = contentRef.current ? findAnchor(contentRef.current, anchor) : null;
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
      return;
    }

    // 外部链接 / 协议 / 绝对 //：交给浏览器
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(href) || href.startsWith('//')) return;

    // 带非 md 扩展名视为资源（图片/pdf 等）：交给浏览器
    const clean = href.split('#')[0].split('?')[0];
    const lastSeg = clean.split('/').pop() || '';
    if (lastSeg.includes('.') && !/\.(md|markdown)$/i.test(clean)) return;

    // 内部文档链接
    e.preventDefault();
    const { path, anchor } = resolveMarkdownLink(href, activeDoc);
    if (path && fileIndex.has(path)) {
      openDoc(path, fileIndex.get(path)!, null, anchor || undefined);
    }
  }

  // 带锚点打开文档后，等正文渲染进 DOM 再滚动到目标位置。
  useEffect(() => {
    if (!scrollTarget || !activeRender || scrollTarget.path !== activeDoc) return;
    const el = contentRef.current;
    if (!el) return;
    const targetEl = findAnchor(el, scrollTarget.anchor);
    if (targetEl) targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
    clearScrollTarget();
  }, [activeRender, activeDoc, scrollTarget, clearScrollTarget]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // 仅当当前文档还没缓存时才拉取：切换 tab 时已缓存的文档直接无缝显示，不重新请求。
  useEffect(() => {
    if (!activeDoc || activeDoc.startsWith('/__tools__/')) return;
    if (activeRender) return;
    let alive = true;
    api
      .render(activeDoc)
      .then((r) => {
        if (alive) cacheRender(activeDoc, r);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [activeDoc, activeRender, cacheRender]);

  // 文件更新时只刷新「当前打开的这篇」：轮询轻量 /api/stat（走索引，毫秒级），
  // mtime 变了才重新拉正文，避免 dataVersion 一变就重注入整篇（大文档会被重复解析几秒）。
  const renderRef = useRef<RenderResult | null>(activeRender);
  renderRef.current = activeRender;
  useEffect(() => {
    if (!activeDoc || activeDoc.startsWith('/__tools__/')) return;
    let alive = true;
    const check = async () => {
      try {
        const s = await api.stat(activeDoc);
        if (!alive || !s.exists) return;
        const cur = renderRef.current;
        if (!cur || cur.mtimeMs === s.mtimeMs) return;
        const r = await api.render(activeDoc);
        if (alive) cacheRender(activeDoc, r);
      } catch {
        /* ignore */
      }
    };
    const id = window.setInterval(check, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [activeDoc, cacheRender]);

  useEffect(() => {
    if (!activeDoc || activeDoc.startsWith('/__tools__/')) {
      setBacklinks([]);
      setOutlinks([]);
      return;
    }
    let alive = true;
    api
      .backlinks(activeDoc)
      .then((b) => {
        if (alive) setBacklinks(b);
      })
      .catch(() => {
        /* ignore */
      });
    api
      .outlinks(activeDoc)
      .then((o) => {
        if (alive) setOutlinks(o);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [activeDoc, dataVersion]);

  // 正文二次渲染（数学/图表/关键词高亮）延后到首屏绘制之后，先出正文再“补妆”，
  // 避免长文档在注入 HTML 的同一帧里再做一遍全量扫描。
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !activeRender) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void renderExtras(el);
      highlightContent(el, activeQuery);
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (typeof ric === 'function') {
      const id = ric(run, { timeout: 200 });
      return () => { cancelled = true; if (typeof cic === 'function') cic(id); };
    }
    const id = window.setTimeout(run, 0);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [activeRender, activeQuery]);

  // mermaid 主题切换后，把正文重置回服务端占位符并整体重渲染，让图表立即换肤。
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !activeRender) return;
    el.innerHTML = activeRender.html;
    void renderExtras(el);
    highlightContent(el, activeQuery);
  }, [mermaidTheme]);

  // 切换文档时，把当前 tab 滚动到可见位置
  useEffect(() => {
    const bar = tabsBarRef.current;
    if (!bar) return;
    const active = bar.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeDoc]);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const from = openDocs.findIndex((d) => d.path === active.id);
      const to = openDocs.findIndex((d) => d.path === over.id);
      if (from >= 0 && to >= 0) reorderDocs(from, to);
    }
  }

  // 下载当前文档的原始 md 文件（走 /api/files/*，拿到的是磁盘原文而不是渲染结果）。
  async function onDownload() {
    if (!activeDoc || isTool || downloading) return;
    const fallback = activeDoc.split('/').pop() || 'document.md';
    setDownloading(true);
    try {
      const f = await api.rawFile(activeDoc);
      downloadBlob(new Blob([f.content], { type: 'text/markdown;charset=utf-8' }), f.name || fallback);
    } catch (err) {
      console.warn('下载失败：', err);
    } finally {
      setDownloading(false);
    }
  }

  // TOC 响应式布局：宽→md 固定 980；中→压缩 md；窄→TOC 悬浮覆盖
  const measured = contentWidth > 0;
  const w = measured ? contentWidth : 4096;
  const tocFootprint = tocWidth + TOC_GAP;
  const floatToc = tocOpen && measured && contentWidth < TOC_FLOAT_BREAKPOINT;
  const inlineToc = tocOpen && !floatToc;
  const mdMax = Math.min(
    MD_MAX_WIDTH,
    Math.max(0, w - PADDING_X - (inlineToc ? tocFootprint : 0)),
  );
  const containerMax = Math.min(
    w,
    MD_MAX_WIDTH + (inlineToc ? tocFootprint : 0) + PADDING_X,
  );

  const activeDocInfo = openDocs.find((d) => d.path === activeDoc);
  const title = isTool
    ? activeDocInfo?.title || '工具'
    : activeRender?.title || activeDoc || '选择文件查看';
  const fav = !!activeDoc && !isTool && isFavorite(activeDoc);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center">
        {onOpenSidebar && (
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="打开侧栏"
            title="打开侧栏"
            className="ml-1 flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={openDocs.map((d) => d.path)} strategy={horizontalListSortingStrategy}>
            <div
              ref={tabsBarRef}
              onWheel={(e) => {
                if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
              }}
              className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1.5"
            >
              {openDocs.map((d) => (
                <SortableTab
                  key={d.path}
                  doc={d}
                  active={d.path === activeDoc}
                  showFilename={showFilename}
                  onActivate={() => activateDoc(d.path)}
                  onClose={() => closeDoc(d.path)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 px-5 pb-2 pt-3">
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
        {activeDoc && !isTool && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8', !fav && 'text-muted-foreground')}
              onClick={() => toggleFavorite(activeDoc)}
              title="收藏 / 取消收藏"
            >
              <Star className={cn('h-4 w-4', fav && 'fill-current text-yellow-500')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={onDownload}
              disabled={downloading}
              title="下载 Markdown 文件"
            >
              <Download className="h-4 w-4" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-8 gap-1.5', tocOpen && 'bg-muted text-foreground')}
          onClick={() => setTocOpen((v) => !v)}
          title="目录"
        >
          <ListTree className="h-4 w-4" /> 目录
        </Button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Layers className="h-4 w-4 text-muted-foreground" />
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => tocExpandTo(1)} title="展开到一级">
          1
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => tocExpandTo(2)} title="展开到二级">
          2
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => tocExpandTo(3)} title="展开到三级">
          3
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={tocOpenAll} title="全部展开">
          a
        </Button>
      </div>

      <div
        ref={contentAreaRef}
        className={cn('relative min-h-0 flex-1 overflow-auto', !isTool && 'md-theme-' + mdTheme)}
      >
        {isTool ? (
          <GraphView onOpen={(path, title) => openDoc(path, title)} />
        ) : activeDoc ? (
          <div
            className="mx-auto flex w-full items-start px-6 py-6"
            style={{ maxWidth: containerMax, gap: TOC_GAP }}
          >
            <div className="min-w-0 flex-1" style={{ maxWidth: mdMax }}>
              <div
                ref={contentRef}
                className="md-content"
                onClick={onContentClick}
                dangerouslySetInnerHTML={{ __html: activeRender?.html || '' }}
              />
              {backlinks.length > 0 && (
                <div className="mt-8 border-t pt-4">
                  <h2 className="text-sm font-semibold">🔗 反向链接 ({backlinks.length})</h2>
                  <ul className="mt-2 space-y-1 text-sm">
                    {backlinks.map((b) => (
                      <li key={b.path}>
                        <button className="text-primary hover:underline" onClick={() => openDoc(b.path, b.title)}>
                          {b.title || b.path}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {outlinks.length > 0 && (
                <div className="mt-6">
                  <h2 className="text-sm font-semibold">↗ 出链 ({outlinks.length})</h2>
                  <ul className="mt-2 space-y-1 text-sm">
                    {outlinks.map((n) => (
                      <li key={n} className="text-muted-foreground">
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {inlineToc && (
              <aside className="sticky top-6 shrink-0 self-start" style={{ width: tocWidth }}>
                <TocPanel />
              </aside>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            选择文件查看
          </div>
        )}

        {floatToc && (
          <div className="absolute right-4 top-4 z-20" style={{ width: tocWidth }}>
            <div className="shadow-lg">
              <TocPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
