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
  [key: string]: unknown;
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
