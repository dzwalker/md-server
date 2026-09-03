import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Root } from '@/lib/types';
import { useStore } from '@/state/store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function SpacesPanel() {
  const { refreshData } = useStore();
  const [roots, setRoots] = useState<Root[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newDir, setNewDir] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .roots()
      .then((r) => {
        if (alive) setRoots(r.roots);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save(list: Root[]) {
    try {
      const valid = list.filter((r) => r.url && r.dir && r.url.startsWith('/'));
      const res = await api.saveRoots(valid);
      if (res.roots) {
        setRoots(res.roots);
        refreshData();
      }
    } catch {
      /* ignore */
    }
  }

  function patch(index: number, patch: Partial<Root>) {
    setRoots((cur) => cur.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function remove(index: number) {
    void save(roots.filter((_, i) => i !== index));
  }

  function add() {
    const url = newUrl.trim();
    const dir = newDir.trim();
    if (!url || !dir) return;
    void save([...roots, { url, dir }]);
    setNewUrl('');
    setNewDir('');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {roots.map((r, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5">
            <Input
              value={r.url}
              onChange={(e) => patch(i, { url: e.target.value })}
              onBlur={() => save(roots)}
              placeholder="/空间"
              className="h-7 flex-1 text-xs"
            />
            <Input
              value={r.dir}
              onChange={(e) => patch(i, { dir: e.target.value })}
              onBlur={() => save(roots)}
              placeholder="/data/空间"
              className="h-7 flex-1 text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-destructive"
              onClick={() => remove(i)}
              title="删除空间"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex shrink-0 gap-2 px-3 py-2">
        <Input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="/新空间"
          className="h-8 flex-1 text-xs"
        />
        <Input
          value={newDir}
          onChange={(e) => setNewDir(e.target.value)}
          placeholder="/data/新空间"
          className="h-8 flex-1 text-xs"
        />
        <Button size="sm" className="h-8" onClick={add}>
          添加
        </Button>
      </div>
      <div className="shrink-0 px-3 pb-2 text-xs text-muted-foreground">
        修改后自动保存并重载索引。目录需已挂载到容器内。
      </div>
    </div>
  );
}
