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
| `render.ts` | markdown-it 渲染（KaTeX / emoji / task / footnote / highlight + 笔记卡片 + 块级行号锚点） | `renderMarkdown` |
| `file-write.ts` | 写 md 的唯一底座：只允许 .md、临时文件 + rename 原子替换、保持属主/属组/权限、mtime 乐观锁 | `WriteError`, `statMdFile`, `checkMtimeLock`, `writeFileAtomic` |
| `notes.ts` | 正文笔记（`> note: 内容` 一行）：识别 / 增改删（落盘走 `file-write.ts`，见 `specs/notes/`） | `applyNoteToFile`, `applyNoteOp`, `toNoteOpInput`, `isNoteLine`, `NoteError` |
| `docs.ts` | 正文文档文件级操作：整篇保存 / 新建 / 改名 + 文件名校验（见 `specs/doc-editing/`） | `saveDocFile`, `createDocFile`, `renameDocFile`, `validateDocBaseName`, `DocError` |
| `glossary.ts` | 术语表：命名/解析/按空间 set 聚合/匹配器/版本（见 `specs/glossary/`） | `isGlossaryFileName`, `parseGlossaryMarkdown`, `buildGlossaryIndex`, `glossaryForDoc`, `glossaryVersionForDoc` |
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
| 侧栏 | `src/components/sidebar*.tsx` | 资源管理器（react-arborist，文件树右键菜单：复制文件名/复制完整路径/下载/重命名，目录节点「新建 Markdown 文件」，见 `specs/explorer-context-menu/`、`specs/doc-editing/`）/ 已打开 / 标签 / 收藏 / 空间 / 设置 |
| 主区 | `src/components/doc-view.tsx` | 文档头（编辑 / 收藏 / 下载 / 保存·取消）+ tab 栏（dnd-kit 拖拽）+ 正文渲染（**命令式注入**：`{el, key}` 决定何时整篇重写，笔记保存走局部替换）+ TOC + 正文右键笔记菜单 / 就地编辑 / 删除确认；编辑态：渲染区 `display:none` + `DocEditor` 接管、暂停轮询、`⌘S`/`Esc`、未保存守卫 |
| 主区 | `src/components/doc-editor.tsx` | 正文编辑器（见 `specs/doc-editing/`）：按块行区间切成「段」，**连续行内块合并成一个编辑区（region）**，独立块单独；单栏——空闲显示服务端渲染结果（与预览逐像素对齐），点进去原地换成带格式装饰的源码编辑器；文档头可切换 分块/源码/Muya/Milkdown；保存走 `/api/docs`（409 → 覆盖保存 / 重新载入） |
| 编辑器 | `src/components/block-source-editor.tsx` | 单块源码编辑器的 React 包装：进入编辑态才 `import()` CodeMirror；初始值只取一次（受控回写会打断输入法/撤销栈） |
| 编辑器 | `src/components/muya-editor.tsx` | Muya（MarkText 内核 `@muyajs/core`）模式：按需加载，保存走 turndown（会规范化 md） |
| 编辑器 | `src/components/milkdown-editor.tsx` | Milkdown **Crepe**（`@milkdown/crepe`）模式：开箱即用的富文本（`/` 插入、块手柄、表格、LaTeX），按需加载，保存走 remark 序列化（会规范化 md） |
| 编辑器 | `src/components/rich-editor-types.ts` | 编辑器模式清单（分块/源码/Muya/Milkdown）与富文本统一句柄（`flush()` 保存前同步取最新 markdown） |
| 编辑器 | `src/lib/md-codemirror.ts` | CodeMirror 6 单栏 Markdown 编辑器：Lezer 语法树 + 正则兜底做行内装饰（粗体/斜体/行内代码/链接/双链/行内公式/图片/标题/引用），光标进入即还原源码；列表回车续行、Tab 缩进、Esc 收起；独立 chunk（约 492KB） |
| 弹层 | `src/components/doc-name-dialog.tsx` | 「新建 / 重命名」共用的命名对话框（聚焦全选、`.md` 后缀、Enter/Esc、失败红字不关闭） |
| 库 | `src/lib/api.ts`, `lib/types.ts` | HTTP API 封装与响应类型（新增接口同步这两处） |
| 库 | `src/lib/download.ts`, `lib/clipboard.ts` | 下载 md 原文（`downloadDocByPath`，文档头与右键菜单共用）/ 复制到剪贴板（含非安全上下文降级） |
| 库 | `src/lib/markdown-extras.ts`, `mermaid-*.ts`, `md-themes.ts` | 客户端二次渲染 katex/mermaid、导出、Markdown 主题 |
| 库 | `src/lib/glossary.ts` | 术语浮层：事件委托、定位翻转、定义渲染（见 `specs/glossary/`） |
| 库 | `src/lib/notes.ts` | 笔记右键定位（`resolveNoteContext`）+ 就地编辑器（`startInsertEditor` / `startNoteEditor` / `closeActiveNoteEditor`，命令式 DOM） |
| 库 | `src/lib/note-patch.ts` | 保存笔记时只替换目标那张卡片（整篇 DOM 不动 → 公式/图表不闪），并重编号下方块行号（见 `specs/notes/plan.md` §7） |
| 库 | `src/lib/scroll-anchor.ts` | 正文整篇重注入时的滚动位置保持（content-visibility 估值漂移的补偿，见 `specs/notes/plan.md` §5） |

- 依赖 API：`/api/tree` `/api/files` `/api/files/*` `/api/render/*`（含 `glossary`）`/api/stat`（含 `glossaryVersion`）`/api/notes`（POST，写笔记行）`/api/docs`（POST 整篇保存）`/api/docs/create`（POST 新建）`/api/docs/rename`（POST 改名）`/api/render-block`（POST 块级预览，只读）`/api/search` `/api/search-semantic` `/api/recent` `/api/tags` `/api/backlinks/*` `/api/outlinks/*` `/api/graph` `/api/favorites` `/api/todos` `/api/sets` `/api/status` `/api/asset/*`
- 渲染库：按需加载 `/media/*`（katex / mermaid / highlight）；编辑器：`web/src/lib/md-codemirror.ts` 只在进入编辑态时动态加载（`md-codemirror-*.js`）

### 基础设施

- `Dockerfile`：node:22-slim，`npx tsx` 启动
- `docker-compose.yml`：挂载 `src`/`public` 热更、外部 `infra` 网络、`/data` 卷
- 写盘边界：`/api/notes` 只改笔记行；`/api/docs*` 改整篇/新建/改名；两者都必须走 `src/file-write.ts`（原子写 + 属主/权限保持 + mtime 乐观锁）
- 数据：`/data/index/md-index.db`（SQLite，含 `fts5` / `embeddings` 表）

## 维护规则

- 新增模块或改职责时，更新本地图。
- 改 `web/src/components/doc-view.tsx`（491 行）前先定位目标区域（tab 栏 / 文档头 / 正文 / TOC），避免整文件盲改。
- 改前端后必须 `web/ npm run build`，否则 :3001 仍是旧产物。
- 推荐配置 TypeScript LSP 辅助跳转与查引用。
