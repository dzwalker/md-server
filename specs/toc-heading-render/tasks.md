# tasks: 右侧目录正确处理引号实体与 KaTeX 公式

- [x] T1 RED：`src/render.test.ts` 增「TOC 标题提取」7 例，先看失败。
- [x] T2 `src/render.ts`：`headingContent` 按公式 span 切 parts + 实体解码；`headings[].text` 改为解码后的纯文本。
- [x] T3 `src/render.ts`：anchor `getTokensText` 兜底公式源码（纯公式标题不再是空 id）。
- [x] T4 `src/render.ts`：标题正则容忍换行 + 裁掉片段首尾空白（行内 `$$…$$` 不再丢标题）。
- [x] T5 GREEN：`npx vitest run src/render.test.ts` 18/18。
- [x] T6 前端：`web/src/lib/types.ts` 加 `TocPart`；`toc-panel.tsx` 按 parts 渲染并调 `renderExtras` 补妆。
- [x] T7 样式：`web/src/index.css` 目录内 KaTeX 字号 1em、公式内 nowrap。
- [x] T8 门禁：根 `npx tsc --noEmit` + `web/ npx tsc --noEmit` + `npm test`（64/64）+ `web/ npm run build`。
- [x] T9 浏览器实测：隔离实例（`MD_BASE_DIR`/`MD_SETS_FILE`/`MD_INDEX_DB` 全在 `/tmp/md-verify`，`MD_PORT=3011`）+ headless Chromium 断言目录 DOM（实体、KaTeX 渲染数、纯公式标题可点）。
- [x] T10 文档：本 spec 目录 + `specs/README.md` 现状清单。
- [ ] T11 上线（需用户批准 `docker compose up -d --build`）。
