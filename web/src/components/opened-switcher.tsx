import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn, stripMdExt, topDirOf } from '@/lib/utils';
import { useStore, type OpenDoc } from '@/state/store';

interface Column {
  key: string;
  label: string;
  docs: OpenDoc[];
}

const TOOLS_DIR = '__tools__';

function labelOfDir(dir: string): string {
  if (dir === TOOLS_DIR) return '工具';
  return dir || '其他';
}

interface OpenedSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * ⌘O / Ctrl+O：已打开文档的看板式切换器。
 * 一列 = 一个一级空间目录，列序与列内顺序都跟随 tab 栏；↑↓ 列内移动，←→ 换列（行号尽量保留）。
 */
export function OpenedSwitcher({ open, onOpenChange }: OpenedSwitcherProps) {
  const { openDocs, activeDoc, activateDoc, showFilename } = useStore();
  const [sel, setSel] = useState({ col: 0, row: 0 });
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  // 焦点落点：面板容器自己（-1 可编程聚焦），不能让 Radix 自动聚焦到列表第一项
  // —— 否则第一项会一直挂着一个浏览器焦点框，而方向键只改选中态、不会搬走它。
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 一列 = 一个一级空间目录；Map 的插入顺序即 tab 栏顺序。
  const columns = useMemo<Column[]>(() => {
    const map = new Map<string, Column>();
    for (const d of openDocs) {
      const key = topDirOf(d.path) || 'other';
      let col = map.get(key);
      if (!col) {
        col = { key, label: labelOfDir(key), docs: [] };
        map.set(key, col);
      }
      col.docs.push(d);
    }
    return [...map.values()];
  }, [openDocs]);

  // 打开时把选中位置落在「当前正在看的文档」上，一眼知道自己在哪。
  useEffect(() => {
    if (!open) return;
    const ci = columns.findIndex((c) => c.docs.some((d) => d.path === activeDoc));
    if (ci < 0) {
      setSel({ col: 0, row: 0 });
      return;
    }
    setSel({ col: ci, row: columns[ci].docs.findIndex((d) => d.path === activeDoc) });
    // 只在打开瞬间定位一次，之后由键盘/鼠标掌控。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 键盘导航：←→ 换列（行号保持、超出则夹到末行），↑↓ 列内移动。
  useEffect(() => {
    if (!open || columns.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const col = Math.min(sel.col, columns.length - 1);
      const docs = columns[col].docs;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = e.key === 'ArrowRight'
          ? Math.min(columns.length - 1, col + 1)
          : Math.max(0, col - 1);
        setSel({ col: next, row: Math.min(sel.row, columns[next].docs.length - 1) });
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const row = e.key === 'ArrowDown'
          ? Math.min(docs.length - 1, sel.row + 1)
          : Math.max(0, sel.row - 1);
        setSel({ col, row });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const doc = docs[Math.min(sel.row, docs.length - 1)];
        if (doc) {
          activateDoc(doc.path);
          onOpenChange(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, columns, sel, activateDoc, onOpenChange]);

  // 选中项始终滚动到可见处（纵向在列内滚，横向让该列滚进视野）。
  useEffect(() => {
    if (!open) return;
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, sel]);

  function pick(path: string) {
    activateDoc(path);
    onOpenChange(false);
  }

  function labelOf(doc: OpenDoc): string {
    const isToolDoc = doc.path.startsWith('/__tools__/');
    if (showFilename && !isToolDoc) return stripMdExt(doc.path.split('/').pop() || '') || doc.title;
    return doc.title;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-background/20 backdrop-blur-sm"
        className="top-16 translate-y-0 gap-0 overflow-hidden border-0 bg-popover/75 p-0 backdrop-blur-2xl sm:max-w-3xl"
        onOpenAutoFocus={(e) => {
          // 不让 Radix 把焦点丢给列表第一项：选中态是状态驱动的，方向键不会搬走 DOM 焦点，
          // 于是第一项会一直挂着一个浏览器默认焦点框（实测 outline auto 1px）。
          // 改为聚焦面板容器本身，键盘仍在弹层内（焦点陷阱有效），列表项不出现残留框。
          e.preventDefault();
          panelRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">已打开的文档</DialogTitle>
        <div ref={panelRef} tabIndex={-1} className="flex flex-col outline-none">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <span className="text-sm font-medium">已打开的文档</span>
            <span className="text-xs text-muted-foreground">
              {openDocs.length} 篇 · ↑↓ 选择 · ←→ 切换目录 · Enter 打开
            </span>
          </div>

          {columns.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">暂无打开的文档</div>
          ) : (
            <div className="flex max-h-[62vh] gap-3 overflow-x-auto overflow-y-hidden p-3">
              {columns.map((col, ci) => (
                <div
                  key={col.key}
                  data-column={col.key}
                  className={cn(
                    'flex w-52 shrink-0 flex-col overflow-hidden rounded-lg',
                    // 当前列用底色区分（不用描边：1px 深色 ring 看着像"多余的边框"）
                    ci === sel.col ? 'bg-primary/10' : 'bg-muted/40',
                  )}
                >
                  <div className="flex items-baseline gap-1.5 px-2.5 py-2">
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-xs font-medium',
                        ci === sel.col ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {col.label}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{col.docs.length}</span>
                  </div>
                  {/* 打开文档多时列内自己滚，不把面板撑破 */}
                  <div data-doc-list={col.key} className="max-h-[52vh] min-h-0 flex-1 overflow-y-auto p-1">
                    {col.docs.map((d, ri) => {
                      const isSel = ci === sel.col && ri === sel.row;
                      const isActive = d.path === activeDoc;
                      return (
                        <button
                          key={d.path}
                          ref={isSel ? selectedRef : undefined}
                          type="button"
                          data-doc-path={d.path}
                          data-selected={isSel || undefined}
                          data-current={isActive || undefined}
                          onClick={() => pick(d.path)}
                          onMouseEnter={() => setSel({ col: ci, row: ri })}
                          className={cn(
                            'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
                            // 选中态用实心主色：此主题的 --accent/--muted 都是 oklch(0.97) 近白，
                            // 叠在同样近白的列底上等于看不见（实测亮度差仅 ~0.018）。
                            isSel
                              ? 'bg-primary font-medium text-primary-foreground'
                              : isActive
                                ? 'font-medium text-foreground hover:bg-foreground/10'
                                : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              isSel ? 'bg-primary-foreground' : isActive ? 'bg-primary' : 'bg-transparent',
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">{labelOf(d)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
