import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import type { DocStat, Favorite, RenderResult, SpaceSet, TreeNode } from '@/lib/types';
import { TOC_WIDTH_DEFAULT, TOC_WIDTH_MAX, TOC_WIDTH_MIN } from '@/lib/toc';
import { forgetScrollPos, migrateScrollPos } from '@/lib/scroll-positions';
import { getStoredMermaidTheme, MERMAID_THEME_KEY } from '@/lib/mermaid-themes';

export interface OpenDoc {
  path: string;
  title: string;
}

interface DocsState {
  openDocs: OpenDoc[];
  activeDoc: string | null;
  activeQuery: string | null;
}

type DocsAction =
  | { type: 'open'; path: string; title: string; query: string | null }
  | { type: 'activate'; path: string }
  | { type: 'close'; path: string }
  | { type: 'closeMany'; paths: string[] }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'rename'; from: string; to: string; title: string }
  | { type: 'hydrate'; docs: DocsState };

/**
 * 关闭若干篇文档（单个 / 整组共用）：只剩「挑哪篇接任当前文档」这一件事。
 * 接任规则：优先当前文档左边最近的一篇还开着的，否则右边第一篇（都没有就空）。
 * activeQuery 是打开某篇文档时带进来的搜索高亮，当前文档被关掉后必须清掉。
 */
function removeDocs(state: DocsState, drop: Set<string>): DocsState {
  if (!drop.size) return state;
  const openDocs = state.openDocs.filter((d) => !drop.has(d.path));
  if (openDocs.length === state.openDocs.length) return state;
  const activeClosed = !!state.activeDoc && drop.has(state.activeDoc);
  let activeDoc = state.activeDoc;
  if (activeClosed) {
    const i = state.openDocs.findIndex((d) => d.path === state.activeDoc);
    const prev = state.openDocs.slice(0, i).reverse().find((d) => !drop.has(d.path));
    const next = state.openDocs.slice(i + 1).find((d) => !drop.has(d.path));
    activeDoc = (prev || next)?.path ?? null;
  }
  return {
    openDocs,
    activeDoc,
    activeQuery: activeClosed ? null : state.activeQuery,
  };
}

function docsReducer(state: DocsState, action: DocsAction): DocsState {
  switch (action.type) {
    case 'open': {
      const openDocs = state.openDocs.some((d) => d.path === action.path)
        ? state.openDocs
        : [...state.openDocs, { path: action.path, title: action.title }];
      return { openDocs, activeDoc: action.path, activeQuery: action.query };
    }
    case 'activate':
      return { ...state, activeDoc: action.path };
    case 'close':
      return removeDocs(state, new Set([action.path]));
    case 'closeMany':
      return removeDocs(state, new Set(action.paths));
    case 'reorder': {
      const openDocs = [...state.openDocs];
      const [moved] = openDocs.splice(action.from, 1);
      openDocs.splice(action.to, 0, moved);
      return { ...state, openDocs };
    }
    case 'rename': {
      // 改名后 tab 要跟着换路径（否则点开的是已经不存在的旧路径）。
      const openDocs = state.openDocs.map((d) =>
        d.path === action.from ? { path: action.to, title: action.title } : d,
      );
      return {
        ...state,
        openDocs,
        activeDoc: state.activeDoc === action.from ? action.to : state.activeDoc,
      };
    }
    case 'hydrate':
      // 切换空间 set 时整体换入目标 set 的已打开文档（无记录即空 → 全部关闭）。
      return action.docs;
    default:
      return state;
  }
}

export interface TocControl {
  expandToLevel: (n: number) => void;
  openAll: () => void;
}

interface StoreValue {
  openDocs: OpenDoc[];
  activeDoc: string | null;
  activeQuery: string | null;
  activeRender: RenderResult | null;
  openDoc: (path: string, title?: string, query?: string | null, anchor?: string) => void;
  activateDoc: (path: string) => void;
  closeDoc: (path: string) => void;
  closeDocs: (paths: string[]) => void;
  reorderDocs: (from: number, to: number) => void;
  fileIndex: Map<string, string>;
  tree: TreeNode[];
  refreshTree: () => Promise<void>;
  scrollTarget: { path: string; anchor: string } | null;
  clearScrollTarget: () => void;
  cacheRender: (path: string, r: RenderResult) => void;
  favorites: Favorite[];
  refreshFavorites: () => Promise<void>;
  toggleFavorite: (path: string) => Promise<void>;
  setFavorite: (path: string, pinned: boolean) => Promise<void>;
  removeFavorite: (path: string) => Promise<void>;
  isFavorite: (path: string) => boolean;
  isPinned: (path: string) => boolean;
  dataVersion: number;
  refreshData: () => void;
  /** 当前打开文档的轻量状态（`/api/status?path=` 心跳回包）：DocView 据此决定是否重拉正文。 */
  docStat: DocStat | null;
  sets: SpaceSet[];
  setsLoaded: boolean;
  activeSetId: string;
  activeSet: SpaceSet | null;
  activeDirs: string[];
  refreshSets: () => Promise<SpaceSet[]>;
  saveSets: (sets: SpaceSet[]) => Promise<{ ok: boolean; error?: string }>;
  switchSet: (id: string) => void;
  mdTheme: string;
  setMdTheme: (t: string) => void;
  mermaidTheme: string;
  setMermaidTheme: (t: string) => void;
  tocWidth: number;
  setTocWidth: (n: number) => void;
  hideEmptyDirs: boolean;
  setHideEmptyDirs: (v: boolean) => void;
  showFilename: boolean;
  setShowFilename: (v: boolean) => void;
  registerTocControl: (c: TocControl | null) => void;
  tocExpandTo: (n: number) => void;
  tocOpenAll: () => void;
  /** 正在编辑的文档路径：**可以多篇同时处于编辑态**（切 tab 不打断编辑）。 */
  editingPaths: string[];
  /** 每篇编辑中文档的未保存状态（tab 脏标记 / 关闭前确认）。 */
  dirtyByPath: Record<string, boolean>;
  beginEdit: (path: string) => void;
  /** 退出某篇（传 path）或全部（不传）的编辑态，并丢掉对应草稿标记。 */
  endEdit: (path?: string) => void;
  setEditingDirty: (path: string, v: boolean) => void;
  /** 新建空文档并直接进入编辑态（资源管理器右键菜单用）。 */
  createDoc: (dir: string, name: string) => Promise<{ path: string; title: string }>;
  /** 改名（同目录换基名），打开的 tab / 渲染缓存跟着迁移。 */
  renameDoc: (path: string, name: string) => Promise<{ path: string; title: string }>;
}

const StoreContext = createContext<StoreValue | null>(null);

// 已打开的 tab：按「空间 set」分槽持久化。旧版是全局单键 md-open-tabs（仅用于一次性迁移）。
const OPEN_TABS_BY_SET_KEY = 'md-open-tabs-by-set';
const LEGACY_OPEN_TABS_KEY = 'md-open-tabs';
const ACTIVE_SET_KEY = 'md-active-set';

type DocsMap = Record<string, DocsState>;

function emptyDocs(): DocsState {
  return { openDocs: [], activeDoc: null, activeQuery: null };
}

function sanitizeDocs(parsed: unknown): DocsState | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<DocsState>;
  if (!Array.isArray(p.openDocs)) return null;
  return {
    openDocs: (p.openDocs as OpenDoc[]).filter(
      (d) => d && typeof d.path === 'string' && typeof d.title === 'string',
    ),
    activeDoc: typeof p.activeDoc === 'string' ? p.activeDoc : null,
    activeQuery: typeof p.activeQuery === 'string' ? p.activeQuery : null,
  };
}

function loadDocsMap(): DocsMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(OPEN_TABS_BY_SET_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: DocsMap = {};
    for (const [k, v] of Object.entries(parsed || {})) {
      const d = sanitizeDocs(v);
      if (d) out[k] = d;
    }
    return out;
  } catch {
    return {};
  }
}

function saveDocsMap(map: DocsMap) {
  try {
    localStorage.setItem(OPEN_TABS_BY_SET_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

// 一次性迁移：旧版全局 tab → 当前 set 的槽位（仅当还没有按 set 的存储时），随后废弃旧键。
function migrateLegacyTabs(setId: string) {
  try {
    const map = loadDocsMap();
    const raw = localStorage.getItem(LEGACY_OPEN_TABS_KEY);
    if (raw && Object.keys(map).length === 0) {
      const legacy = sanitizeDocs(JSON.parse(raw));
      if (legacy && (legacy.openDocs.length > 0 || legacy.activeDoc)) {
        map[setId] = legacy;
        saveDocsMap(map);
      }
    }
    if (raw) localStorage.removeItem(LEGACY_OPEN_TABS_KEY);
  } catch {
    /* ignore */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [docs, dispatch] = useReducer(docsReducer, undefined, emptyDocs);
  // 镜像当前 docs 与当前 set id，供切换 set 时同步落盘/读取（避免回调闭包拿到旧值）。
  const docsRef = useRef<DocsState>(docs);
  const activeSetIdRef = useRef('');

  // 已打开的 tab 按「当前空间 set」分槽持久化；set 尚未解析出来时先不落盘。
  useEffect(() => {
    docsRef.current = docs;
    const id = activeSetIdRef.current;
    if (!id) return;
    const map = loadDocsMap();
    map[id] = docs;
    saveDocsMap(map);
  }, [docs]);
  const [renderCache, setRenderCache] = useState<Record<string, RenderResult>>({});
  const cacheRender = useCallback((path: string, r: RenderResult) => {
    setRenderCache((cur) => ({ ...cur, [path]: r }));
  }, []);
  const activeRender = useMemo<RenderResult | null>(
    () => (docs.activeDoc ? renderCache[docs.activeDoc] ?? null : null),
    [docs.activeDoc, renderCache],
  );
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const refreshTree = useCallback(async () => {
    try {
      setTree(await api.tree());
    } catch {
      /* ignore */
    }
  }, []);
  const [scrollTarget, setScrollTarget] = useState<{ path: string; anchor: string } | null>(null);
  const [sets, setSets] = useState<SpaceSet[]>([]);
  const [setsLoaded, setSetsLoaded] = useState(false);
  const [activeSetId, setActiveSetId] = useState('');
  const [mdTheme, setMdThemeState] = useState<string>(() => {
    if (typeof window === 'undefined') return 'prose';
    return localStorage.getItem('md-content-theme') || 'prose';
  });
  const setMdTheme = useCallback((t: string) => {
    setMdThemeState(t);
    try {
      localStorage.setItem('md-content-theme', t);
    } catch {
      /* ignore */
    }
  }, []);

  const [mermaidTheme, setMermaidThemeState] = useState<string>(getStoredMermaidTheme);
  const setMermaidTheme = useCallback((t: string) => {
    setMermaidThemeState(t);
    try {
      localStorage.setItem(MERMAID_THEME_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const [tocWidth, setTocWidthState] = useState<number>(() => {
    if (typeof window === 'undefined') return TOC_WIDTH_DEFAULT;
    const v = Number(localStorage.getItem('md-toc-width'));
    return v >= TOC_WIDTH_MIN && v <= TOC_WIDTH_MAX ? v : TOC_WIDTH_DEFAULT;
  });
  const setTocWidth = useCallback((n: number) => {
    const v = Math.min(TOC_WIDTH_MAX, Math.max(TOC_WIDTH_MIN, Math.round(n) || TOC_WIDTH_MIN));
    setTocWidthState(v);
    try {
      localStorage.setItem('md-toc-width', String(v));
    } catch {
      /* ignore */
    }
  }, []);

  const [hideEmptyDirs, setHideEmptyDirsState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('md-hide-empty-dirs') === '1';
  });
  const setHideEmptyDirs = useCallback((v: boolean) => {
    setHideEmptyDirsState(v);
    try {
      localStorage.setItem('md-hide-empty-dirs', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const [showFilename, setShowFilenameState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('md-show-filename') === '1';
  });
  const setShowFilename = useCallback((v: boolean) => {
    setShowFilenameState(v);
    try {
      localStorage.setItem('md-show-filename', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const tocControlRef = useRef<TocControl | null>(null);
  const registerTocControl = useCallback((c: TocControl | null) => {
    tocControlRef.current = c;
  }, []);
  const tocExpandTo = useCallback((n: number) => {
    tocControlRef.current?.expandToLevel(n);
  }, []);
  const tocOpenAll = useCallback(() => {
    tocControlRef.current?.openAll();
  }, []);

  const refreshFavorites = useCallback(async () => {
    try {
      setFavorites(await api.favorites());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshFavorites();
  }, [refreshFavorites]);

  // ---------- 正文编辑态（见 specs/doc-editing/）----------
  // 允许多篇同时处于编辑态：切 tab 只是切换「当前显示谁」，不退出编辑、不丢草稿。
  // 草稿全文由编辑器组件自己持有（每次按键写进 store 会让整棵树重渲染），切走时由
  // DocView 把草稿快照存进 draftsRef，切回来再喂给编辑器恢复。
  const [editingPaths, setEditingPaths] = useState<string[]>([]);
  const [dirtyByPath, setDirtyByPath] = useState<Record<string, boolean>>({});
  const editingPathsRef = useRef<string[]>([]);
  const dirtyByPathRef = useRef<Record<string, boolean>>({});
  const beginEdit = useCallback((path: string) => {
    if (!path || path.startsWith('/__tools__/')) return;
    if (editingPathsRef.current.includes(path)) return;
    editingPathsRef.current = [...editingPathsRef.current, path];
    setEditingPaths(editingPathsRef.current);
  }, []);
  const endEdit = useCallback((path?: string) => {
    const next = path
      ? editingPathsRef.current.filter((p) => p !== path)
      : [];
    editingPathsRef.current = next;
    setEditingPaths(next);
    const nextDirty: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(dirtyByPathRef.current)) {
      if (!path || k !== path) nextDirty[k] = v;
    }
    dirtyByPathRef.current = nextDirty;
    setDirtyByPath(nextDirty);
  }, []);
  const setEditingDirty = useCallback((path: string, v: boolean) => {
    if (dirtyByPathRef.current[path] === v) return;
    const next = { ...dirtyByPathRef.current, [path]: v };
    dirtyByPathRef.current = next;
    setDirtyByPath(next);
  }, []);

  // 切文档不再需要确认：每篇的草稿都在，切回来接着编。
  const openDoc = useCallback((path: string, title?: string, query?: string | null, anchor?: string) => {
    dispatch({
      type: 'open',
      path,
      title: title || path.split('/').pop() || path,
      query: query ?? null,
    });
    setScrollTarget(anchor ? { path, anchor } : null);
  }, []);

  const activateDoc = useCallback((path: string) => {
    dispatch({ type: 'activate', path });
    setScrollTarget(null);
  }, []);

  const clearScrollTarget = useCallback(() => setScrollTarget(null), []);
  // 批量关闭（侧栏「已打开」里按目录整组关）：只有「要关掉的文档里有未保存改动」才确认。
  const closeDocs = useCallback((paths: string[]) => {
    if (!paths.length) return;
    const dirtyClosing = paths.filter((p) => dirtyByPathRef.current[p]);
    if (dirtyClosing.length > 0) {
      const names = dirtyClosing.map((p) => p.split('/').pop() || p).slice(0, 3).join('、');
      const more = dirtyClosing.length > 3 ? ` 等 ${dirtyClosing.length} 篇` : '';
      if (!window.confirm(`「${names}」${more}有未保存的修改，关闭会丢弃这些修改，确定？`)) return;
    }
    for (const p of paths) {
      if (editingPathsRef.current.includes(p)) endEdit(p);
      // 关掉的 tab 不保留阅读位置：下次打开是全新一遍（见 lib/scroll-positions.ts）。
      forgetScrollPos(activeSetIdRef.current, p);
    }
    dispatch({ type: 'closeMany', paths });
  }, [endEdit]);
  const closeDoc = useCallback((path: string) => closeDocs([path]), [closeDocs]);
  const reorderDocs = useCallback(
    (from: number, to: number) => dispatch({ type: 'reorder', from, to }),
    [],
  );

  const setFavorite = useCallback(
    async (path: string, pinned: boolean) => {
      await api.addFavorite(path, pinned);
      await refreshFavorites();
    },
    [refreshFavorites],
  );

  const toggleFavorite = useCallback(
    async (path: string) => {
      if (favorites.some((f) => f.path === path)) await api.removeFavorite(path);
      else await api.addFavorite(path, false);
      await refreshFavorites();
    },
    [favorites, refreshFavorites],
  );

  const removeFavorite = useCallback(
    async (path: string) => {
      await api.removeFavorite(path);
      await refreshFavorites();
    },
    [refreshFavorites],
  );

  const isFavorite = useCallback(
    (path: string) => favorites.some((f) => f.path === path),
    [favorites],
  );
  const isPinned = useCallback(
    (path: string) => !!favorites.find((f) => f.path === path)?.pinned,
    [favorites],
  );

  const refreshData = useCallback(() => setDataVersion((v) => v + 1), []);

  // 新建空文档 → 刷新目录树 → 打开并直接进入编辑态。
  const createDoc = useCallback(
    async (dir: string, name: string) => {
      const r = await api.createDoc({ dir, name });
      await refreshTree();
      openDoc(r.path, r.title);
      beginEdit(r.path);
      refreshData();
      return { path: r.path, title: r.title };
    },
    [refreshTree, openDoc, beginEdit, refreshData],
  );

  // 改名（同目录换基名）：tabs、渲染缓存、收藏都跟着迁移；引用不自动改写。
  const renameDoc = useCallback(
    async (target: string, name: string) => {
      if (editingPathsRef.current.includes(target)) {
        throw new Error('正在编辑该文档，请先保存或取消后再改名');
      }
      const r = await api.renameDoc({ path: target, name });
      dispatch({ type: 'rename', from: target, to: r.path, title: r.title });
      // 阅读位置跟着新路径走。
      migrateScrollPos(activeSetIdRef.current, target, r.path);
      setRenderCache((cur) => {
        const prev = cur[target];
        if (!prev) return cur;
        const next = { ...cur };
        delete next[target];
        next[r.path] = { ...prev, path: r.path, title: r.title };
        return next;
      });
      setScrollTarget((cur) => (cur && cur.path === target ? null : cur));
      await refreshTree();
      await refreshFavorites();
      refreshData();
      return { path: r.path, title: r.title };
    },
    [refreshTree, refreshFavorites, refreshData],
  );

  // tab 被别处关掉（切 set / 侧栏批量关）时，清掉对应的编辑态，避免草稿挂在看不见的文档上。
  useEffect(() => {
    const open = new Set(docs.openDocs.map((d) => d.path));
    const stale = editingPathsRef.current.filter((p) => !open.has(p));
    for (const p of stale) endEdit(p);
  }, [docs.openDocs, endEdit]);

  // 目录树只在这里取一次（此前 store 与 TreeView 各取一次，重复下载 431KB）。
  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  // dataVersion 变化（磁盘有增删改）时去抖刷新一次树，避免连续变更引发多次全量下载。
  const treeTimerRef = useRef<number | null>(null);
  const firstVersionRef = useRef(true);
  useEffect(() => {
    if (firstVersionRef.current) {
      firstVersionRef.current = false;
      return;
    }
    if (treeTimerRef.current !== null) window.clearTimeout(treeTimerRef.current);
    treeTimerRef.current = window.setTimeout(() => {
      treeTimerRef.current = null;
      void refreshTree();
    }, 2000);
    return () => {
      if (treeTimerRef.current !== null) window.clearTimeout(treeTimerRef.current);
    };
  }, [dataVersion, refreshTree]);

  // 构建「urlPath → 标题」索引，供正文链接解析（markdown 链接 / [[双链]]）定位目标文档。
  const fileIndex = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file') map.set(n.path, n.title || n.name);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  // 轮询后端数据版本 + 当前文档状态：**一次**请求同时喂两个用途
  // （此前 store 与 DocView 各起一个 5s 定时器，各发一个请求，重复轮询同一件事）。
  // 磁盘上有增删改时后端 chokidar 重建索引并 +1 dataVersion，前端据此刷新树/标签；
  // 当前文档的 mtime / 术语表版本变化由 DocView 消费 docStat 决定是否重拉正文。
  const [docStat, setDocStat] = useState<DocStat | null>(null);
  const activeDocPathRef = useRef<string | null>(docs.activeDoc);
  activeDocPathRef.current = docs.activeDoc;
  const lastVersionRef = useRef<number | null>(null);
  const tickSeqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const seq = ++tickSeqRef.current;
      const path = activeDocPathRef.current;
      try {
        const res = await api.status(path ?? undefined);
        // 切文档 / 已有更新的 tick 时，旧回包直接丢弃（回包顺序可能乱）
        if (!alive || seq !== tickSeqRef.current) return;
        if (lastVersionRef.current !== null && res.dataVersion !== lastVersionRef.current) refreshData();
        lastVersionRef.current = res.dataVersion;
        // 值没变就返回同一对象，避免每 5s 都触发一次全应用重渲染。
        const next = res.file ?? null;
        setDocStat((prev) =>
          prev && next &&
          prev.path === next.path &&
          prev.exists === next.exists &&
          prev.mtimeMs === next.mtimeMs &&
          prev.size === next.size &&
          prev.glossaryVersion === next.glossaryVersion
            ? prev
            : next,
        );
      } catch {
        /* ignore */
      }
    };
    // 切文档后立刻取一次（否则最多要等 5s 才拿到这篇的状态）
    void tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [refreshData, docs.activeDoc]);

  const refreshSets = useCallback(async () => {
    try {
      const res = await api.sets();
      setSets(res.sets);
      setSetsLoaded(true);
      return res.sets;
    } catch {
      setSetsLoaded(true);
      return [];
    }
  }, []);

  // 切换当前 set：先把当前 set 的 tab 落盘，再载入目标 set 的 tab（无记录即视为空 → 全部关闭）。
  const applySet = useCallback((id: string) => {
    const prev = activeSetIdRef.current;
    if (prev && prev !== id) {
      const map = loadDocsMap();
      map[prev] = docsRef.current;
      saveDocsMap(map);
    }
    activeSetIdRef.current = id;
    setActiveSetId(id);
    dispatch({ type: 'hydrate', docs: loadDocsMap()[id] ?? emptyDocs() });
  }, []);

  // 启动时加载 sets 并解析当前 set：优先 URL /set/{id}，其次 localStorage，最后第一个 set。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await api.sets().catch(() => null);
      if (!alive) return;
      const list = res?.sets ?? [];
      const ids = list.map((s) => s.id);
      const m = window.location.pathname.match(/^\/set\/([A-Za-z0-9_-]+)\/?$/);
      let id = m ? m[1] : localStorage.getItem(ACTIVE_SET_KEY) || '';
      if (!ids.includes(id)) id = ids[0] || '';
      setSets(list);
      setSetsLoaded(true);
      if (!id) return;
      // 老用户首次升级：把旧版全局 tab 迁到当前 set 的槽位，再载入该 set 的 tab。
      migrateLegacyTabs(id);
      applySet(id);
      try { localStorage.setItem(ACTIVE_SET_KEY, id); } catch { /* ignore */ }
      if (!m) {
        try { window.history.replaceState(null, '', '/set/' + id); } catch { /* ignore */ }
      }
    })();
    return () => { alive = false; };
  }, [applySet]);

  // 浏览器前进/后退时同步当前 set（并载入该 set 的 tab）。
  useEffect(() => {
    const onPop = () => {
      const m = window.location.pathname.match(/^\/set\/([A-Za-z0-9_-]+)\/?$/);
      if (!m) return;
      try { localStorage.setItem(ACTIVE_SET_KEY, m[1]); } catch { /* ignore */ }
      applySet(m[1]);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applySet]);

  const switchSet = useCallback((id: string) => {
    // 切空间会把当前 set 的 tab 整体收起来（含正在编辑的文档）→ 只有存在未保存改动才确认。
    const dirty = Object.entries(dirtyByPathRef.current)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (dirty.length > 0) {
      const names = dirty.map((p) => p.split('/').pop() || p).slice(0, 3).join('、');
      const more = dirty.length > 3 ? ` 等 ${dirty.length} 篇` : '';
      if (!window.confirm(`「${names}」${more}有未保存的修改，切换空间会丢弃这些修改，确定？`)) return;
    }
    endEdit();
    try { localStorage.setItem(ACTIVE_SET_KEY, id); } catch { /* ignore */ }
    applySet(id);
    const target = '/set/' + id;
    if (window.location.pathname !== target) {
      try { window.history.pushState(null, '', target); } catch { /* ignore */ }
    }
  }, [applySet, endEdit]);

  const saveSets = useCallback(
    async (next: SpaceSet[]) => {
      try {
        const res = await api.saveSets(next);
        setSets(res.sets);
        setSetsLoaded(true);
        // 当前 set 被删除时回退到第一个 set（并载入其 tab）。
        if (!res.sets.some((s) => s.id === activeSetIdRef.current)) {
          const fallback = res.sets[0]?.id || '';
          if (fallback) {
            try { localStorage.setItem(ACTIVE_SET_KEY, fallback); } catch { /* ignore */ }
            try { window.history.replaceState(null, '', '/set/' + fallback); } catch { /* ignore */ }
            applySet(fallback);
          } else {
            activeSetIdRef.current = '';
            setActiveSetId('');
            dispatch({ type: 'hydrate', docs: emptyDocs() });
          }
        }
        refreshData();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
      }
    },
    [refreshData, applySet],
  );

  const activeSet = useMemo<SpaceSet | null>(
    () => sets.find((s) => s.id === activeSetId) ?? null,
    [sets, activeSetId],
  );
  const activeDirs = activeSet?.dirs ?? [];

  const value = useMemo<StoreValue>(
    () => ({
      openDocs: docs.openDocs,
      activeDoc: docs.activeDoc,
      activeQuery: docs.activeQuery,
      activeRender,
      openDoc,
      activateDoc,
      closeDoc,
      closeDocs,
      reorderDocs,
      cacheRender,
      favorites,
      refreshFavorites,
      toggleFavorite,
      setFavorite,
      removeFavorite,
      isFavorite,
      isPinned,
      dataVersion,
      refreshData,
      docStat,
      sets,
      setsLoaded,
      activeSetId,
      activeSet,
      activeDirs,
      refreshSets,
      saveSets,
      switchSet,
      mdTheme,
      setMdTheme,
      mermaidTheme,
      setMermaidTheme,
      tocWidth,
      setTocWidth,
      hideEmptyDirs,
      setHideEmptyDirs,
      showFilename,
      setShowFilename,
      registerTocControl,
      tocExpandTo,
      tocOpenAll,
      editingPaths,
      dirtyByPath,
      beginEdit,
      endEdit,
      setEditingDirty,
      createDoc,
      renameDoc,
      fileIndex,
      tree,
      refreshTree,
      scrollTarget,
      clearScrollTarget,
    }),
    [
      docs,
      activeRender,
      openDoc,
      activateDoc,
      closeDoc,
      closeDocs,
      reorderDocs,
      cacheRender,
      favorites,
      refreshFavorites,
      toggleFavorite,
      setFavorite,
      removeFavorite,
      isFavorite,
      isPinned,
      dataVersion,
      refreshData,
      docStat,
      sets,
      setsLoaded,
      activeSetId,
      activeSet,
      activeDirs,
      refreshSets,
      saveSets,
      switchSet,
      mdTheme,
      setMdTheme,
      mermaidTheme,
      setMermaidTheme,
      tocWidth,
      setTocWidth,
      hideEmptyDirs,
      setHideEmptyDirs,
      showFilename,
      setShowFilename,
      registerTocControl,
      tocExpandTo,
      tocOpenAll,
      editingPaths,
      dirtyByPath,
      beginEdit,
      endEdit,
      setEditingDirty,
      createDoc,
      renameDoc,
      fileIndex,
      tree,
      refreshTree,
      scrollTarget,
      clearScrollTarget,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
