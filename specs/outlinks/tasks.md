# tasks: 出链去重 + 引用次数 + 点击跳转

## 实现

- [x] 1. `src/index-db.test.ts` 新增出链用例（RED）：去重 / 计数 / 正文首现顺序 / 别名与锚点归一 / 悬空目标保留。
- [x] 2. `src/index-db.ts` `outlinks()` 改为 `GROUP BY target` + `ORDER BY MIN(rowid)`，导出 `Outlink` 类型（GREEN）。
- [x] 3. `web/src/lib/types.ts` 新增 `Outlink`；`web/src/lib/api.ts` 返回类型改为 `Outlink[]`。
- [x] 4. `web/src/components/doc-view.tsx`：出链面板去重后渲染——可解析的条目为主题色按钮（`openDoc`）、悬空为灰文本、`×N` 次数、标题计数为去重数。
- [x] 5. `public/index.html` 兜底前端同步（聚合对象 + 可点击）。
- [x] 6. `README.md` 功能列表更新（出链去重 / 可点击）；`specs/README.md` 索引新增 `outlinks/`。

## 验证

- [x] 7. `npx tsc --noEmit` 通过。
- [x] 8. `npm test` 全绿（含新增用例）。
- [x] 9. `cd web && npm run build` 成功；起本地 dev 实例（fixture 文档 + 独立 `MD_INDEX_DB`），Playwright + 本机 Chrome DOM 断言：
  - 同一目标只出现一次、条数 = 去重目标数、`×N` 正确；
  - 解析到目标的条目可点，点击后 active tab 切到目标文档；
  - 悬空目标不可点、点击无副作用；
  - 无 console error / pageerror。
- [ ] 10. 线上核对（经用户确认后 `docker compose up -d --build`）：bundle 哈希、`/api/outlinks` 新响应形状、真实文档面板条数与点击。
