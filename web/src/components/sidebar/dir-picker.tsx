import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, CornerDownRight, Folder, Loader2 } from 'lucide-react';
import type { BrowseEntry } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface DirPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 确认后回调：相对挂载根的作用域条目（如 `notion-archive/学习成长`）。 */
  onConfirm: (paths: string[]) => void;
}

/**
 * 空间管理的「选择目录」弹窗（见 specs/space-scope/）：
 * 从挂载根逐层浏览目录，勾选任意深度的子目录（可多选），代替手打目录名。
 * 默认只显示「子孙里有 md 文档」的目录，`_assets` / `_index` 这类数据目录自然被滤掉。
 */
export function DirPicker({ open, onOpenChange, onConfirm }: DirPickerProps) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyWithDocs, setOnlyWithDocs] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.browse(p);
      setPath(r.path);
      setEntries(r.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取目录失败');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 每次打开都从挂载根开始，并清空上一轮的勾选。
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setOnlyWithDocs(true);
    void load('');
  }, [open, load]);

  const segs = path ? path.split('/') : [];
  const crumbs = [{ label: '根', to: '' }, ...segs.map((seg, i) => ({ label: seg, to: segs.slice(0, i + 1).join('/') }))];

  // 勾选互不包含：选父目录会顶掉已选的子孙，选子目录会顶掉已选的祖先（后端也按同一规则校验）。
  function toggle(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) {
        next.delete(p);
        return next;
      }
      for (const s of next) {
        if (s.startsWith(p + '/') || p.startsWith(s + '/')) next.delete(s);
      }
      next.add(p);
      return next;
    });
  }

  const shown = useMemo(
    () => entries.filter((e) => !onlyWithDocs || e.mdCount > 0 || selected.has(e.path)),
    [entries, onlyWithDocs, selected],
  );

  const picked = useMemo(() => Array.from(selected).sort(), [selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>选择目录</DialogTitle>
        </DialogHeader>

        {/* 面包屑：点哪一级就跳到哪一级 */}
        <div className="flex flex-wrap items-center gap-0.5 text-xs text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={c.to || 'root'} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />}
              <button
                type="button"
                className={cn(
                  'rounded px-1 py-0.5 hover:bg-accent hover:text-foreground',
                  i === crumbs.length - 1 && 'font-medium text-foreground',
                )}
                onClick={() => void load(c.to)}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>

        {/* 当前目录本身也可选（根目录不可选） */}
        <label className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={!!path && selected.has(path)}
            disabled={!path}
            onChange={() => path && toggle(path)}
          />
          <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            当前目录：<span className="font-mono">{path || '根目录（不可选）'}</span>
          </span>
        </label>

        <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={onlyWithDocs}
              onChange={(e) => setOnlyWithDocs(e.target.checked)}
            />
            仅显示含文档的目录
          </label>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>

        <div className="max-h-[42vh] min-h-[8rem] overflow-y-auto rounded-md border">
          {error ? (
            <div className="p-3 text-xs text-destructive">{error}</div>
          ) : !loading && !shown.length ? (
            <div className="p-3 text-xs text-muted-foreground">
              {onlyWithDocs ? '这一层没有含文档的目录，可取消上面的筛选再找' : '这一层没有子目录'}
            </div>
          ) : (
            shown.map((e) => {
              const checked = selected.has(e.path);
              return (
                <div
                  key={e.path}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent',
                    checked && 'bg-accent/60',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0"
                    checked={checked}
                    onChange={() => toggle(e.path)}
                  />
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    title={e.path}
                    onClick={() => void load(e.path)}
                  >
                    {e.name}
                  </button>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {e.mdCount ? `${e.mdCount} 篇` : '空'}
                  </span>
                  {e.hasChildren && (
                    <button
                      type="button"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                      title={`进入 ${e.name}`}
                      onClick={() => void load(e.path)}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {picked.map((p) => (
              <span
                key={p}
                className="max-w-full truncate rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary"
                title={p}
              >
                {p}
              </span>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!picked.length}
            onClick={() => {
              onConfirm(picked);
              onOpenChange(false);
            }}
          >
            {picked.length ? `添加 ${picked.length} 个目录` : '添加目录'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
