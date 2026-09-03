export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  title?: string;
  children?: TreeNode[];
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

export interface Root {
  url: string;
  dir: string;
}

export interface RootsResponse {
  roots: Root[];
  file: string;
  exists: boolean;
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
