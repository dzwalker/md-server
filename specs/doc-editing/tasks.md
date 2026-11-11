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

## T9 单栏编辑器（CodeMirror 6，2026-11-04）

- [x] 新增依赖 `@codemirror/{state,view,language,commands,lang-markdown}`；`lib/md-codemirror.ts` 只在进入编辑态时 `import()`（独立 chunk）。
- [x] `lib/md-codemirror.ts`：Lezer 语法树 + 正则兜底的行内装饰（粗体/斜体/行内代码/链接/双链/行内公式/图片/标题/引用/代码块/表格/分割线），光标进入即还原源码；CJK 紧贴强调补一份。
- [x] 列表回车自动续行（无序/有序/任务列表，空项回车退出列表）、Tab 缩进、撤销重做、Esc 收起、⌘S 冒泡到文档级保存。
- [x] `components/block-source-editor.tsx`：React 包装（动态加载 + 回调走 ref，避免按键重建编辑器）。
- [x] `doc-editor.tsx` 改为单栏：空闲块显示服务端渲染结果，点进去才创建 CM6；删掉「上面输入框、下面预览框」与 250ms 实时预览请求，收起时只重渲染这一块。
- [x] 点击位置映射成光标位置（`posAtCoords`），不再总是落在块尾。
- [x] CSS：CM6 主题变量对齐（`--md-*`）、行内装饰样式、引用/代码块/表格行样式；移除预览框样式。
- [x] 验证：`npx tsc --noEmit`、`npm test`（132 全绿）、`cd web && npm run build`；临时实例 + 无头 Chromium 实测（装饰、点击换块、Esc 收起重渲染、⌘S 保存、整篇源码切换、取消）。

## T10 布局不跳 + 非编辑块样式（2026-11-04）

- [x] 渲染态块补 `.md-content` 类：各级标题、表格边框、代码块底色、引用条、列表缩进等预览页样式在编辑态正常显示（此前只有浏览器默认的加粗/斜体）。
- [x] 盒模型不变：`.md-block` 的 margin/padding/左边框两个状态一致，编辑态只换背景与边框颜色（去掉原来的 `padding: 4px 8px` 与 `margin: 6px`）。
- [x] 排版度量对齐：CM6 行高 1.7 / 字号 15px（笔记 0.95em）、标题行高 1.3、内容与行零内边距；渲染态收掉首尾外边距（含 blockquote 内段落、笔记正文、嵌套列表）。
- [x] 引用 / 列表 / 笔记卡片：编辑态复刻渲染态的外框（内边距、左边框、卡片底色、笔记标签），高度实测一致。
- [x] 「完成」按钮改为绝对定位悬浮在文字栏右侧，不占布局高度。
- [x] 空行分隔符不再撑高（0 高度）。
- [x] 实测：段落 25.50→25.50、H1 33.14→33.14、H2 27.30→27.30、引用 41.50→41.50、嵌套列表 76.50→76.50、笔记 63.4→64.8；宽度全程不变。

## T11 编辑区合并 + 布局对齐 + 多编辑器（2026-11-04）

- [x] 分块模式改为「按编辑区合并」：连续行内块 → region，独立块单独；区域源码含中间空行，收起时整区重渲染。
- [x] 进入编辑态逐像素对齐预览：编辑区容器改成与渲染区同一套（外层 `px-6/py-6` + 内层 `maxWidth`），内容宽度 785→785；去掉编辑器工具栏（模式按钮移入文档头）；块标签/完成按钮改为绝对定位悬浮。
- [x] 块间距按类型复刻预览页的 margin，并关闭编辑区内的 `content-visibility`（否则相邻块外边距不折叠，导致 +30px）。
- [x] 实测：预览 453px ↔ 编辑 453px，块 top/高度逐个一致。
- [x] 新增 `rich-editor-types.ts`（`EditorMode` + 模式清单）。
- [x] Muya（`@muyajs/core` 0.2.0）与 Milkdown Crepe（`@milkdown/crepe` 7.23）两种富文本模式，均按需动态加载；保存前 `flush()` 同步取最新 markdown。
- [x] 文档头「保存」右侧的模式切换（分块 / 源码 / Muya / Milkdown）。
- [x] 实测保存代价：Muya 会把表格单元格按列宽补空格；Crepe 会把 `-` 列表改 `*`、`| --- |` 改 `| - |`。已写入 plan.md §3.2.1 作为决策依据。
- [x] 门禁：`tsc` 两端、`npm test` 132、`web build` 通过。

## T12 frontmatter 独立 + Crepe 主题/配置 + md-server 方言 + 图片上传（2026-11-04）

- [x] 编辑态拆出 frontmatter：默认折叠 `<details>` + textarea；保存拼回时保留分隔符与正文前空行。
- [x] Crepe 主题变量映射到 `--md-*`（字体/字号/行高/强调色/代码底色/引用与表格），变量挂在 `.milkdown` 上才生效。
- [x] 进入编辑态默认 Milkdown。
- [x] Crepe 配置：`placeholder`（中文占位）、`latex.katexOptions`（throwOnError:false）、`image-block.proxyDomURL`/`onUpload`/`onImageLoadError`、`code-mirror` 中文预览按钮。
- [x] `/` 菜单与浮动工具栏新增「双链 `[[ ]]`」「笔记行 `> note:`」（`/` 触发先清空当前块文字）。
- [x] 后端 `src/upload.ts` + `POST /api/asset/upload` + 5 个单测（MIME 决定扩展名、415/400/413、404 不建目录、唯一文件名、属主对齐）。
- [x] 前端 `api.uploadImage`、`lib/asset-url.ts`（编辑器内相对路径 → `/api/asset`，CodeMirror 与 Crepe 共用）。
- [x] 实测：图片显示为 `/api/asset/space1/assets/demo.png`；`/` 菜单含双链/笔记行且能插入；上传后文件 `dev:dev 644`。
- [x] 门禁：tsc 两端、`npm test` 137 全绿、web build 通过。

## T13 图片上传改用 R2（2026-11-05）

- [x] 新增依赖 `@aws-sdk/client-s3`（仅服务端）。
- [x] `src/r2.ts`：环境变量配置（endpoint/bucket/prefix/凭证/可选公开基址）、`buildImageKey`（`md/yyyy/mm/uuid.ext`）、`uploadImageToR2`、`getR2Object`、`isSafeR2Key`、client 缓存与测试重置。
- [x] `src/upload.ts`: 抽出 `validateImage`；新增 `uploadDocImage` 统一入口（R2 优先、否则本地回落），返回 `provider` 字段。
- [x] 路由：`POST /api/asset/upload` 改用 `uploadDocImage`；新增 `GET /api/asset/r2/*` 私有桶读代理（key 白名单、404/502 映射、immutable 缓存）。
- [x] 前端：`api.uploadImage` 返回 `provider/url/relPath`；Crepe `onUpload` 按 provider 取值。
- [x] 配置：仓库 `.env`（600，gitignore）模板 + `docker-compose.yml` / `docker-compose.example.yml` 的 `env_file`。
- [x] 单测：`src/r2.test.ts`（配置解析、key 生成、key 白名单）+ `upload.test.ts` 补统一入口回落与校验（共 8 例）。
- [x] 无凭证场景实测：上传回落本地（`provider: local`）、`GET /api/asset/r2/*` 返回 404。
- [ ] 填好凭证后真传一张图 + 代理读回 200（待用户填 `.env`）。

## T14 多篇同时编辑 + 编辑态无目录 + Muya 下线（2026-11-06）

- [x] store：`editingPath/editingDirty` → `editingPaths[]` + `dirtyByPath`；`openDoc/activateDoc` 不再打断编辑，`closeDocs/switchSet` 只对「要丢掉的脏文档」确认一次；tab 被别处关掉时自动清编辑态。
- [x] DocView：`draftsRef`（按路径存草稿快照 `{text, original, mtimeMs}`）+ `DocEditor.initialDraft` 恢复 + 卸载时 `onDraft` 回传；tab 脏点按 `dirtyByPath` 显示。
- [x] 编辑态不渲染 TOC、不预留 TOC 宽度，「目录 / 1 / 2 / 3 / a」按钮隐藏（实测 1028 = 1028）。
- [x] 富文本装载时的序列化规范化不再算用户改动（基线对齐），进编辑态保存按钮保持禁用。
- [x] 下线 Muya：删除 `muya-editor.tsx`、`EditorMode` 去掉 `muya`、移除 `@muyajs/core` 依赖与对应 CSS/注释。
- [x] 实测：A/B 两篇同时编辑、切回草稿保留、B 保存后 A 仍在编辑、关闭脏 tab 弹确认、目录开关不影响编辑宽度。

## T15 进编辑态加速（2026-11-06）

- [x] 服务端 `/api/render/*?raw=1` 顺带返回原文（复用已读的文件内容）。
- [x] 前端 `api.render` 支持 `raw`；DocView 打开/刷新/保存后都带 `raw: true`，并把原文作为 `preload` 传给 DocEditor（有草稿时草稿优先）。
- [x] A1：`render-block` 只在 blocks 模式请求；B1：按 `path+mtime` 会话缓存（`lib/block-cache.ts`）。
- [x] A3：`lib/prefetch-editor.ts` 空闲 1.5s 与悬停/聚焦「编辑」时预热 Crepe chunk + 主题 CSS。
- [x] 实测（dev，小文档）：进入编辑 1398ms → 351ms；第二次 146ms；点击后无 `/api/files`、无 `/api/render-block`（milkdown 模式）；blocks 模式 render-block 仅 1 次，切回命中缓存。

## T16 修复右键菜单弹窗输入框立刻失焦（2026-11-08）

- [x] 复现：CDP 真实鼠标事件右击目录 → 点「新建」→ 焦点序列 `input → 失焦 → 菜单内容 → body`。
- [x] 根因：右键菜单（Radix ContextMenu）的 FocusScope 在关闭/卸载时把焦点收回，正好抢掉弹窗自动聚焦。
- [x] 修法：`pendingOpenRef` 把「打开弹窗」排到菜单 `onCloseAutoFocus`（同时 `preventDefault` 焦点归还），再 `requestAnimationFrame` 打开；`DocNameDialog` 增加 160ms 兜底聚焦（焦点不在弹窗内时才抢）。
- [x] 实测：新建/重命名弹窗打开后 `document.activeElement` 稳定为输入框（600ms/1200ms 都保持），可输入；新建流程端到端通过（建文件 → 关弹窗 → 进编辑态）。

## T17 编辑态排版对齐 + 保存不退出 + 按钮改名（2026-11-11）

- [x] 审计阅读态 vs 编辑态 computed style：修复前 h1 39.4px/weight 400/margin 32 0 0、p 行高 22.5、列表缩进差 24px、引用 margin 9px、代码块 13.1px。
- [x] 新增 `!important` 覆盖层（Crepe 主题 CSS 运行时注入，同权重会盖掉站内样式）：h1–h6、p、ul/ol/li、blockquote、table、pre、hr、code 全部对齐 `.md-content`。
- [x] 列表：label 宽度 1.5em、gap 0、行高 1.7em；列表项内 `<p>` 外边距清零；项目符号用 ●/○/▪ 按层级切换。
- [x] 修复后实测（同一文档）：h1 25.5/33.15/600、h2 21/27.3、p 15/25.5/margin 7.5、blockquote 15 margin、pre 15/25.5/padding 12、code 13.5/22.95、li 行高 26 —— 与阅读态逐项相同。
- [x] 保存后留在编辑态：`doc-editor.doSave` 更新 `originalRef` 与 `mtimeRef`；`doc-view.onEditorSaved` 只刷预览缓存 + 丢草稿，不再 endEdit。实测保存后仍在编辑、保存按钮变灰、脏点消失、文件已写入。
- [x] 「取消」改名「结束编辑」（title 同步）；有未保存改动时仍确认。
- [x] 已知遗留（Milkdown 序列化特性，非本次引入）：段落行首空格会写成 `&#x20;`，阅读态渲染一致但源码里是实体。
