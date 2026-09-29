# tasks: 笔记浏览（右侧目录内联笔记 + 左侧「笔记」面板）

- [x] T1 RED：`src/notes.test.ts` 加 `extractNotes` 6 例（含 ``` / ~~~ 围栏、CRLF、四空格缩进）。
- [x] T2 GREEN：`src/notes.ts` 实现 `extractNotes`。
- [x] T3 RED：`src/index-db.test.ts` 加 `listNotes` 3 例（聚合/围栏/dirs 过滤）。
- [x] T4 GREEN：`src/index-db.ts` 实现 `listNotes`（读 `files.body` 现算）。
- [x] T5 `src/index.ts` 加 `GET /api/notes`（dirs 口径同 `/api/recent`）。
- [x] T6 前端数据层：`types.ts`（NoteRef/NoteFile/NotesResponse）、`api.ts`（`notes()`）、`activities.ts` + `sidebar.tsx`（新活动 + `isActive`）。
- [x] T7 `web/src/lib/notes.ts`：`notePreview` / `scrollToNote` / `flashNote`；`doc-links.ts` 的 `findAnchor` 支持 `note:<行号>`；`doc-view.tsx` 跳转时闪烁。
- [x] T8 `toc-panel.tsx`：笔记开关（默认开、持久化）+ 笔记节点挂在标题下一级 + 「文首」节点 + 点击跳转。
- [x] T9 新增 `sidebar/notes-panel.tsx`：三级树 + 目录/文件/笔记按钮 + 本地搜索 + 惰性加载 + dataVersion 刷新。
- [x] T10 `index.css`：笔记落点闪烁动画。
- [x] T11 门禁：根 `npx tsc --noEmit` + `web/ npx tsc --noEmit` + `npm test`（73/73）+ `web/ npm run build`。
- [x] T12 浏览器实测：隔离实例 + headless Chromium 覆盖 spec 的 B/C 全部条目（目录内联笔记、开关、跨文件跳转、面板层级/搜索/收起、点文件名打开文档）。
- [x] T13 文档：本 spec 目录 + `README.md`、`specs/README.md`。
- [ ] T14 上线（需用户批准 `docker compose up -d --build`）；上一轮 TOC 公式/引号修复同样待上线。
