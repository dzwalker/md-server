import { useStore, type OpenDoc } from '@/state/store';
import { cn } from '@/lib/utils';

export function OpenedPanel() {
  const { openDocs, activeDoc, activateDoc } = useStore();

  const groups: Record<string, OpenDoc[]> = {};
  for (const d of openDocs) {
    const top = d.path.split('/').filter(Boolean)[0] || 'other';
    (groups[top] ||= []).push(d);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        已打开
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {!openDocs.length ? (
          <div className="p-3 text-xs text-muted-foreground">暂无打开的文档</div>
        ) : (
          Object.entries(groups).map(([top, docs]) => (
            <div key={top}>
              <div className="px-3 py-1 text-xs text-muted-foreground">{top}</div>
              {docs.map((d) => (
                <button
                  key={d.path}
                  type="button"
                  onClick={() => activateDoc(d.path)}
                  className={cn(
                    'block w-full truncate px-6 py-1 text-left text-sm hover:bg-accent',
                    d.path === activeDoc && 'bg-accent text-accent-foreground',
                  )}
                >
                  {d.title}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
