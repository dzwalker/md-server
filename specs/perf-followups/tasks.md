# tasks: 性能收尾三件事（2026-09-21 全部完成并上线）

> 实测口径：PostgreSQL 无关；所有数字来自本机 `curl`（线上容器）+ headless Chrome 探针（同一台机器）。
> 上线方式：`docker compose stop` → 索引库维护 → `docker compose up -d --build`。

## W3 保存空间不再全量重建 ✅

- [x] `scanner.ts`：新增 `scanRoot(url, dir): MdFile[]`（复用 `scanDir`）。
- [x] `index-db.ts`：新增 `indexFilesInBatches(files, batch=80)`，批间 `await setImmediate`。
- [x] `index-db.ts`：新增 `removeIndexPrefixInBatches(prefix, batch=40)`（批量删目录时也让出事件循环）。
- [x] `index.ts`：`POST /api/sets` 改为差集增量（移除目录批量删、新增目录后台分批索引、仅改名不触发）。
- [x] `index.ts`：请求立即返回（`applySetChanges` 首行先让出事件循环）；日志 `sets applied: +N/-M dirs, X docs, Yms`。
- [x] 重入保护：后台索引期间的再次保存，以最后一次为准（`setsJobPending`）。
- [x] 验证：实测 `POST /api/sets` **112ms**（改造前同操作 3.9s、更早版本冻结 ~50s）；后台 31ms 完成；期间 `/api/status` 最慢 **144ms**。
- [x] 验证：移除目录 `/lark-archive` → 索引 2429 → 2274（-156 篇），搜索/图谱不再返回。
- [x] `npx tsc --noEmit` + `npm test` 通过；新增批量索引用例（21 个测试全绿）。

## W2 索引库回收 ✅

- [x] 备份 `md-index.db` → `/home/dev/backup/md-index-backup-20260921.db`（609MB），校验 `files=2429 / fts=2429`。
- [x] `index-db.ts`：`init()` 设 `PRAGMA journal_size_limit = 64MB`；启动同步后 `wal_checkpoint(TRUNCATE)`。
- [x] 维护脚本：`INSERT INTO fts(fts) VALUES('optimize')` → `wal_checkpoint(TRUNCATE)` → `VACUUM` → `PRAGMA optimize`。
- [x] 实测（停机共约 10s）：**db 581MB → 157MB**、**WAL 1310MB → 0**、`freelist 62312 → 0`、`quick_check = ok`、`files=2429 / fts=2429`。
- [x] 额外收益：`syncIndex()` 让启动从「全量重建 40~60s」变成「增量补差 1.4s」（本次启动：`incremental, 3 changed, 1369ms`）。
- [x] 功能自检：搜索/拼音/英文/标签、反链/出链、`/api/tree` 节点数 2865、收藏、待办、大文档打开 —— 全部正常。

## W1-1 树只取一次 ✅

- [x] `store.tsx`：持有 `tree` + `refreshTree()`，`dataVersion` 变化去抖 2s 刷新；`fileIndex` 由 tree 派生。
- [x] `tree-view.tsx`：改为读 store，不再自行 `api.tree()`。
- [x] 验证：加载阶段 `/api/tree` 请求数 **2 → 1**；静置 20s 无额外 `/api/tree`。

## W1-6-3 只在当前文档真的变化时重取正文 ✅

- [x] `src/index.ts`：新增 `GET /api/stat?path=`（走索引 `getFileMeta`，实测 **3.8ms**）。
- [x] `doc-view.tsx`：每 5s 只查当前文档 mtime，变了才重取；删除了 `dataVersion` 触发的无条件重取。
- [x] 验证：静置 20s 只有 `/api/status`×4 + `/api/stat`×4，**无任何 `/api/render` 重注入**。

## W1-2 压缩 ✅（方案 A）

- [x] `npm i @fastify/compress@9.2.0`（依赖变更已确认）+ `await app.register(compress, { global: true, encodings: ['br','gzip'], threshold: 1024 })`。
      踩坑记录：**必须 `await` 注册**，否则插件挂到路由上的 `onSend` 钩子来不及生效，压缩会静默失效。
- [x] 验证（线上实测，线上字节）：`/api/tree` 431KB → **57.9KB(br)**；`/api/files` 869KB → 100KB；`/api/render` 233KB → 43.6KB；前端 bundle 572KB → 177KB(gzip)。

## W1-3 缓存策略 ✅

- [x] `onSend` 按路径：`/assets/*` `public, max-age=31536000, immutable`；`/media/*` `public, max-age=604800`（fastify-static 同步配置）；其余 `no-cache`。
- [x] 验证：`/assets/index-*.js` 返回 immutable + br；`/media/mermaid.min.js` 返回 7d；HTML 仍 `no-cache`。

## W1-4 mermaid / katex 懒加载 ✅

- [x] `web/index.html` 移除两个 `<script src="/media/...">`；`markdown-extras.ts` 新增 `ensureKatex()/ensureMermaid()`（注入一次 + promise 缓存），按需 await。
- [x] 验证：首屏资源 6 个、转移 **191KB**（改造前 ~4.3MB），**未加载 mermaid**；图表文档打开时才加载 mermaid（此刻首图已渲染）。

## W1-5 图表按需渲染 ✅

- [x] 首屏立即渲染前 3 张，其余由 `IntersectionObserver`（rootMargin 600px）触发；`.mermaid-src` 预置 `contain-intrinsic-size: auto 280px`。
- [x] 验证：19 图文档打开后只渲染 3 张（16 张待滚动触发），随滚动逐步补齐（3→4→5…），全部图表功能（放大/导出 SVG/PNG/JPG）不受影响。

## W1-6-1/2 大文档主线程 ✅（有实测结论）

- [x] `.md-content > *` 加 `content-visibility: auto; contain-intrinsic-size: auto 28px`；高亮/二次渲染延后到 `requestIdleCallback`。
- [x] 实测：864KB 表格型文档「点击→正文」**6.8s → 5.3s**（长任务 4.2~4.8s 仍在）。
- [x] 归因结论（重要）：该文档含 **16 张表 / 2189 行 / 42935 单元格 / 45750 个元素**；
      隔离测量：解析 1MB HTML 仅 **103ms**，**带样式布局 3359ms**，样式重算 3171ms → 瓶颈是浏览器对 4.5 万元素的样式+布局，不是解析、也不是网络。
      试过且无效：`table-layout: fixed`（3037ms）、`table contain:content`（3192ms）、`tr/tbody` 级 `content-visibility`（3419~4628ms）、`.md-content contain:layout style`（3126ms）。
      → 结论：这类「整表 dump」型归档文档的剩余耗时是浏览器固有成本，真要根治需要行级虚拟化或归档侧拆表（lark-archive 本身就有拆表约定，此文件未拆）。

## 收尾

- [x] 上线：`docker compose up -d --build`（含前端 `vite build`），启动日志 `index ready (incremental, 3 changed, 1369ms)`。
- [x] 线上复测：`/healthz` 6ms、`/api/tree` 103ms/57.9KB、`/api/render` 22~162ms、60s 内 `/api/status` 最慢 18.6ms。
- [x] 本文档已回填实测数字（`spec.md` 验收标准同口径）。
