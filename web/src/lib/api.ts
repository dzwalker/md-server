import type {
  Backlink,
  Favorite,
  GraphData,
  RawFile,
  RenderResult,
  SearchResult,
  SemanticResult,
  SpaceSet,
  SetsResponse,
  TagInfo,
  TreeNode,
} from './types';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `POST ${url} -> ${res.status}`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    let msg = `DELETE ${url} -> ${res.status}`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tree: () => get<TreeNode[]>('/api/tree'),

  status: () => get<{ dataVersion: number }>('/api/status'),

  search: (q: string, opts?: { tag?: string; dir?: string; limit?: number }) => {
    const p = new URLSearchParams({ q });
    if (opts?.tag) p.set('tag', opts.tag);
    if (opts?.dir) p.set('dir', opts.dir);
    if (opts?.limit) p.set('limit', String(opts.limit));
    return get<SearchResult[]>(`/api/search?${p.toString()}`);
  },

  searchSemantic: (q: string, limit = 10) =>
    get<SemanticResult[]>(`/api/search-semantic?q=${encodeURIComponent(q)}&limit=${limit}`),

  tags: () => get<TagInfo[]>('/api/tags'),

  favorites: () => get<Favorite[]>('/api/favorites'),
  addFavorite: (path: string, pinned: boolean) => post<Favorite[]>('/api/favorites', { path, pinned }),
  removeFavorite: (path: string) => del<Favorite[]>(`/api/favorites${path}`),

  sets: () => get<SetsResponse>('/api/sets'),
  saveSets: (sets: SpaceSet[]) => post<SetsResponse>('/api/sets', sets),

  render: (path: string) => get<RenderResult>(`/api/render${path}`),
  // 原始文件内容（后端 /api/files/* 读磁盘原文），用于「下载 md 文件」。
  rawFile: (path: string) => get<RawFile>(`/api/files${path}`),
  stat: (path: string) => get<{ exists: boolean; path: string; mtimeMs?: number; size?: number }>(`/api/stat?path=${encodeURIComponent(path)}`),
  backlinks: (path: string) => get<Backlink[]>(`/api/backlinks${path}`),
  outlinks: (path: string) => get<string[]>(`/api/outlinks${path}`),

  graph: () => get<GraphData>('/api/graph'),
};
