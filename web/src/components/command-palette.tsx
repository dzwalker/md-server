import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { relativeTime, cn } from '@/lib/utils';
import type { RecentFile, SearchResult } from '@/lib/types';
import { useStore } from '@/state/store';

/** 空态「最近更新」显示条数。 */
const RECENT_LIMIT = 20;

// 选中态用实心主色：本主题的 --accent 是 oklch(0.97 0 0) 近白，叠在近白面板上几乎看不见。
// group 供子元素（路径副标题）在选中时切换前景色。
const ITEM_CLASS =
  'group cursor-pointer rounded px-2 py-1.5 data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground';

const ITEM_SUB_CLASS =
  'truncate text-xs text-muted-foreground group-data-[selected=true]:text-primary-foreground/70';

const GROUP_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:text-muted-foreground';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { openDoc, activeDirs, activeSet } = useStore();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);

  // 空间目录的稳定依赖键（store 里 activeDirs 每次都可能是新数组）。
  const dirsKey = activeDirs.join(',');

  // 一打开就取「当前空间最近更新」：不输入内容时直接列出来，一眼看到最近改动。
  useEffect(() => {
    if (!open) {
      setQ('');
      setResults([]);
      setSearching(false);
      setRecent([]);
      setRecentLoading(false);
      return;
    }
    let alive = true;
    setRecentLoading(true);
    api
      .recent({ dirs: dirsKey ? dirsKey.split(',') : undefined, limit: RECENT_LIMIT })
      .then((list) => {
        if (alive) setRecent(list);
      })
      .catch(() => {
        if (alive) setRecent([]);
      })
      .finally(() => {
        if (alive) setRecentLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, dirsKey]);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await api.search(query));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  function select(path: string, title?: string) {
    openDoc(path, title, q.trim());
    onOpenChange(false);
  }

  const query = q.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-background/20 backdrop-blur-sm"
        className="top-6 translate-y-0 gap-0 overflow-hidden border-0 bg-popover/75 p-0 backdrop-blur-2xl sm:max-w-xl"
      >
        <DialogTitle className="sr-only">快速打开</DialogTitle>
        <Command shouldFilter={false}>
          <Command.Input
            value={q}
            onValueChange={setQ}
            placeholder="搜索并快速打开文档…"
            className="h-12 w-full border-b bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-auto p-1.5">
            {query ? (
              searching ? (
                <Command.Empty>搜索中…</Command.Empty>
              ) : results.length === 0 ? (
                <Command.Empty>无结果</Command.Empty>
              ) : (
                results.map((r) => (
                  <Command.Item
                    key={r.path}
                    value={r.path}
                    onSelect={() => select(r.path, r.title)}
                    className={ITEM_CLASS}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate text-sm">{r.title || r.path}</span>
                      <span className={ITEM_SUB_CLASS}>{r.path}</span>
                    </div>
                  </Command.Item>
                ))
              )
            ) : recentLoading ? (
              <Command.Empty>加载中…</Command.Empty>
            ) : recent.length === 0 ? (
              <Command.Empty>暂无最近更新的文档</Command.Empty>
            ) : (
              <Command.Group
                heading={`最近更新 · ${activeSet?.name || '全部文档'}`}
                className={GROUP_HEADING_CLASS}
              >
                {recent.map((r) => (
                  <Command.Item
                    key={r.path}
                    value={r.path}
                    onSelect={() => select(r.path, r.title)}
                    className={ITEM_CLASS}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm">{r.title || r.name}</span>
                        <span className={cn('shrink-0', ITEM_SUB_CLASS)}>
                          {relativeTime(r.mtimeMs)}
                        </span>
                      </div>
                      <span className={ITEM_SUB_CLASS}>{r.path}</span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
