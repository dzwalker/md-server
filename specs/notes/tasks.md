# tasks: 正文笔记（`> note: 内容` 一行，2026-09-28）

## T1 后端业务与单测

- [x] 新增 `src/notes.ts`：`NOTE_LINE_RE` / `isNoteLine` / `noteTextOf` / `buildNoteLine` / `normalizeNoteText` / `replaceNoteText` / `splitLines` / `joinLines` / `insertNote` / `updateNote` / `deleteNote` / `applyNoteOp` / `applyNoteToFile` / `toNoteOpInput` / `NoteError`。
- [x] CRLF 与「无末尾换行」逐字保持；空文件、只有一行笔记的文件（删完变空文件）都有覆盖。
- [x] update/delete 只认笔记行：打在正文行上一律 409，文件保持原样。
- [x] `expectMtimeMs` 乐观锁：对得上才写，对不上 409 且文件不动。
- [x] 新增 `src/notes.test.ts`（19 用例）覆盖以上全部路径。

## T2 后端渲染

- [x] `src/render.ts`：`notePlugin` 注册在 `blockquote` 之前，把 `> note: 内容` 渲染成 `.md-note` 卡片（`data-note-line` / `data-note-raw` / `data-line-*`），正文走 `md.renderInline`。
- [x] `srcLinePlugin`：顶层块打 `data-line-start` / `data-line-end`；`math_block` 自定义 renderer 补锚点。
- [x] 新增 `src/render-notes.test.ts`（7 用例）：卡片结构、紧贴段落不吞正文、`data-note-raw` 转义可还原、普通引用块 / `> notes:` / 四空格代码块不误判、块级行号锚点。

## T3 后端写接口

- [x] `src/index.ts`：`POST /api/notes`（`resolveUrlPath` 收口路径 + `NoteError → HTTP 码`）。
- [x] 写成功后立即 `indexFiles([toMdFile(fsPath)])` + `bumpVersion()`，避免连改两条笔记被乐观锁误判。
- [x] 修 e2e 抓到的真实 bug：线路字段 `mtimeMs` 未被归一化成 `expectMtimeMs`，乐观锁静默失效 → 新增 `toNoteOpInput` 并补回归用例。

## T4 前端

- [x] `web/src/lib/api.ts` / `lib/types.ts`：`api.saveNote`、`NoteRequest` / `NoteResponse`、`RenderResult.mtimeMs`。
- [x] 新增 `web/src/lib/notes.ts`：`resolveNoteContext` / `lastBlockEnd` / `startInsertEditor` / `startNoteEditor` / `closeActiveNoteEditor`。
- [x] 就地编辑器：保存 / 取消按钮、`Enter` 保存、`Esc` 取消、编辑器内红字错误、`isComposing` 忽略输入法回车、自动聚焦与自适应高度。
- [x] `web/src/components/doc-view.tsx`：右键监听、受控 `DropdownMenu` 鼠标定位菜单（`modal={false}` + `onCloseAutoFocus` 防抢焦点）、删除 `Dialog` 二次确认、底部轻提示、切文档/换主题前收掉编辑器。
- [x] `web/src/index.css`：笔记卡片与编辑器样式（跟随 md 主题变量）。

## T5 文档

- [x] 新增 `specs/notes/{spec,plan,tasks}.md`。
- [x] 更新 `specs/README.md` 现状列表、`README.md` 功能。
- [x] 更新 `AGENTS.md`：分层表加 `src/notes.ts`；「生产数据只读」原则补精确例外（只改笔记行 + 乐观锁）。
- [x] 更新 `.dsh/skills/code-map/SKILL.md`：后端/前端结构表 + API 清单。

## T6 验证

- [x] `npx tsc --noEmit` 通过；`npm test` 28 → 54 用例全绿（新增 `src/notes.test.ts` 19 + `src/render-notes.test.ts` 7）；`cd web && npm run build` 通过。
- [x] 临时 dev 实例（`:3099`，fixture `/tmp/md-notes-fixture/t/{a.md,b.md}` + 独立 `MD_INDEX_DB`）。
- [x] Playwright + 本机 Chromium **DOM 断言 23/23 通过**（不截图）：普通块菜单仅「插入笔记」、插到该块之后的一行、磁盘逐字未变、卡片行内 md、笔记菜单为「编辑/删除」、编辑器初值是原始 markdown、改写不新增行、取消/Esc 不落盘、Enter 保存、删除二次确认（取消不删 / 确认后那一行消失）、普通引用块不误判、外部改动后 409 且不覆盖、无前端 JS 报错。
- [x] 验证脚本 `/tmp/notes-e2e/run.mjs`（一次性冒烟脚本，未入库以免引入前端测试框架依赖）。
- [x] 上线（2026-09-28）：`docker compose up -d --build` 重建容器，镜像 `sha256:4bff6cfc37eb…`；容器内 `healthz` = ok / 7 空间 / 2545 文件，日志 `index ready (incremental)` + MCP :3002 / HTTP :3001 正常监听。
- [x] 线上验证：`POST /api/notes` 已生效（缺 path / 不存在路径 → 400，未触碰任何文件）；`/api/render` 已带 `data-line-start/end`；前端 bundle `assets/index-DgkiBTy4.js` 含「插入笔记」与 `api/notes`。
- [x] 提交并推送：`54ae46a` → `origin/main`（连同此前未提交的 CJK 强调 + 资源管理器右键菜单 + KaTeX 字体资源）。
- [ ] 用户浏览器确认视觉与手感（https://md.zwalker.me，需刷新拿新 bundle）。

## T8 修复轮②：写盘把文件属主改成 root（用户报障，2026-09-28）

- [x] 定位根因：`临时文件 + rename` 会把新建临时文件的 uid/gid 带成新文件身份；容器以 root 跑 → 用户 `dev:dev` 的 md 变 `root:root`，用户编辑器读写被拒（权限位是照抄原文件的，属主才是被换掉的）。
- [x] `src/notes.ts`：rename 前 `chownSync(tmp, before.uid, before.gid)` + `chmodSync(tmp, before.mode & 0o777)`；进程身份已等于源属主时跳过；chown 失败 → 抛 500 拒绝写入（不静默换属主）。
- [x] 单测新增：`写盘后属主、属组与权限与写前完全一致`、`写盘只改内容：目录里不留 .mdnote-*.tmp 残留`（`src/notes.test.ts` 21 用例）。
- [x] root 容器对照验证（一次性容器 + `/tmp` fixture，不碰生产数据）：修前镜像自带旧 src → 宿主侧 `root:root 644`；修后挂当前 src → 宿主侧 `dev:dev 644`；内容 `> note: 属主验证` 正确写入、无临时文件残留。
- [x] 影响面排查：全空间 `.md` 已无 root 属主（用户已自行修好 `learning-basics` 那条）；仓库里另有 `sets.json` 的写入是**原地写**（不换 inode，属主不受影响）。
- [x] 上线（2026-09-28 第三轮）：`docker compose up -d --build`，镜像 `sha256:9a3e67ddca36…`；容器内 `grep chownSync src/notes.ts` 命中（修复代码在跑）；`healthz` = ok / 7 空间 / 2545 文件；bundle 仍是 `index-B7sN84KA.js`（本轮无前端改动）。
- [x] 线上端到端属主核对（**新镜像** + 一次性容器 + `/tmp` fixture，不碰生产数据）：插入（源 644）/ 改写（源 664）/ 删除（源 600）三种操作后，宿主侧文件仍是 `dev:dev` 且**权限位逐字保持**（644/664/600），内容正确，无 `.mdnote-*.tmp` 残留。
- [x] 结论补充：权限位遵循源文件、绝不擅自更改（测试用 600 的文件写完后仍是 600）；需要 644 就 chmod 一次即可长期保持。

## T7 修复轮（2026-09-28，用户反馈）

- [x] 定位「保存后跳一下」的根因：`.md-content > *` 的 `content-visibility: auto` + 整篇 innerHTML 替换
      丢掉「记住的真实尺寸」→ 屏外块退回 28px 估值；对照实验（不改内容只替换 innerHTML）漂移 114px。
- [x] 新增 `web/src/lib/scroll-anchor.ts`：`captureScrollAnchor` / `findBlockByLine` / `restoreScrollAnchor` / `shiftAnchorLine`。
- [x] `doc-view.tsx` 接入：保存笔记、外部改动刷新、mermaid 换肤前 mark，`useLayoutEffect` + `renderExtras` 完成后两次 restore；锚点绑定 `activeDoc`。
- [x] 编辑器样式重做：`.md-note-field`（聚焦光环）+ 无滚动条 textarea + `.md-note-status`（快捷键提示/错误同槽位）+ 轻量按钮；颜色走 md 主题变量。
- [x] 验证（625 行长文档，`:3098` 实例）：插入/编辑/删除保存后视口首块漂移 ≤1px（`top 1→2` / `-20→-20` / `21→21`）；外部改动刷新 1px；编辑器 `scrollHeight <= clientHeight` 无滚动条、聚焦有环、明暗主题截图核对。
- [x] 回归：完整笔记用例 23/23 通过（选择器随新 DOM 更新为 `.md-note-status-error`）；`npx tsc --noEmit` + `npm test` 54 用例 + `web npm run build` 全过。
- [x] 上线（2026-09-28 第二轮）：`docker compose up -d --build`，镜像 `sha256:989319c85029…`；容器内 `healthz` = ok / 7 空间 / 2545 文件，日志 `index ready (incremental)` 无报错。
- [x] 线上核对：新 bundle `assets/index-B7sN84KA.js` + `assets/index-C56cvXio.css`（**与本地 Playwright 验证过的产物哈希完全一致**）；bundle 内含「插入笔记」、滚动锚点选择器 `:scope > [data-line-start]`、`.md-note-status`；CSS 含 `.md-note-field` / `focus-within` / `overflow: hidden`；`POST /api/notes` 校验生效（400）；`/api/render` 带行号锚点。
