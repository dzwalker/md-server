---
name: code-map
description: 维护 md-server 的代码地图（模块职责/分层/入口），改动前先查图定位，避免误读大文件。
whenToUse: 需要理解或修改 md-server 结构时（web/ 前端 React 工程的分层、src/ 多模块职责划分）。
---

# 代码地图（code-map）

## 当前代码地图（md-server）

### 后端 src/（TypeScript，tsx 直跑，无编译）

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `config.ts` | roots 多空间加载/热更、端口、排除目录 | `ROOTS`, `PORT`, `reloadRoots` |
| `scanner.ts` | 扫描 md → `MdFile` 列表 + 目录树（只读 fs） | `scanAll`, `buildTree`, `MdFile` |
| `index-db.ts` | SQLite 索引：全文/拼音检索、标签、双链/反链/图谱、收藏、待办/到期、最近更新 | `rebuildIndex`, `searchFiles`, `listTags`, `backlinks`, `outlinks`, `graph`, `listFavorites`, `setFavorite`, `removeFavorite`, `listTodos`, `listDueTasks`, `listFileSummaries`, `listFilesMeta`, `getFileMeta`, `listRecentFiles` |
| `render.ts` | markdown-it 渲染（KaTeX / emoji / task / footnote / highlight） | `renderMarkdown` |
| `embed.ts` | 语义向量（HF transformers + sqlite） | `buildEmbeddings`, `embedFiles`, `deleteEmbeddings`, `semanticSearch`, `embeddingsStatus` |
| `mcp.ts` | MCP 工具服务（SSE，端口 3002） | `startMcp` |
| `index.ts` | 装配：HTTP 路由 + 文件 watcher 实时索引 + 启动 | 入口 |

### 前端 web/（React 18 + Vite + Tailwind v4 + shadcn/ui；`public/index.html` 是旧版单文件，仅未构建 dist 时兜底）

构建：`cd web && npm run build` → `web/dist`（后端静态托管 + SPA fallback）。改前端源码后**必须重新构建**才会在 :3001 生效。

| 区域 | 文件 | 职责 |
|---|---|---|
| 入口/布局 | `src/App.tsx` | 三栏可拖拽布局、移动端抽屉、全局快捷键（⌘P 命令面板 / ⌘O 已打开文档看板 / ⌘B 侧栏） |
| 状态 | `src/state/store.tsx` | 全局 store：打开的 tab（localStorage 持久化）、树、收藏、空间 set、主题/TOC 宽度等偏好 |
| 弹层 | `src/components/command-palette.tsx` | ⌘P：空态「最近更新」（`/api/recent`，当前空间最近 20 篇），输入后走 `/api/search` |
| 弹层 | `src/components/opened-switcher.tsx` | ⌘O：已打开文档看板，一列 = 一个一级目录，`←→↑↓` 导航 + Enter 打开 |
| 主区 | `src/components/doc-view.tsx` | 文档头 + tab 栏（dnd-kit 拖拽）+ 正文渲染 + TOC |
| 侧栏 | `src/components/sidebar*.tsx` | 资源管理器（react-arborist）/ 已打开 / 标签 / 收藏 / 空间 / 设置 |
| 库 | `src/lib/api.ts`, `lib/types.ts` | HTTP API 封装与响应类型（新增接口同步这两处） |
| 库 | `src/lib/markdown-extras.ts`, `mermaid-*.ts`, `md-themes.ts` | 客户端二次渲染 katex/mermaid、导出、Markdown 主题 |

- 依赖 API：`/api/tree` `/api/files` `/api/files/*` `/api/render/*` `/api/stat` `/api/search` `/api/search-semantic` `/api/recent` `/api/tags` `/api/backlinks/*` `/api/outlinks/*` `/api/graph` `/api/favorites` `/api/todos` `/api/sets` `/api/status` `/api/asset/*`
- 渲染库：按需加载 `/media/*`（katex / mermaid / highlight）

### 基础设施

- `Dockerfile`：node:22-slim，`npx tsx` 启动
- `docker-compose.yml`：挂载 `src`/`public` 热更、外部 `infra` 网络、`/data` 卷
- 数据：`/data/index/md-index.db`（SQLite，含 `fts5` / `embeddings` 表）

## 维护规则

- 新增模块或改职责时，更新本地图。
- 改 `web/src/components/doc-view.tsx`（491 行）前先定位目标区域（tab 栏 / 文档头 / 正文 / TOC），避免整文件盲改。
- 改前端后必须 `web/ npm run build`，否则 :3001 仍是旧产物。
- 推荐配置 TypeScript LSP 辅助跳转与查引用。
