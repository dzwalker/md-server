import { Pin, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { cn } from '@/lib/utils';

export function FavoritesPanel() {
  const { favorites, setFavorite, removeFavorite, openDoc } = useStore();

  const sorted = [...favorites].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || (b.addedAt || 0) - (a.addedAt || 0),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        收藏 · 置顶
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!sorted.length ? (
          <div className="p-3 text-xs text-muted-foreground">暂无收藏</div>
        ) : (
          sorted.map((f) => (
            <div key={f.path} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent">
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title={f.pinned ? '取消置顶' : '置顶'}
                onClick={() => setFavorite(f.path, !f.pinned)}
              >
                <Pin className={cn('h-3.5 w-3.5', f.pinned && 'fill-current text-primary')} />
              </button>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => openDoc(f.path, f.title)}
              >
                {f.title}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">{f.dir}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="移除收藏"
                onClick={() => removeFavorite(f.path)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
