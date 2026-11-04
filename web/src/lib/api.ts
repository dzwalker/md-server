import type {
  Backlink,
  DocCreateRequest,
  DocCreateResponse,
  DocRenameRequest,
  DocRenameResponse,
  DocSaveRequest,
  DocSaveResponse,
  Favorite,
  GraphData,
  NoteRequest,
  NoteResponse,
  NotesResponse,
  Outlink,
  RawFile,
  RecentFile,
  RenderBlockResponse,
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

  // 命令面板空态：当前空间内最近更新的文档（不传 dirs 则全局）。
  recent: (opts?: { dirs?: string[]; limit?: number }) => {
    const p = new URLSearchParams();
    if (opts?.dirs?.length) p.set('dirs', opts.dirs.join(','));
    p.set('limit', String(opts?.limit ?? 20));
    return get<RecentFile[]>(`/api/recent?${p.toString()}`);
  },

  tags: () => get<TagInfo[]>('/api/tags'),

  favorites: () => get<Favorite[]>('/api/favorites'),
  addFavorite: (path: string, pinned: boolean) => post<Favorite[]>('/api/favorites', { path, pinned }),
  removeFavorite: (path: string) => del<Favorite[]>(`/api/favorites${path}`),

  sets: () => get<SetsResponse>('/api/sets'),
  saveSets: (sets: SpaceSet[]) => post<SetsResponse>('/api/sets', sets),

  render: (path: string) => get<RenderResult>(`/api/render${path}`),
  // 笔记清单（只读）：侧栏「笔记」面板按当前空间目录汇总 `> note:` 行。
  notes: (opts?: { dirs?: string[] }) => {
    const p = new URLSearchParams();
    if (opts?.dirs?.length) p.set('dirs', opts.dirs.join(','));
    const qs = p.toString();
    return get<NotesResponse>(`/api/notes${qs ? `?${qs}` : ''}`);
  },
  // 笔记（`> note: 内容`）的插入 / 改写 / 删除：服务里唯一会写 md 文件的接口。
  saveNote: (req: NoteRequest) => post<NoteResponse>('/api/notes', req),
  // 原始文件内容（后端 /api/files/* 读磁盘原文），用于「下载 md 文件」与进入编辑态取全文。
  rawFile: (path: string) => get<RawFile>(`/api/files${path}`),
  // 正文编辑：整篇保存 / 新建 / 改名（见 specs/doc-editing/）。
  saveDoc: (req: DocSaveRequest) => post<DocSaveResponse>('/api/docs', req),
  createDoc: (req: DocCreateRequest) => post<DocCreateResponse>('/api/docs/create', req),
  renameDoc: (req: DocRenameRequest) => post<DocRenameResponse>('/api/docs/rename', req),
  // 编辑态图片上传：落到文档目录的 assets/，返回相对路径（写进 markdown）与 urlPath。
  uploadImage: async (docPath: string, file: File): Promise<{ relPath: string; urlPath: string; size: number }> => {
    const qs = new URLSearchParams({ path: docPath, name: file.name || 'image' });
    const res = await fetch(`/api/asset/upload?${qs.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) {
      let msg = `上传失败（${res.status}）`;
      try {
        const b = (await res.json()) as { error?: string };
        if (b?.error) msg = b.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return res.json() as Promise<{ relPath: string; urlPath: string; size: number }>;
  },
  // 块级实时预览（只读）：把一块源码按该文档的目录/术语表上下文渲染成 HTML。
  renderBlock: (path: string, markdown: string) =>
    post<RenderBlockResponse>('/api/render-block', { path, markdown }),
  stat: (path: string) =>
    get<{ exists: boolean; path: string; mtimeMs?: number; size?: number; glossaryVersion?: string }>(
      `/api/stat?path=${encodeURIComponent(path)}`,
    ),
  backlinks: (path: string) => get<Backlink[]>(`/api/backlinks${path}`),
  outlinks: (path: string) => get<Outlink[]>(`/api/outlinks${path}`),

  graph: () => get<GraphData>('/api/graph'),
};
