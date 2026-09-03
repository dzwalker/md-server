import { useCallback, useEffect, useRef, useState } from 'react';
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist';
import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { api } from '@/lib/api';
import type { TreeNode } from '@/lib/types';
import { useStore } from '@/state/store';
import { useElementSize } from '@/hooks/use-element-size';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

function TreeNodeRow({ node, style }: NodeRendererProps<TreeNode>) {
  const { openDoc } = useStore();
  const d = node.data;
  const isDir = d.type === 'dir';
  const Icon = isDir ? (node.isOpen ? FolderOpen : Folder) : FileText;

  return (
    <div style={style} className="flex items-center gap-1 pr-2 text-sm">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"
        onClick={() => node.toggle()}
      >
        {isDir ? (
          <ChevronRight className={cn('h-4 w-4 transition-transform', node.isOpen && 'rotate-90')} />
        ) : null}
      </button>
      <Icon className={cn('h-4 w-4 shrink-0', isDir ? 'text-muted-foreground' : 'text-primary/70')} />
      <button
        type="button"
        className={cn('min-w-0 flex-1 truncate text-left', isDir ? 'font-medium' : 'hover:underline')}
        onClick={() => {
          if (!isDir) openDoc(d.path, d.title);
        }}
      >
        {isDir ? d.name : d.title || d.name}
      </button>
    </div>
  );
}

export function TreeView() {
  const { dataVersion } = useStore();
  const [data, setData] = useState<TreeNode[]>([]);
  const { ref, height } = useElementSize<HTMLDivElement>();
  const treeRef = useRef<TreeApi<TreeNode> | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .tree()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  const expandToLevel = useCallback((n: number) => {
    const t = treeRef.current;
    if (!t) return;
    t.openAll();
    t.visibleNodes.forEach((node) => {
      if (node.isInternal && node.level >= n - 1) node.close();
    });
  }, []);

  const btn = 'h-6 px-1.5 text-xs';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <Button variant="ghost" size="sm" className={btn} onClick={() => expandToLevel(1)} title="展开到一级">
          1
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={() => expandToLevel(2)} title="展开到二级">
          2
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={() => expandToLevel(3)} title="展开到三级">
          3
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={() => treeRef.current?.openAll()} title="全部展开">
          a
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className={btn} onClick={() => treeRef.current?.closeAll()}>
          收起
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={() => treeRef.current?.openAll()}>
          打开
        </Button>
      </div>
      <div ref={ref} className="min-h-0 flex-1">
        {height > 0 && (
          <Tree
            ref={treeRef}
            data={data}
            idAccessor="path"
            childrenAccessor="children"
            openByDefault
            width="100%"
            height={height}
            rowHeight={28}
            indent={12}
            disableDrag
            disableDrop
            className="text-foreground"
          >
            {TreeNodeRow}
          </Tree>
        )}
      </div>
    </div>
  );
}
