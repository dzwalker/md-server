import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, List } from 'lucide-react';
import { useStore } from '@/state/store';
import type { Heading } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface TocNode {
  id: string;
  text: string;
  level: number;
  children: TocNode[];
}

function buildToc(headings: Heading[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const h of headings) {
    const node: TocNode = { id: h.id, text: h.text, level: h.level, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (!stack.length) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
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

export function TocPanel() {
  const { activeRender, activeDoc } = useStore();
  const headings = activeRender?.headings || [];
  const tree = useMemo(() => buildToc(headings), [headings]);
  const flat = useMemo(() => flatten(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setCollapsed(new Set());
  }, [activeDoc]);

  useEffect(() => {
    if (!flat.length) {
      setActiveId(null);
      return;
    }
    const heads = flat
      .map((n) => document.getElementById(n.id))
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

  function expandToLevel(n: number) {
    setCollapsed(new Set(flat.filter((x) => x.children.length && x.level >= n).map((x) => x.id)));
  }
  function openAll() {
    setCollapsed(new Set());
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render(nodes: TocNode[], depth: number): ReactNode {
    return (
      <ul className={cn(depth > 0 && 'pl-3')}>
        {nodes.map((n) => {
          const isCollapsed = collapsed.has(n.id);
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
                <button
                  type="button"
                  onClick={() => scrollTo(n.id)}
                  className={cn(
                    'min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-sm hover:bg-accent',
                    n.level === 1 && 'font-medium',
                    activeId === n.id && 'bg-accent text-accent-foreground',
                  )}
                >
                  {n.text}
                </button>
              </div>
              {n.children.length && !isCollapsed ? render(n.children, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  const btn = 'h-6 px-1.5 text-xs';

  return (
    <div className="flex max-h-[calc(100vh-9rem)] flex-col rounded-lg border bg-sidebar">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
        <List className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">目录</span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-3 pb-1 text-xs text-muted-foreground">
        <span className="mr-1">层级:</span>
        <Button variant="ghost" size="sm" className={btn} onClick={() => expandToLevel(1)}>
          1
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={() => expandToLevel(2)}>
          2
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={() => expandToLevel(3)}>
          3
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={openAll}>
          a
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1">
        {!headings.length ? (
          <div className="p-3 text-xs text-muted-foreground">无标题</div>
        ) : (
          render(tree, 0)
        )}
      </div>
    </div>
  );
}
