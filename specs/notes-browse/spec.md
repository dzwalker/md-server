# spec: 笔记浏览（右侧目录内联笔记 + 左侧「笔记」面板）

## 背景

笔记（`> note: 内容` 一行，见 `specs/notes/`）此前只能在正文里逐篇看到：没有「全局有哪些笔记」的视图，跳转也只能靠翻正文。用户需要两件事：

1. 右侧「目录」面板里直接看到当前文档的笔记——挂在**所属标题的下一级**，带笔记图标，点击跳到那条笔记。
2. 左侧新增「笔记」tab（形式类似「资源管理器」）：当前空间 → 一级目录（只留最上级）→ 有笔记的文件 → 每条笔记预览，目录/文件可收起、顶部搜索按笔记文字精确匹配。

## 目标

1. 目录面板标题行右侧加笔记图标开关（默认开，记住上次状态）；开时每条笔记作为所属标题的下一级出现，前面是笔记图标、后面是单行预览，点击滚到正文里那条笔记并短暂高亮。
2. 新增侧栏活动「笔记」，三级树 + 顶部搜索 + 「目录 / 文件 / 笔记」三个层级按钮（替代资源管理器的 1/2/3/a）。
3. 服务端新增**只读**接口 `GET /api/notes?dirs=a,b`（dirs 口径同 `/api/recent`），返回按文件聚合的笔记清单。
4. 笔记提取口径与渲染一致：代码围栏（``` / ~~~）里的 `> note:` **不算**笔记。

## 非目标

- 不在笔记面板里新建/编辑/删除笔记（仍在正文右键菜单）。
- 不做服务端笔记搜索（清单一次拉回、前端本地过滤）。
- 不新增 MCP 工具、不引入新依赖、不新增索引表（不改索引流程、无迁移）。
- 不改 `POST /api/notes` 写盘路径与 `/api/render` 返回结构。
- 笔记预览是**单行纯文本**（公式显示 LaTeX 原文），不在侧栏渲染 KaTeX。

## 验收标准（Given-When-Then）

**A. 服务端**

- [x] Given 正文 `# t\n\n> note: A\n正文\n> note:B\n`，When `extractNotes`，Then `[{line:3,text:'A'},{line:5,text:'B'}]`（1-based、紧凑写法也认）。
- [x] Given 代码围栏里的 `> note: 示例`，Then 既不算笔记（`extractNotes`）也不出现在 `listNotes` 结果里。
- [x] Given 两个空间目录各有带笔记的文件，When `listNotes({dirs:['r1']})`，Then 只返回 `r1` 下的；不传 `dirs` 则全局；没有笔记的文件不返回。
- [x] Given `GET /api/notes?dirs=demo,demo2`，Then 返回 `{files:[{path,title,name,dir,notes:[{line,text}]}],count}`。

**B. 右侧目录（浏览器实测）**

- [x] 打开含 3 条笔记的文档：目录里 `.md-toc-note` 3 条，分别嵌在 `标题`(h1)、`公式…`(h2)、`分辨率…`(h3) 节点的下一级（`ul.pl-3`）。
- [x] 笔记出现在第一个标题之前时，挂在「文首」伪节点下，不会消失。
- [x] 点第 3 条笔记 → 正文 `[data-note-line="13"]` 滚入视口且带 `md-note-flash` 高亮。
- [x] 点笔记图标 → 关闭（`.md-toc-note` 0 条、`md-toc-notes=0`）；再点 → 恢复（3 条、`md-toc-notes=1`）。

**C. 左侧「笔记」面板（浏览器实测）**

- [x] 一级目录两组：`demo`「2 篇 · 5 条」、`demo2`「1 篇 · 1 条」；代码围栏里的假笔记不出现。
- [x] 层级按钮：`目录` → 只剩一级目录；`文件` → 展开到文件；`笔记` → 全展开并显示每条预览。
- [x] 搜索 `zebra` → 只剩 `sample.md` 那一篇的 1 条，右上显示「1 条匹配」；搜索 `alpha` → 只剩 `demo2`。
- [x] 点目录名 → 收起（其下文件/笔记消失）；点文件名的箭头 → 只收起/展开笔记。
- [x] 点文件名 → 打开该文档（tab 激活）并展开它的笔记。
- [x] 点笔记行（跨文件）→ 打开对应文档并跳到那条笔记（`md-note-flash`，落点在内容区顶部）。

**D. 门禁**

- [x] `npx tsc --noEmit`（根 + `web/`）通过。
- [x] `npm test` 全绿（73 例：`extractNotes` +6、`listNotes` +3）。

## 交付记录

- 2026-09-29 服务端：`src/notes.ts` 加 `extractNotes`（围栏感知）；`src/index-db.ts` 加 `listNotes`（读 files.body 现算）；`src/index.ts` 加 `GET /api/notes`。
- 2026-09-29 前端：`lib/activities.ts` + `sidebar.tsx` 加「笔记」活动；新增 `components/sidebar/notes-panel.tsx`；`toc-panel.tsx` 加笔记开关与笔记节点；`lib/doc-links.ts` 的 `findAnchor` 支持 `note:<行号>`；`lib/notes.ts` 加 `notePreview` / `scrollToNote` / `flashNote`；`index.css` 加落点闪烁。
- 2026-09-29 实测：隔离实例（`MD_BASE_DIR`/`MD_SETS_FILE`/`MD_INDEX_DB` 都在 `/tmp/md-verify`，`MD_PORT=3011`）+ headless Chromium 断言 B/C 全部条目（脚本 `/tmp/md-verify/check-notes*.py`）。
- 2026-09-29 **未上线**：本机 `md-server` 容器仍是旧镜像，需 `docker compose up -d --build`（需用户批准）。
