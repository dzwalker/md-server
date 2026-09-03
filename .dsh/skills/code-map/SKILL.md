---
name: code-map
description: 维护 md-server 的代码地图（模块职责/分层/入口），改动前先查图定位，避免误读大文件。
whenToUse: 需要理解或修改 md-server 结构时（尤其 public/index.html 单文件前端、src 多模块职责划分）。
---

# 代码地图（code-map）

## 当前代码地图（md-server）

### 后端 src/（TypeScript，tsx 直跑，无编译）

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `config.ts` | roots 多空间加载/热更、端口、排除目录 | `ROOTS`, `PORT`, `reloadRoots` |
| `scanner.ts` | 扫描 md → `MdFile` 列表 + 目录树（只读 fs） | `scanAll`, `buildTree`, `MdFile` |
| `index-db.ts` | SQLite 索引：全文/拼音检索、标签、双链/反链/图谱、收藏、待办/到期 | `rebuildIndex`, `searchFiles`, `listTags`, `backlinks`, `outlinks`, `graph`, `listFavorites`, `setFavorite`, `removeFavorite`, `listTodos`, `listDueTasks` |
| `render.ts` | markdown-it 渲染（KaTeX / emoji / task / footnote / highlight） | `renderMarkdown` |
| `embed.ts` | 语义向量（HF transformers + sqlite） | `buildEmbeddings`, `embedFiles`, `deleteEmbeddings`, `semanticSearch`, `embeddingsStatus` |
| `mcp.ts` | MCP 工具服务（SSE，端口 3002） | `startMcp` |
| `index.ts` | 装配：HTTP 路由 + 文件 watcher 实时索引 + 启动 | 入口 |

### 前端 public/index.html（单文件 933 行，HTML+CSS+JS 混排）

- 结构：活动栏（`#activity-bar`）/ 侧栏（`#sidebar`：搜索 + 树 + 图）/ 主区（`#main`：tabs + 渲染）
- 依赖 API：`/api/tree` `/api/files` `/api/render` `/api/search` `/api/search-semantic` `/api/tags` `/api/backlinks` `/api/outlinks` `/api/graph` `/api/favorites` `/api/todos` `/api/roots`
- 渲染库：页面内加载静态资源 `/media/*`（katex / mermaid / highlight）

### 基础设施

- `Dockerfile`：node:22-slim，`npx tsx` 启动
- `docker-compose.yml`：挂载 `src`/`public` 热更、外部 `infra` 网络、`/data` 卷
- 数据：`/data/index/md-index.db`（SQLite，含 `fts5` / `embeddings` 表）

## 维护规则

- 新增模块或改职责时，更新本地图。
- 改 `public/index.html` 前先定位目标区域（活动栏/侧栏/主区），避免整文件盲改。
- 推荐配置 TypeScript LSP 辅助跳转与查引用。
