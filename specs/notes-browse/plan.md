# plan: 笔记浏览（右侧目录内联笔记 + 左侧「笔记」面板）

## 技术方案

### 1. 服务端：只读笔记清单（不新增表）

- `src/notes.ts`：`extractNotes(body) → [{line,text}]`，逐行 `NOTE_LINE_RE`，维护 ``` / ~~~ 围栏状态（关闭围栏要求同字符、不短于开启长度、后面只有空白）——与 `render.ts` 的块级 notePlugin 口径一致，避免面板里出现正文中并不存在的「幽灵笔记」。
- `src/index-db.ts`：`listNotes({dirs})` 直接 `SELECT path,title,name,dir,body FROM files WHERE path LIKE '/<dir>/%'`，在 JS 里跑 `extractNotes`，只返回有笔记的文件。
  - **为什么现算而不建 notes 表**：`files.body` 本来就在库里，省掉建表 + 迁移 + 增量同步三处出错点；当前笔记量（全库个位数）下每次请求成本可忽略，真到卡顿再落表。
- `src/index.ts`：`GET /api/notes?dirs=a,b`（解析口径照抄 `/api/recent`），返回 `{files,count}`。路由只做参数解析。

### 2. 右侧目录：笔记直接读正文 DOM

- 打开开关后 `useEffect` 扫 `.md-content`：
  - 标题：`h1..h6[id][data-line-start]`（`srcLinePlugin` 打的锚点）按行号排序；
  - 笔记：`.md-note[data-note-line][data-note-raw]` 按行号排序；
  - 归属：每条形如「最后一个 `line-start ≤ 笔记行号` 的标题」，没有前序标题的进「文首」伪节点。
- 选 DOM 而不是接口的理由：正文已经渲染好，`.md-note` 的存在/行号/原文天然与渲染一致（围栏里的假笔记不会有卡片），也省一次往返；`activeRender` 变化（含保存笔记后的重渲染）触发重扫。
- 树结构：笔记节点作为所属标题 children 的**最前面**若干项；笔记节点 `id = note:<行号>`，点击走 `scrollToNote(line)`（滚到 + 闪烁），不参与 scroll-spy。
- 开关状态存 `localStorage['md-toc-notes']`，默认开。

### 3. 左侧「笔记」面板

- `lib/activities.ts` 加 `{id:'notes', label:'笔记', icon: NotebookPen}`（排在资源管理器后）；`sidebar.tsx` 传 `isActive`，面板常驻挂载但**首次真正切到该 tab 才请求**（避免每次启动都拉笔记）。
- `components/sidebar/notes-panel.tsx`：`GET /api/notes` 一次拉回当前空间的清单 →
  - 分组：`path` 第一段 = 所属一级目录，顺序按 `activeSet.dirs`（只留最上级，不再下钻子目录）；
  - 层级按钮：`目录`（全收起）/ `文件`（展开目录）/ `笔记`（全展开）；
  - 搜索：本地 `toLowerCase().includes(q)`，只留命中的笔记并自动展开；
  - 交互：点目录名 = 收起/展开；点文件名的**箭头** = 收起/展开它的笔记，点**文件名** = 打开文档并展开它的笔记；点笔记行 = 打开文档 + 跳到该行。
  - `dataVersion` 变化后 800ms 去抖刷新（磁盘上别的改动也可能动笔记）。
- 跳转复用既有通道：`openDoc(path, title, null, 'note:<行号>')` → store 的 `scrollTarget` → `doc-view` 里 `findAnchor` 解析 `note:<行号>` 到 `.md-note[data-note-line]`，滚动并 `flashNote`（`index.css` 的 1.2s 高亮动画）。

## 影响面

| 文件 | 改动 |
|---|---|
| `src/notes.ts` / `src/notes.test.ts` | `extractNotes` + 6 例 |
| `src/index-db.ts` / `src/index-db.test.ts` | `listNotes` + 3 例 |
| `src/index.ts` | `GET /api/notes` 路由 |
| `web/src/lib/{types,api,activities,doc-links,notes}.ts` | 类型 / 客户端方法 / 活动项 / `note:` 锚点 / 预览与跳转辅助 |
| `web/src/components/sidebar.tsx`、`sidebar/notes-panel.tsx`（新） | 新面板 |
| `web/src/components/toc-panel.tsx` | 笔记开关 + 笔记节点 |
| `web/src/index.css` | 笔记落点闪烁 |

- 兼容性：`/api/render`、`POST /api/notes`、索引流程、写盘路径全不动；新接口是只读的。
- 行为变化：目录的 `1/2/3` 层级按钮会把「带笔记的标题」也算作有子节点，因此点 `1` 会连笔记一起收起（否则预览挂在折叠标题下）。已在 spec 里写明。
- 启动开销：笔记清单是惰性加载（首次切到笔记 tab），不影响首屏。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 面板与正文口径不一致（围栏误判） | 提取逻辑与渲染同为「块级 + 围栏跳过」，并有单测锁定 |
| 全库现算变慢 | 一次 SQL + 正则；笔记量与空间大小都在可控范围，必要时再落表 |
| 跳转落点被正文二次渲染（KaTeX/mermaid）顶偏 | 复用既有 `scrollTarget` 通道（它在正文渲染后执行），并加闪烁提示落点 |
| 大空间下 DOM 节点过多 | 只有「有笔记的文件」才出现在面板里，且默认收起 |

回滚：改动集中在 7 个文件 + 1 个新组件，`git revert` 即可；无迁移、无依赖变更、无生产数据写入。
