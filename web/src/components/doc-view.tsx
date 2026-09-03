import { useEffect, useRef, useState } from 'react';
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
import { X, Star, Pin, Network, ListTree } from 'lucide-react';
import { useStore, type OpenDoc } from '@/state/store';
import { api } from '@/lib/api';
import type { Backlink } from '@/lib/types';
import { cn } from '@/lib/utils';
import { renderExtras, highlightContent } from '@/lib/markdown-extras';
import { Button } from '@/components/ui/button';
import { GraphView } from './graph-view';

interface TabProps {
  doc: OpenDoc;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}

function SortableTab({ doc, active, onActivate, onClose }: TabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: doc.path,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group flex shrink-0 cursor-grab items-center gap-1.5 rounded-md px-3 py-1 text-sm',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        isDragging && 'z-10 opacity-60',
      )}
    >
      <span className="max-w-40 truncate" onClick={onActivate}>
        {doc.title}
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

interface DocViewProps {
  tocCollapsed: boolean;
  onOpenToc: () => void;
}

export function DocView({ tocCollapsed, onOpenToc }: DocViewProps) {
  const {
    openDocs,
    activeDoc,
    activateDoc,
    closeDoc,
    reorderDocs,
    activeRender,
    setActiveRender,
    activeQuery,
    openDoc,
    toggleFavorite,
    setFavorite,
    isFavorite,
    isPinned,
  } = useStore();

  const contentRef = useRef<HTMLDivElement>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [outlinks, setOutlinks] = useState<string[]>([]);
  const [graphOpen, setGraphOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!activeDoc) {
      setActiveRender(null);
      return;
    }
    setActiveRender(null);
    let alive = true;
    api
      .render(activeDoc)
      .then((r) => {
        if (alive) setActiveRender(r);
      })
      .catch(() => {
        if (alive) setActiveRender(null);
      });
    return () => {
      alive = false;
    };
  }, [activeDoc, setActiveRender]);

  useEffect(() => {
    if (!activeDoc) {
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
  }, [activeDoc]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || !activeRender) return;
    void renderExtras(el);
    highlightContent(el, activeQuery);
  }, [activeRender, activeQuery]);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const from = openDocs.findIndex((d) => d.path === active.id);
      const to = openDocs.findIndex((d) => d.path === over.id);
      if (from >= 0 && to >= 0) reorderDocs(from, to);
    }
  }

  const title = activeRender?.title || activeDoc || '选择文件查看';
  const fav = !!activeDoc && isFavorite(activeDoc);
  const pinned = !!activeDoc && isPinned(activeDoc);

  return (
    <div className="flex h-full flex-col">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={openDocs.map((d) => d.path)} strategy={horizontalListSortingStrategy}>
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1.5">
            {openDocs.map((d) => (
              <SortableTab
                key={d.path}
                doc={d}
                active={d.path === activeDoc}
                onActivate={() => activateDoc(d.path)}
                onClose={() => closeDoc(d.path)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex shrink-0 items-center gap-1.5 px-5 pb-2 pt-3">
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
        {activeDoc && (
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
              className={cn('h-8 w-8', !pinned && 'text-muted-foreground')}
              onClick={() => setFavorite(activeDoc, !pinned)}
              title="置顶 / 取消置顶"
            >
              <Pin className={cn('h-4 w-4', pinned && 'fill-current')} />
            </Button>
          </>
        )}
        {tocCollapsed && (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onOpenToc} title="打开目录">
            <ListTree className="h-4 w-4" /> 目录
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setGraphOpen((v) => !v)}>
          <Network className="h-4 w-4" /> 图谱
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {graphOpen ? (
          <GraphView
            onOpen={(path, title) => {
              setGraphOpen(false);
              openDoc(path, title);
            }}
          />
        ) : activeDoc ? (
          <div className="mx-auto max-w-3xl px-6 py-6">
            <div
              ref={contentRef}
              className="md-content"
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
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            选择文件查看
          </div>
        )}
      </div>
    </div>
  );
}
