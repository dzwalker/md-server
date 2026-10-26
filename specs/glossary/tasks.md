# glossary 任务清单

- [x] `src/glossary.ts`：文件名判定 + 术语表解析（`parseGlossaryMarkdown`）
- [x] `src/glossary.ts`：`buildGlossaryIndex`（名字分组、定义去重、版本）+ `buildMatcher`（长词优先、英文全词边界）
- [x] `src/glossary.ts`：空间作用域（`spaceDirsForPath`）、文件清单 / mtime 缓存、`glossaryForDoc` / `glossaryVersionForDoc`
- [x] `src/render.ts`：core 插件切分 text token + `span.glossary-term` 渲染 + 命中 key 收集
- [x] `src/render.ts`：笔记卡片内联复用切分；`renderMarkdown` 第三参数与 `glossary` payload
- [x] `src/index.ts`：`/api/render/*` 传索引、`/api/stat` 返回 `glossaryVersion`
- [x] `src/glossary.test.ts` + `src/render.test.ts` 增补（命名 / 解析 / 别名 / 长词优先 / 边界 / 跳过代码与链接 / 前 3 条 / 无术语零变化）
- [x] `npx tsc --noEmit` + `npm test` 全绿
- [x] 前端：`web/src/lib/types.ts`、`web/src/lib/glossary.ts`（浮层）、`doc-view.tsx`（绑定 + 轮询比较）、`index.css`
- [x] `cd web && npm run build` 通过
- [x] 本地 fixture 起服务，Playwright 浏览器实测：下划线（dotted）、悬浮（含移入浮层保持/移出关闭）、长词优先（`CLIP模型` 整段）、英文全词（`CLIP2`/`clipx`/`a_clip` 不命中，`a.clip` 命中）、代码/链接不标注、笔记卡片标注、前 3 条 + 总数提示、浮层底部翻转、空间隔离（p 空间 0 个标注）、改术语表 5s 内自动刷新
- [x] 文档：README 相关章节、`specs/README.md` 索引
