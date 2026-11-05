import { X } from 'lucide-react';
import { useStore, type OpenDoc } from '@/state/store';
import { cn, scopeDirOf, scopeLabel, scopeLabels, topDirOf } from '@/lib/utils';

/**
 * 侧栏「已打开的文档」（见 specs/opened-panel-close/）：
 * - 分组头（当前空间的目录作用域，可深于一级目录）右侧常显一个关闭按钮 → 关掉该组下所有已打开文档；
 * - 每篇文档行右侧一个关闭按钮 → 只关这一篇（悬浮该行才显示，和 tab 上的关闭按钮一致）。
 */
export function OpenedPanel() {
  const { openDocs, activeDoc, activateDoc, closeDoc, closeDocs, activeSet } = useStore();

  // 分组 = 命中的作用域条目（可深于一级目录）；取不到时回退路径第一段。
  const dirs = activeSet?.dirs ?? [];
  const labels = scopeLabels(dirs);
  const byKey = new Map<string, OpenDoc[]>();
  for (const d of openDocs) {
    const key = scopeDirOf(d.path, dirs) ?? (topDirOf(d.path) || 'other');
    const arr = byKey.get(key);
    if (arr) arr.push(d);
    else byKey.set(key, [d]);
  }
  const groups = Array.from(byKey.entries()).map(([key, docs]) => ({
    key,
    label: dirs.includes(key) ? labels.get(key) || scopeLabel(key) : key,
    title: key,
    docs,
  }));

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden py-1">
      {!openDocs.length ? (
        <div className="p-3 text-xs text-muted-foreground">暂无打开的文档</div>
      ) : (
        groups.map(({ key, label, title, docs }) => (
          <div key={key}>
            <div className="flex items-center gap-1 py-1 pl-3 pr-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate" title={title}>
                {label}
              </span>
              <button
                type="button"
                onClick={() => closeDocs(docs.map((d) => d.path))}
                title={`关闭「${label}」下全部 ${docs.length} 篇文档`}
                aria-label={`关闭「${label}」下全部 ${docs.length} 篇文档`}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted-foreground/20 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {docs.map((d) => (
              <div
                key={d.path}
                className={cn(
                  // 悬浮高亮放在**整行**上：只高亮标题按钮的话，右侧 × 那格仍是侧栏底色
                  // （浅色主题是 250 的近白），看起来就像 × 上贴了一块白底。
                  'group flex items-center hover:bg-accent',
                  d.path === activeDoc && 'bg-accent',
                )}
              >
                <button
                  type="button"
                  onClick={() => activateDoc(d.path)}
                  title={d.title}
                  className={cn(
                    'min-w-0 flex-1 truncate py-1 pl-6 pr-1 text-left text-sm',
                    d.path === activeDoc && 'font-medium text-accent-foreground',
                  )}
                >
                  {d.title}
                </button>
                <button
                  type="button"
                  onClick={() => closeDoc(d.path)}
                  title="关闭"
                  aria-label={`关闭 ${d.title}`}
                  className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/20 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
