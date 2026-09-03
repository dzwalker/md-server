import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import type { Favorite, RenderResult } from '@/lib/types';

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

interface StoreValue {
  openDocs: OpenDoc[];
  activeDoc: string | null;
  activeQuery: string | null;
  activeRender: RenderResult | null;
  openDoc: (path: string, title?: string, query?: string | null) => void;
  activateDoc: (path: string) => void;
  closeDoc: (path: string) => void;
  reorderDocs: (from: number, to: number) => void;
  setActiveRender: (r: RenderResult | null) => void;
  favorites: Favorite[];
  refreshFavorites: () => Promise<void>;
  toggleFavorite: (path: string) => Promise<void>;
  setFavorite: (path: string, pinned: boolean) => Promise<void>;
  removeFavorite: (path: string) => Promise<void>;
  isFavorite: (path: string) => boolean;
  isPinned: (path: string) => boolean;
  dataVersion: number;
  refreshData: () => void;
  mdTheme: string;
  setMdTheme: (t: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [docs, dispatch] = useReducer(docsReducer, {
    openDocs: [],
    activeDoc: null,
    activeQuery: null,
  });
  const [activeRender, setActiveRender] = useState<RenderResult | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
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

  const openDoc = useCallback((path: string, title?: string, query?: string | null) => {
    dispatch({
      type: 'open',
      path,
      title: title || path.split('/').pop() || path,
      query: query ?? null,
    });
  }, []);

  const activateDoc = useCallback((path: string) => dispatch({ type: 'activate', path }), []);
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
      setActiveRender,
      favorites,
      refreshFavorites,
      toggleFavorite,
      setFavorite,
      removeFavorite,
      isFavorite,
      isPinned,
      dataVersion,
      refreshData,
      mdTheme,
      setMdTheme,
    }),
    [
      docs,
      activeRender,
      openDoc,
      activateDoc,
      closeDoc,
      reorderDocs,
      favorites,
      refreshFavorites,
      toggleFavorite,
      setFavorite,
      removeFavorite,
      isFavorite,
      isPinned,
      dataVersion,
      refreshData,
      mdTheme,
      setMdTheme,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
