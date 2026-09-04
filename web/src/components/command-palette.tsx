import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { SearchResult } from '@/lib/types';
import { useStore } from '@/state/store';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { openDoc } = useStore();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQ('');
      setResults([]);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setResults(await api.search(query));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  function select(r: SearchResult) {
    openDoc(r.path, r.title, q.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-6 translate-y-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">快速打开</DialogTitle>
        <Command shouldFilter={false}>
          <Command.Input
            value={q}
            onValueChange={setQ}
            placeholder="搜索并快速打开文档…"
            className="h-12 w-full border-b bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-auto p-1.5">
            {loading ? (
              <Command.Empty>搜索中…</Command.Empty>
            ) : results.length === 0 && q.trim() ? (
              <Command.Empty>无结果</Command.Empty>
            ) : (
              results.map((r) => (
                <Command.Item
                  key={r.path}
                  value={r.path}
                  onSelect={() => select(r)}
                  className="cursor-pointer rounded px-2 py-1.5 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="truncate text-sm">{r.title || r.path}</span>
                    <span className="truncate text-xs text-muted-foreground">{r.path}</span>
                  </div>
                </Command.Item>
              ))
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
