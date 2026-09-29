import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, NotebookPen } from 'lucide-react';
import { api } from '@/lib/api';
import type { NoteFile, NoteRef } from '@/lib/types';
import { useStore } from '@/state/store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { notePreview } from '@/lib/notes';

interface NotesPanelProps {
  /** 当前是否真的显示这个面板：面板常驻挂载，用它触发首次加载，避免每次启动都拉一遍笔记。 */
  isActive: boolean;
}

interface DirGroup {
  name: string;
  files: NoteFile[];
  /** 该目录下的笔记条数。 */
  count: number;
}

/**
 * 侧栏「笔记」面板：当前空间 → 一级目录（只留最上级）→ 有笔记的文件 → 每条笔记。
 * 数据来自只读接口 `GET /api/notes`（服务端直接从索引库的 body 现算，见 specs/notes-browse/）。
 */
export function NotesPanel({ isActive }: NotesPanelProps) {
  const { activeSet, dataVersion, openDoc } = useStore();
  const [files, setFiles] = useState<NoteFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());

  const dirsKey = (activeSet?.dirs || []).join(',');
  const loadedKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.notes({ dirs: activeSet?.dirs });
      setFiles(r.files);
    } catch {
      /* 网络/服务异常时保留上一次结果 */
    } finally {
      setLoading(false);
    }
  }, [activeSet]);

  // 首次切到「笔记」tab、或切换空间时加载。
  useEffect(() => {
    if (!isActive) return;
    if (loadedKeyRef.current === dirsKey) return;
    loadedKeyRef.current = dirsKey;
    void load();
  }, [isActive, dirsKey, load]);

  // 磁盘有增删改（dataVersion +1）后刷新已加载过的清单；去抖合并连续变更。
  const versionRef = useRef(dataVersion);
  useEffect(() => {
    if (versionRef.current === dataVersion) return;
    versionRef.current = dataVersion;
    if (loadedKeyRef.current === null) return;
    const t = window.setTimeout(() => void load(), 800);
    return () => window.clearTimeout(t);
  }, [dataVersion, load]);

  // 一级目录分组（当前空间 set.dirs 的顺序即分组顺序）；路径的第一段就是它所属的一级目录。
  const groups = useMemo<DirGroup[]>(() => {
    const map = new Map<string, NoteFile[]>();
    for (const f of files) {
      const top = f.path.split('/').filter(Boolean)[0] || '';
      const arr = map.get(top);
      if (arr) arr.push(f);
      else map.set(top, [f]);
    }
    const order = (activeSet?.dirs || []).filter((d) => map.has(d));
    const names = order.length ? order : Array.from(map.keys()).sort();
    return names.map((name) => {
      const fs = map.get(name) || [];
      return { name, files: fs, count: fs.reduce((n, f) => n + f.notes.length, 0) };
    });
  }, [files, activeSet]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // 搜索：精准匹配笔记正文里包含的文字（不区分大小写的子串）。
  const view = useMemo<DirGroup[]>(() => {
    if (!searching) return groups;
    return groups
      .map((g) => ({
        ...g,
        files: g.files
          .map((f) => ({ ...f, notes: f.notes.filter((n) => n.text.toLowerCase().includes(q)) }))
          .filter((f) => f.notes.length > 0),
      }))
      .filter((g) => g.files.length > 0);
  }, [groups, q, searching]);

  const matchCount = searching
    ? view.reduce((n, g) => n + g.files.reduce((m, f) => m + f.notes.length, 0), 0)
    : 0;

  const isDirOpen = (name: string) => searching || openDirs.has(name);
  const isFileOpen = (path: string) => searching || openFiles.has(path);

  const toggleDir = (name: string) =>
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleFile = (path: string) =>
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // 层级按钮：目录（全部收起）/ 文件（展开到文件）/ 笔记（全展开）
  const showDirsOnly = () => {
    setOpenDirs(new Set());
    setOpenFiles(new Set());
  };
  const showFiles = () => {
    setOpenDirs(new Set(groups.map((g) => g.name)));
    setOpenFiles(new Set());
  };
  const showNotes = () => {
    setOpenDirs(new Set(groups.map((g) => g.name)));
    setOpenFiles(new Set(files.map((f) => f.path)));
  };

  function renderNote(f: NoteFile, n: NoteRef) {
    const preview = notePreview(n.text);
    return (
      <div key={n.line} className="flex items-start gap-1 rounded px-1 py-0.5 hover:bg-accent">
        <NotebookPen className="mt-[3px] h-3.5 w-3.5 shrink-0 text-amber-500/90" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground"
          title={preview}
          onClick={() => openDoc(f.path, f.title, null, `note:${n.line}`)}
        >
          {preview}
        </button>
      </div>
    );
  }

  function renderFile(f: NoteFile) {
    const open = isFileOpen(f.path);
    return (
      <div key={f.path}>
        <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent">
          <button
            type="button"
            aria-label={open ? '收起笔记' : '展开笔记'}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"
            onClick={() => toggleFile(f.path)}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
          </button>
          <FileText className="h-4 w-4 shrink-0 text-primary/70" />
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
            title={f.title || f.name}
            // 点文件名：打开文档并展开它的笔记（收起用前面的箭头）。
            onClick={() => {
              setOpenFiles((prev) => new Set(prev).add(f.path));
              openDoc(f.path, f.title);
            }}
          >
            {f.title || f.name}
          </button>
          <span className="shrink-0 pr-0.5 text-[11px] text-muted-foreground">{f.notes.length}</span>
        </div>
        {open && <div className="pl-3">{f.notes.map((n) => renderNote(f, n))}</div>}
      </div>
    );
  }

  function renderDir(g: DirGroup) {
    const open = isDirOpen(g.name);
    return (
      <div key={g.name}>
        <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent">
          <button
            type="button"
            aria-label={open ? '收起目录' : '展开目录'}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"
            onClick={() => toggleDir(g.name)}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
          </button>
          {open ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm font-medium"
            onClick={() => toggleDir(g.name)}
          >
            {g.name}
          </button>
          <span className="shrink-0 pr-0.5 text-[11px] text-muted-foreground">
            {g.files.length} 篇 · {g.count} 条
          </span>
        </div>
        {open && <div className="pl-3">{g.files.map(renderFile)}</div>}
      </div>
    );
  }

  const btn = 'h-6 px-1.5 text-xs';

  return (
    <div className="md-notes-panel flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索笔记内容…"
          className="h-8"
        />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 px-3 pb-1 text-xs text-muted-foreground">
        <Button variant="ghost" size="sm" className={btn} onClick={showDirsOnly} title="只显示目录">
          目录
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={showFiles} title="展开到文件">
          文件
        </Button>
        <Button variant="ghost" size="sm" className={btn} onClick={showNotes} title="展开到每条笔记">
          笔记
        </Button>
        {searching && <span className="ml-auto pr-0.5">{matchCount} 条匹配</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2">
        {loading && !files.length ? (
          <div className="p-3 text-xs text-muted-foreground">加载中…</div>
        ) : !files.length ? (
          <div className="p-3 text-xs text-muted-foreground">
            当前空间还没有笔记
            <div className="mt-1 opacity-80">在正文里右键任意段落即可「插入笔记」。</div>
          </div>
        ) : !view.length ? (
          <div className="p-3 text-xs text-muted-foreground">没有匹配的笔记</div>
        ) : (
          view.map(renderDir)
        )}
      </div>
    </div>
  );
}
