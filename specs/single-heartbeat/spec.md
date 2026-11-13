# single-heartbeat：`/api/status` 与 `/api/stat` 合并为一个前端心跳

## 背景

阅读态有两个各自独立的 5s 定时器，问的是同一件事「磁盘上的东西变没变」：

- `web/src/state/store.tsx`：`GET /api/status` 取 `dataVersion`，变了就刷新目录树 / 标签 / 笔记面板 / 反链。
- `web/src/components/doc-view.tsx`：`GET /api/stat?path=<当前文档>` 比 `mtimeMs` 与 `glossaryVersion`，
  变了才重拉 `/api/render`（`specs/perf-followups/` 的 W1：不能 `dataVersion` 一变就重注入整篇）。

同一页面每 5s 固定发两个请求，浏览器 Network 面板上长期就是 `/api/status` + `/api/stat` 成对出现；
加上切文档时 `doc-view` 还会再打一次 `/api/stat` 做一致性校验，属于重复轮询。

## 目标

- 前端常驻轮询**只剩一个**：`GET /api/status?path=<当前文档>`，一次回包同时给出
  `dataVersion` 与这篇文档的状态（`exists / mtimeMs / size / glossaryVersion`）。
- 时效不下降：外部改文档、改术语表仍在 ≤5s 内反映到正文；切文档时立刻补取一次，不等到下个 tick。
- 不破坏既有调用：`/api/status` 不带 `path` 时回包与旧版完全一致（部署脚本健康检查、旧前端都还在用）；
  `/api/stat` 端点保留（进编辑态的一次性校验、外部脚本）。

## 非目标

- 不换 WebSocket / SSE 推送（量级另评）；不改 5s 间隔。
- 不改 `dataVersion` 的语义与 `refreshData()` 的消费方。

## 方案（要点）

- `src/index.ts`：抽出 `docStatOf(path)`（走索引 `getFileMeta`，毫秒级），`/api/stat` 与
  `/api/status?path=` 共用；`/api/status` 带 `path` 时多返回 `file` 字段，不带时只回 `{ dataVersion }`。
- `web/src/lib/api.ts` / `types.ts`：`status(path?)` 返回 `{ dataVersion, file?: DocStat }`；
  `DocStat` 类型抽到 `types.ts`。
- `web/src/state/store.tsx`：心跳改为带 `activeDoc` 的 `api.status(path)`；`dataVersion` 变了照旧
  `refreshData()`；当前文档状态存进 context 的 `docStat`，**值没变就返回同一对象**（避免每 5s 触发全应用重渲染）；
  effect 依赖 `docs.activeDoc`，切文档时立刻 tick 一次；旧回包按序号丢弃（切文档时回包可能乱序）。
- `web/src/components/doc-view.tsx`：删掉两个 `/api/stat` effect（切回缓存文档时的校验、5s 轮询），
  改成一个消费 `docStat` 的 effect：只有 `mtimeMs` / `glossaryVersion` 与渲染缓存不一致才重拉 `/api/render`；
  编辑态照旧不套用（草稿不会被顶掉），滚动锚点由正文注入那一步统一保住。

## 验收标准（Given-When-Then）

1. 阅读态静置 20s：Network 只有 4 个 `GET /api/status?path=…`，**没有** `/api/stat`、没有 `/api/render` 重注入。
2. 打开 A 再打开 B：心跳在切 B 时立刻带 `path=B` 打一次（不等 5s），A 的缓存不受影响。
3. 外部修改当前文档：≤5s 内正文自动换成新内容，阅读位置不跳。
4. 外部修改术语表：≤5s 内正文重渲染（`glossaryVersion` 变化，`mtimeMs` 没变）。
5. 编辑态下外部改同一篇：草稿不被顶掉；退出编辑后若磁盘 mtime 已变，正文以磁盘为准。
6. `/api/status`（无 path）回包仍是 `{ dataVersion }`；`/api/stat?path=` 回包字段不变。

## 状态

- 2026-11-13 实施并上线。
