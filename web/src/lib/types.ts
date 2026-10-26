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

/** 目录条目里的一段：纯文本，或要用 KaTeX 渲染的行内公式（见 src/render.ts headingContent）。 */
export interface TocPart {
  type: 'text' | 'math';
  value: string;
}

export interface Heading {
  level: number;
  /** 纯文本兜底（实体已解码、公式为 LaTeX 原文）。 */
  text: string;
  id: string;
  /** 仅在标题里出现公式时给出：按片段渲染，否则直接用 text。 */
  parts?: TocPart[];
}

/** 术语浮层里的一条定义（服务端已渲染成 HTML，见 specs/glossary/）。 */
export interface GlossaryDef {
  /** 来源术语表文件名。 */
  source: string;
  html: string;
}

/** 一个术语名（含别名）在本次渲染里的定义信息。 */
export interface GlossaryTermInfo {
  /** 主名称 + 别名（规范化去重）。 */
  names: string[];
  /** 前 3 条定义（超出部分只在 total 里体现）。 */
  defs: GlossaryDef[];
  /** 该名字被定义的总条数（去重后）。 */
  total: number;
}

/** `/api/render` 附带的本篇命中术语定义。 */
export interface GlossaryPayload {
  version: string;
  terms: Record<string, GlossaryTermInfo>;
}

export interface RenderResult {
  path: string;
  title: string;
  html: string;
  headings: Heading[];
  /** 磁盘 mtime：写笔记时用作乐观锁，避免覆盖别处的改动。 */
  mtimeMs?: number;
  /** 术语表集合版本（无术语表时为空串）。 */
  glossaryVersion?: string;
  /** 仅本文档命中了术语时给出。 */
  glossary?: GlossaryPayload | null;
  [key: string]: unknown;
}

/** 一条笔记（`> note: 内容` 一行）：行号 1-based，text 是笔记正文的原始 markdown。 */
export interface NoteRef {
  line: number;
  text: string;
}

/** 有笔记的文档（`GET /api/notes`，见 specs/notes-browse/）。 */
export interface NoteFile {
  path: string;
  title: string;
  name: string;
  dir: string;
  notes: NoteRef[];
}

export interface NotesResponse {
  files: NoteFile[];
  /** 笔记总条数。 */
  count: number;
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

/** /api/outlinks/* 的响应项：同一目标聚合为一条，count = 正文里出现的次数。 */
export interface Outlink {
  target: string;
  count: number;
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
