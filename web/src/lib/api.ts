import type {
  Backlink,
  Favorite,
  GraphData,
  RenderResult,
  Root,
  RootsResponse,
  SearchResult,
  SemanticResult,
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
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  tree: () => get<TreeNode[]>('/api/tree'),

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

  roots: () => get<RootsResponse>('/api/roots'),
  saveRoots: (roots: Root[]) => post<{ roots: Root[] }>('/api/roots', roots),

  render: (path: string) => get<RenderResult>(`/api/render${path}`),
  backlinks: (path: string) => get<Backlink[]>(`/api/backlinks${path}`),
  outlinks: (path: string) => get<string[]>(`/api/outlinks${path}`),

  graph: () => get<GraphData>('/api/graph'),
};
