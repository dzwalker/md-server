# tasks: 正文编辑（新建 / 改名 / 编辑保存正文，2026-11-03）

## T1 后端：写盘底座与文档业务

- [x] 新增 `src/file-write.ts`：`WriteError` / `statMdFile` / `checkMtimeLock` / `writeFileAtomic`（临时文件 + rename + chown/chmod 保持身份，失败清临时文件）。
- [x] `src/notes.ts` 改为复用底座，`NoteError extends WriteError`；错误文案与行为不变，笔记 27 个用例保持绿。
- [x] 新增 `src/docs.ts`：`validateDocBaseName` / `docFileName` / `stripDocExt` / `saveDocFile` / `createDocFile` / `renameDocFile` / `DocError`。
- [x] 新增 `src/docs.test.ts`（15 用例）：文件名规则、CRLF 与「无末尾换行」保真、内容相同不重写、mtime 锁 409 且文件不动、属主/权限保持、无临时文件残留、只允许 .md、超大 413、新建 wx 冲突、改名同目录/目标已存在/跨目录/源不存在。

## T2 后端：路由与索引

- [x] `src/index.ts`：`POST /api/docs`（整篇保存 + 索引 + 增量向量 + bumpVersion）。
- [x] `POST /api/docs/create`（`{dir, name}`，名字服务端校验，创建后入索引）。
- [x] `POST /api/docs/rename`（旧路径删索引/向量 + 新路径入索引 + 收藏迁移 + bumpVersion）。
- [x] `POST /api/render-block`（按文档目录 + 术语表渲染片段，只读，200KB 上限）。
- [x] `src/index-db.ts`：`renameFavorite(old, new)`（保留 pinned/addedAt）。
- [x] 路由统一按 `WriteError` 映射状态码；路径一律 `resolveUrlPath` 收口。

## T3 后端：渲染器补锚点

- [x] `src/render.ts`：fence renderer 把 `data-line-start/end` 补回第一个 `<pre>`（markdown-it 的 highlight 分支会丢 token 属性）。
- [x] `src/render.test.ts` 新增 3 用例：高亮围栏、mermaid 围栏、四空格缩进代码块都有行号锚点。

## T4 前端：契约与状态

- [x] `lib/types.ts`：`DocSaveRequest/Response`、`DocCreateRequest/Response`、`DocRenameRequest/Response`、`RenderBlockResponse`。
- [x] `lib/api.ts`：`saveDoc` / `createDoc` / `renameDoc` / `renderBlock`。
- [x] `state/store.tsx`：`editingPath` / `editingDirty` / `beginEdit` / `endEdit` / `setEditingDirty`；`confirmLeaveEdit` 挂在 openDoc / activateDoc / closeDoc / switchSet；`createDoc` / `renameDoc`；reducer 增加 `rename`（tab 路径与标题迁移）。

## T5 前端：块编辑器

- [x] 新增 `components/doc-editor.tsx`：分段模型（block / gap / source）、按 `data-line-*` 切块、块内渲染态 ↔ 源码态。
- [x] live 块（段落/标题/列表/引用/笔记）实时预览：防抖 250ms、中文输入法组字不发请求、请求序号无关（只保留最后一次渲染结果）。
- [x] 非 live 块（表格/代码/mermaid/公式块/frontmatter/HTML/脚注/分割线）源码编辑 + 「预览」按钮 + 失焦渲染一次。
- [x] 保存（`mtimeMs` 乐观锁）；409 冲突条：覆盖保存 / 放弃修改并重新载入。
- [x] 整篇源码切换兜底；空文档给「点击开始输入…」空文本块（首次输入即有实时预览）。
- [x] `Tab` 插两个空格、`Esc` 收起当前块、自动高度、输入法回车不算提交。

## T6 前端：文档视图与入口

- [x] `components/doc-view.tsx`：编辑按钮（收藏左侧）；编辑态「取消 / 保存」；渲染区隐藏、编辑器接管；保存后重渲染并强制重新注入。
- [x] 编辑态：暂停 5s 轮询、禁用笔记右键菜单、隐藏浮动目录、`⌘S` / `Esc`、`beforeunload` 未保存拦截、tab 脏点。
- [x] `components/doc-name-dialog.tsx`（新增）：共用命名对话框（聚焦全选、`.md` 后缀、Enter/Esc、提交中禁用、失败红字不关闭）。
- [x] `components/sidebar/tree-view.tsx`：目录右键「新建 Markdown 文件」、文件右键「重命名」（含反链数提醒）；Radix 焦点归还与对话框自动聚焦的冲突用 flag 跳过。
- [x] `index.css`：编辑态样式（块分隔与悬停、源码框、预览区、整篇源码、冲突条、脏点、空块占位），明暗主题跟随 `--md-*` 变量。

## T7 文档

- [x] 新增 `specs/doc-editing/{spec,plan,tasks}.md`。
- [x] 更新 `specs/README.md` 现状列表。
- [x] 更新 `README.md` 功能清单。
- [x] 更新 `AGENTS.md`：原则 4 的写盘例外扩到正文保存/新建/改名；分层表补 `file-write.ts` / `docs.ts`。
- [x] 更新 `.dsh/skills/code-map/SKILL.md`：后端/前端结构表 + API 清单 + 编辑态说明。

## T8 验证

- [x] `npx tsc --noEmit` 通过。
- [x] `npm test` 全绿（新增 18 用例）。
- [x] `cd web && npm run build` 通过。
- [x] 临时实例（`MD_BASE_DIR` 指向 fixture 空间，端口 3011）+ 本机无头 Chromium（CDP 驱动）逐项验证：
  - 进入/退出编辑态；块分类（text/note/table/code/mermaid/math/frontmatter/rule/source）。
  - 活跃块实时预览：粗体、KaTeX 公式、双链都按渲染形态出现。
  - 表格 / mermaid 显示「该块不实时渲染」+ 预览按钮，无实时预览。
  - 保存：磁盘内容更新、其余块原样、`dev:dev 664`、无 `.mddoc-*` 残留。
  - 冲突：外部改动后保存 409 → 磁盘未变 → 「覆盖保存」写入。
  - 取消：不写盘；脏守卫：切 tab 弹确认，拒绝停在编辑器、接受则退出且不写盘。
  - `⌘S` 保存；新建（对话框 → 树更新 → 编辑态 → 首字有预览）；重命名（树/磁盘更新、tab 迁移、编辑中拒绝）。
- [ ] 用户浏览器手感确认 + 部署（等用户确认，走 deploy skill）。
