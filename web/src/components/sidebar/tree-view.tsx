import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from 'react-arborist';
import {
  ChevronRight,
  ClipboardCopy,
  Copy,
  Download,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  Network,
  PenLine,
} from 'lucide-react';
import type { TreeNode } from '@/lib/types';
import { api } from '@/lib/api';
import { useStore } from '@/state/store';
import { useElementSize } from '@/hooks/use-element-size';
import { cn, scopeLabel, scopeLabels, stripMdExt } from '@/lib/utils';
import { copyText } from '@/lib/clipboard';
import { downloadDocByPath } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { DocNameDialog } from '@/components/doc-name-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

// 资源管理器里内置的「工具」虚拟文件夹（不是磁盘上的真实目录），后续工具继续往里加。
const TOOLS_NODE: TreeNode = {
  name: '工具',
  path: '/__tools__',
  type: 'dir',
  children: [
    { name: '图谱', path: '/__tools__/graph', type: 'tool', toolId: 'graph', title: '图谱' },
  ],
};

// 资源管理器里的轻提示（「已复制」/「下载失败」）。菜单选中后 Radix 会立刻关闭菜单，
// 所以提示不能挂在菜单里，这里用 context 下发给每个节点行，由 TreeView 顶层渲染。
const ToastContext = createContext<(msg: string) => void>(() => {});

// 右键菜单弹出的命名对话框：新建（目录）或重命名（文件），同一时刻每行最多一个。
type NameDialog = { kind: 'create' } | { kind: 'rename'; refs: number | null };

function TreeNodeRow({ node, style }: NodeRendererProps<TreeNode>) {
  const { openDoc, showFilename, activeDoc, createDoc, renameDoc } = useStore();
  const toast = useContext(ToastContext);
  const d = node.data;
  const isDir = d.type === 'dir';
  const isTool = d.type === 'tool';
  const isFile = d.type === 'file';
  // 「工具」是内置的虚拟目录（不是磁盘上的真实路径），不给右键菜单，免得复制出不存在的路径。
  const isVirtual = d.path.startsWith('/__tools__');
  const isActive = !isDir && d.path === activeDoc;
  const Icon = isDir ? (node.isOpen ? FolderOpen : Folder) : isTool ? Network : FileText;
  const label = isDir ? d.name : isTool ? (d.title || d.name) : showFilename ? stripMdExt(d.name) : (d.title || d.name);

  // 命名对话框必须用受控 state：ContextMenuItem 的 onSelect 会让菜单立刻卸载，
  // 不能在菜单项里塞 DialogTrigger。
  const [dialog, setDialog] = useState<NameDialog | null>(null);
  // 菜单关闭时 Radix 会延迟把焦点还给触发元素，会和对话框输入框的自动聚焦打架；
  // 选中「新建 / 重命名」时打个标记，让下面的 onCloseAutoFocus 跳过这次归还。
  const dialogOpeningRef = useRef(false);

  // 「复制文件名」给的是磁盘上的真实文件名（带 .md 扩展名），不是树上显示的文档标题。
  async function onCopyName() {
    const ok = await copyText(d.name);
    toast(ok ? `已复制文件名：${d.name}` : '复制失败，请手动复制');
  }

  // 「复制完整路径」给的是应用内的 urlPath（与树、URL、收藏/搜索里的 path 完全一致）。
  async function onCopyPath() {
    const ok = await copyText(d.path);
    toast(ok ? `已复制路径：${d.path}` : '复制失败，请手动复制');
  }

  async function onDownload() {
    try {
      await downloadDocByPath(d.path);
    } catch (err) {
      console.warn('下载失败：', err);
      toast('下载失败');
    }
  }

  // 打开改名对话框，顺手取「有几篇文档引用了它」用于提醒；拿不到就不提示。
  function onRename() {
    dialogOpeningRef.current = true;
    setDialog({ kind: 'rename', refs: null });
    api
      .backlinks(d.path)
      .then((bs) => setDialog((cur) => (cur?.kind === 'rename' ? { ...cur, refs: bs.length } : cur)))
      .catch(() => {});
  }

  const row = (
    <div className="flex h-full w-full items-center gap-1 pr-2">
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
        title={isDir ? d.path : undefined}
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

  return (
    <div style={style} className={cn('text-sm', isActive && 'bg-accent')}>
      {isVirtual ? (
        row
      ) : (
        <ContextMenu onOpenChange={(o) => { if (o) dialogOpeningRef.current = false; }}>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent
            className="min-w-44"
            onCloseAutoFocus={(e) => {
              if (dialogOpeningRef.current) {
                dialogOpeningRef.current = false;
                e.preventDefault();
              }
            }}
          >
            {isDir && (
              <ContextMenuItem
                onSelect={() => {
                  dialogOpeningRef.current = true;
                  setDialog({ kind: 'create' });
                }}
              >
                <FilePlus />
                新建 Markdown 文件
              </ContextMenuItem>
            )}
            {isFile && (
              <ContextMenuItem onSelect={onCopyName}>
                <Copy />
                复制文件名
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={onCopyPath}>
              <ClipboardCopy />
              复制完整路径
            </ContextMenuItem>
            {isFile && (
              <ContextMenuItem onSelect={onDownload}>
                <Download />
                下载
              </ContextMenuItem>
            )}
            {isFile && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={onRename}>
                  <PenLine />
                  重命名
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      )}
      {/* 新建 / 改名对话框：每个节点行各渲染一个，Portal 定位不受行布局影响。 */}
      {dialog?.kind === 'create' && (
        <DocNameDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title="新建 Markdown 文件"
          description={`在「${d.name}」下创建一个空文档，创建后直接进入编辑态。`}
          confirmText="创建"
          onSubmit={async (name) => {
            await createDoc(d.path, name);
            toast(`已创建：${name}`);
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <DocNameDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title="重命名"
          description={`当前文件名：${d.name}`}
          initialName={stripMdExt(d.name)}
          confirmText="重命名"
          hint={
            dialog.refs !== null && dialog.refs > 0
              ? `有 ${dialog.refs} 篇文档引用了它（[[双链]] / 相对链接），改名后引用不会自动更新`
              : undefined
          }
          onSubmit={async (name) => {
            await renameDoc(d.path, name);
            toast('已重命名');
          }}
        />
      )}
    </div>
  );
}

function hasFileDescendant(n: TreeNode): boolean {
  if (n.type === 'file') return true;
  return !!n.children && n.children.some(hasFileDescendant);
}

// 在全局树里按 urlPath 定位节点（作用域条目可能深于一级目录，如 notion-archive/学习成长）。
function findNodeByPath(nodes: TreeNode[], target: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === target) return n;
    if (n.children) {
      const hit = findNodeByPath(n.children, target);
      if (hit) return hit;
    }
  }
  return null;
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

  // 右键菜单操作后的轻提示：1.8s 自动消失，新的提示会顶掉旧的。
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 1800);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // 按当前 set 的作用域条目取树节点（条目顺序即树中顺序）。条目可以深于一级目录
  // （如 notion-archive/学习成长）：取该目录在全局树里的子树当一级节点，显示名取最后一段。
  // 条目在树上不存在（空目录未建节点等）时给一个占位节点，保证空间不至于整块空白。
  const visible = useMemo(() => {
    let nodes: TreeNode[];
    if (setsLoaded && activeSet) {
      const labels = scopeLabels(activeSet.dirs);
      nodes = activeSet.dirs.map((d) => {
        const path = '/' + d.replace(/^\/+|\/+$/g, '');
        const name = labels.get(d) || scopeLabel(d);
        const hit = findNodeByPath(data, path);
        return hit ? { ...hit, name } : { name, path, type: 'dir' as const, children: [] };
      });
    } else {
      nodes = data;
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
          <ToastContext.Provider value={showToast}>
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
          </ToastContext.Provider>
        )}
      </div>
      {toastMsg && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 max-w-[80vw] -translate-x-1/2 truncate rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
