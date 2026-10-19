# set-scoped-tabs · 任务清单

## 按 set 隔离 tab

- [x] `web/src/state/store.tsx`：新增按 set 分槽的存储读写（`md-open-tabs-by-set`）+ 旧键迁移
- [x] `docsReducer`：新增 `hydrate` action（整体换入某 set 的 docs）
- [x] `applySet(id)`：切 set 时先落盘当前 set、再 hydrate 目标 set
- [x] 启动解析 set 后 hydrate；`switchSet` / `popstate` / `saveSets` 回退统一走 `applySet`

## 切回零延迟

- [x] `web/src/components/doc-view.tsx`：正文 DOM 缓存（`DocumentFragment`，LRU 12），切回整块复用、跳过重注入与 KaTeX/mermaid 二次渲染
- [x] 命中缓存恢复时跳过正文二次渲染 / 关键词高亮（`restoredFromCacheRef`）
- [x] 带 `<mark>` 的搜索高亮正文不入缓存；带查询时不复用缓存
- [x] 正文容器常驻（`activeDoc` 为空时 `hidden` 而非卸载），保证切空 set 再切回节点仍在

## 门禁与验证

- [x] 门禁：`web` `npm run build`（含 `tsc --noEmit`）+ 根 `npx tsc --noEmit` / `npm test`
- [x] 浏览器端到端：set 隔离 16 项 + 旧键迁移 3 项 + DOM 复用 8 项 + 笔记插入回归 5 项 全 PASS
