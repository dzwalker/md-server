export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file' | 'tool';
  title?: string;
  children?: TreeNode[];
  toolId?: string;
}

export interface SearchResult {
  path: string;
  title: string;
  dir: string;
  frontmatter?: Record<string, unknown>;
  snippet: string;
}

export interface SemanticResult {
  path: string;
  title: string;
  score: number;
}

/** /api/recent 的响应：命令面板空态「最近更新」列表项。 */
export interface RecentFile {
  path: string;
  title: string;
  name: string;
  dir: string;
  mtimeMs: number;
}

export interface TagInfo {
  tag: string;
  cnt: number;
}

export interface Favorite {
  path: string;
  title: string;
  dir: string;
  pinned: boolean;
  addedAt: number;
}

export interface SpaceSet {
  id: string;
  name: string;
  dirs: string[];
  embed: boolean;
}

export interface SetsResponse {
  baseDir: string;
  sets: SpaceSet[];
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface RenderResult {
  path: string;
  title: string;
  html: string;
  headings: Heading[];
  /** 磁盘 mtime：写笔记时用作乐观锁，避免覆盖别处的改动。 */
  mtimeMs?: number;
  [key: string]: unknown;
}

/** POST /api/notes 的请求体：笔记的插入 / 改写 / 删除（见 specs/notes/）。 */
export interface NoteRequest {
  path: string;
  op: 'insert' | 'update' | 'delete';
  /** insert：插在这一行之后（1-based） */
  afterLine?: number;
  /** update / delete：目标笔记行号（1-based） */
  line?: number;
  text?: string;
  mtimeMs?: number;
}

export interface NoteResponse {
  ok: boolean;
  path: string;
  line: number;
  mtimeMs: number;
  size: number;
}

/** /api/files/* 的响应：文件元信息 + 磁盘原文。 */
export interface RawFile {
  urlPath: string;
  name: string;
  title: string;
  dir: string;
  content: string;
  fsPath?: string;
  mtimeMs?: number;
  size?: number;
  [key: string]: unknown;
}

export interface Backlink {
  path: string;
  title?: string;
}

export interface GraphNode {
  path: string;
  title: string;
  dir: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
