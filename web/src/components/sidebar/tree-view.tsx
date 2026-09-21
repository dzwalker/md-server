import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from 'react-arborist';
import { ChevronRight, FileText, Folder, FolderOpen, Network } from 'lucide-react';
import type { TreeNode } from '@/lib/types';
import { useStore } from '@/state/store';
import { useElementSize } from '@/hooks/use-element-size';
import { cn, stripMdExt } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// 资源管理器里内置的「工具」虚拟文件夹（不是磁盘上的真实目录），后续工具继续往里加。
const TOOLS_NODE: TreeNode = {
  name: '工具',
  path: '/__tools__',
  type: 'dir',
  children: [
    { name: '图谱', path: '/__tools__/graph', type: 'tool', toolId: 'graph', title: '图谱' },
  ],
};

function TreeNodeRow({ node, style }: NodeRendererProps<TreeNode>) {
  const { openDoc, showFilename, activeDoc } = useStore();
  const d = node.data;
  const isDir = d.type === 'dir';
  const isTool = d.type === 'tool';
  const isActive = !isDir && d.path === activeDoc;
  const Icon = isDir ? (node.isOpen ? FolderOpen : Folder) : isTool ? Network : FileText;
  const label = isDir ? d.name : isTool ? (d.title || d.name) : showFilename ? stripMdExt(d.name) : (d.title || d.name);

  return (
    <div style={style} className={cn('flex items-center gap-1 pr-2 text-sm', isActive && 'bg-accent')}>
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
          if (isDir) node.toggle();
          else if (isTool) openDoc(d.path, d.title || d.name);
          else openDoc(d.path, d.title);
        }}
      >
        {label}
      </button>
    </div>
  );
}

function hasFileDescendant(n: TreeNode): boolean {
  if (n.type === 'file') return true;
  return !!n.children && n.children.some(hasFileDescendant);
}

// 剪掉「后代里没有任何 md 文件」的目录；depth===0 是顶层空间，始终保留（1 级要保留）。
function pruneEmptyDirs(nodes: TreeNode[], depth: number): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === 'file') {
      out.push(n);
    } else if (depth === 0 || hasFileDescendant(n)) {
      out.push({ ...n, children: pruneEmptyDirs(n.children ?? [], depth + 1) });
    }
  }
  return out;
}

export function TreeView() {
  const { tree: data, activeSet, setsLoaded, hideEmptyDirs } = useStore();
  const { ref, height: measuredHeight } = useElementSize<HTMLDivElement>();
  const treeRef = useRef<TreeApi<TreeNode> | null>(null);
  // 面板被隐藏（display:none）时 ResizeObserver 会报 0，这里保留上一次的正值高度，
  // 让 Tree 在面板隐藏期间保持挂载，从而不丢失目录的展开/收起状态。
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (measuredHeight > 0) setHeight(measuredHeight);
  }, [measuredHeight]);

  // 按当前 set 的目录过滤并排序顶层节点（set 里目录的顺序即树中顺序），
  // 再按设置决定是否隐藏「无文档」的空文件夹。
  const visible = useMemo(() => {
    let nodes = data;
    if (setsLoaded && activeSet) {
      const order = new Map(activeSet.dirs.map((d, i) => [d, i]));
      nodes = data
        .filter((n) => order.has(n.name))
        .slice()
        .sort((a, b) => (order.get(a.name)! - order.get(b.name)!));
    }
    if (hideEmptyDirs) nodes = pruneEmptyDirs(nodes, 0);
    return [...nodes, TOOLS_NODE];
  }, [data, activeSet, setsLoaded, hideEmptyDirs]);

  const expandToLevel = useCallback((n: number) => {
    const t = treeRef.current;
    if (!t) return;
    const walk = (nodes: NodeApi<TreeNode>[]) => {
      for (const node of nodes) {
        if (node.isInternal) {
          if (node.level >= n - 1) node.close();
          else node.open();
          walk(node.children || []);
        }
      }
    };
    walk(t.root.children || []);
  }, []);

  // 上次会话的目录展开状态（首次挂载时恢复；没有记录则保持默认「仅 1 级」）
  const initialOpenState = useMemo<Record<string, boolean> | undefined>(() => {
    try {
      const raw = localStorage.getItem('md-tree-open');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, boolean>;
        }
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }, []);

  // 展开状态变化时持久化：订阅 react-arborist 内部 store，并在页面卸载时兜底立即保存。
  const treeMounted = height > 0;
  useEffect(() => {
    if (!treeMounted) return;
    const t = treeRef.current;
    if (!t) return;
    const saveNow = () => {
      try {
        localStorage.setItem('md-tree-open', JSON.stringify(t.openState));
      } catch {
        /* ignore */
      }
    };
    let timer: number | undefined;
    const debouncedSave = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(saveNow, 300);
    };
    const unsub = t.store.subscribe(debouncedSave);
    window.addEventListener('beforeunload', saveNow);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', saveNow);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [treeMounted]);

  const btn = 'h-6 px-1.5 text-xs';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        <Button variant="ghost" size="sm" className={btn} onClick={() => treeRef.current?.openAll()}>
          a
        </Button>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-x-hidden">
        {height > 0 && (
          <Tree
            ref={treeRef}
            data={visible}
            idAccessor="path"
            childrenAccessor="children"
            initialOpenState={initialOpenState}
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
