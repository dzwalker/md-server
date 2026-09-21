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
import type { Favorite, RenderResult, SpaceSet, TreeNode } from '@/lib/types';
import { TOC_WIDTH_DEFAULT, TOC_WIDTH_MAX, TOC_WIDTH_MIN } from '@/lib/toc';
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
  | { type: 'reorder'; from: number; to: number };

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
    case 'close': {
      const i = state.openDocs.findIndex((d) => d.path === action.path);
      if (i < 0) return state;
      const openDocs = state.openDocs.filter((d) => d.path !== action.path);
      const activeDoc =
        state.activeDoc === action.path
          ? openDocs.length
            ? openDocs[Math.max(0, i - 1)].path
            : null
          : state.activeDoc;
      return { openDocs, activeDoc, activeQuery: activeDoc === action.path ? null : state.activeQuery };
    }
    case 'reorder': {
      const openDocs = [...state.openDocs];
      const [moved] = openDocs.splice(action.from, 1);
      openDocs.splice(action.to, 0, moved);
      return { ...state, openDocs };
    }
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
}

const StoreContext = createContext<StoreValue | null>(null);

const OPEN_TABS_KEY = 'md-open-tabs';

function loadInitialDocs(): DocsState {
  if (typeof window === 'undefined') return { openDocs: [], activeDoc: null, activeQuery: null };
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DocsState>;
      if (parsed && Array.isArray(parsed.openDocs)) {
        return {
          openDocs: (parsed.openDocs as OpenDoc[]).filter(
            (d) => d && typeof d.path === 'string' && typeof d.title === 'string',
          ),
          activeDoc: typeof parsed.activeDoc === 'string' ? parsed.activeDoc : null,
          activeQuery: typeof parsed.activeQuery === 'string' ? parsed.activeQuery : null,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { openDocs: [], activeDoc: null, activeQuery: null };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [docs, dispatch] = useReducer(docsReducer, undefined, loadInitialDocs);

  // 已打开的 tab 持久化到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        OPEN_TABS_KEY,
        JSON.stringify({ openDocs: docs.openDocs, activeDoc: docs.activeDoc, activeQuery: docs.activeQuery }),
      );
    } catch {
      /* ignore */
    }
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
  const closeDoc = useCallback((path: string) => dispatch({ type: 'close', path }), []);
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

  // 轮询后端数据版本：磁盘上有文件增删改时，后端 chokidar 重建索引并 +1，
  // 前端据此自动刷新树/标签等（轻量端点，无全量扫描）。
  useEffect(() => {
    let alive = true;
    let last: number | null = null;
    const tick = async () => {
      try {
        const v = (await api.status()).dataVersion;
        if (!alive) return;
        if (last !== null && v !== last) refreshData();
        last = v;
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [refreshData]);

  const ACTIVE_SET_KEY = 'md-active-set';

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
      if (id) {
        setActiveSetId(id);
        try { localStorage.setItem(ACTIVE_SET_KEY, id); } catch { /* ignore */ }
        if (!m) {
          try { window.history.replaceState(null, '', '/set/' + id); } catch { /* ignore */ }
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  // 浏览器前进/后退时同步当前 set
  useEffect(() => {
    const onPop = () => {
      const m = window.location.pathname.match(/^\/set\/([A-Za-z0-9_-]+)\/?$/);
      if (!m) return;
      try { localStorage.setItem(ACTIVE_SET_KEY, m[1]); } catch { /* ignore */ }
      setActiveSetId(m[1]);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const switchSet = useCallback((id: string) => {
    setActiveSetId(id);
    try { localStorage.setItem(ACTIVE_SET_KEY, id); } catch { /* ignore */ }
    const target = '/set/' + id;
    if (window.location.pathname !== target) {
      try { window.history.pushState(null, '', target); } catch { /* ignore */ }
    }
  }, []);

  const saveSets = useCallback(
    async (next: SpaceSet[]) => {
      try {
        const res = await api.saveSets(next);
        setSets(res.sets);
        setSetsLoaded(true);
        setActiveSetId((cur) => {
          if (res.sets.some((s) => s.id === cur)) return cur;
          const fallback = res.sets[0]?.id || '';
          if (fallback) {
            try { localStorage.setItem(ACTIVE_SET_KEY, fallback); } catch { /* ignore */ }
            try { window.history.replaceState(null, '', '/set/' + fallback); } catch { /* ignore */ }
          }
          return fallback;
        });
        refreshData();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
      }
    },
    [refreshData],
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
