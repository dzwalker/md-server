# spec: 文档打开慢的根治 —— 增量索引 + 请求不再全库扫盘

## 背景

2026-09-20 用户反馈「最近文档新打开要十几秒」。实测定位到两层原因：

1. **主因（40~60s 级冻结）**：`src/index.ts` 的 `flushChanges()` 在任何 md 文件变动后都同步跑一次**全库重建** `rebuildIndex()`。
   在 2427 篇文档（`neolix-ad`/`canon` 于 9-18 加入 sets 之后）规模下，一次全量重建实测
   `scanAll 0.9s + 读文件 0.6s + 拼音 4.2s + SQLite/FTS 写入 11.7s ≈ 18.3s`，生产环境（609MB 库 + 1.4GB WAL）实测 40~63s。
   期间 Node 单线程被占满，**任何 HTTP 请求都只能排队**：
   - `/api/status`（纯内存返回）实测被卡 **63.2s（10:34:00）** 与 **43.2s（10:35:04）**，后者与日志 `index updated on file change` 同一秒；
   - 活跃时段重建约 60 次/小时，用户点开文档撞上冻结窗口即表现为「十几秒」。
2. **次因（每请求 0.5~0.9s）**：`/api/render/*`、`/api/tree`、`/api/files`、`/healthz` 都调用 `scanAll()`，
   每次都把全库 2427 个文件（24.3MB）重新读盘 + 解析 frontmatter（实测 641ms），而正文/标题早已存在 SQLite 索引里。

## 目标

- 单次文件变动后的索引更新从「全库重建 40~60s」降到**毫秒级**，服务不再被冻结。
- 文档阅读相关的读接口不再全库扫盘，延迟从 ~600ms 降到 **~20ms**（正文按单文件读盘）。
- 不改变任何 HTTP / MCP 接口的**响应结构**与渲染结果（前端零改动）。

## 非目标

- 不改前端（`/api/tree` 取两次、gzip、静态资源缓存、mermaid 懒加载等属于后续 P2）。
- 不改 `embed`（语义索引）开关语义；`embed=false` 的 set 仍不参与向量化。
- 不引入新的依赖或数据库迁移脚本。

## 方案

| 层 | 改动 |
|---|---|
| `src/scanner.ts` | 新增 `toMdFile(fsPath)`（只读单文件构造 `MdFile`）、`resolveUrlPath(urlPath)`、`fsPathToUrlPath(fsPath)`；`buildTree` 入参放宽为 `{urlPath,title}`，可直接吃索引表。 |
| `src/index-db.ts` | FTS5 行号与 `files` 行号对齐（meta 标记 `fts_rowid_v2`），删除走 `rowid IN (SELECT rowid FROM files WHERE path=?)` 的 O(1) 定位；新增 `indexFiles` / `removeIndexPaths` / `removeIndexPrefix`；新增只读查询 `listFileSummaries` / `listFilesMeta` / `getFileMeta`。老库首次进入增量路径前自动做一次全量重建以对齐行号。 |
| `src/index.ts` | `flushChanges` 改为增量（按 `changedPaths` 单文件 delete+insert；`unlinkDir` 走 `removeIndexPrefix`）；单次批量 ≥500 个变更仍回退全量重建；watcher 忽略 `EXCLUDES`（node_modules 等）；`/api/render`、`/api/tree`、`/api/files`、`/healthz` 全部改读索引。 |
| `src/mcp.ts` | `read_doc` 改走索引 + 单文件读取，不再 `scanAll()`。 |

## 验收标准（DoD）

- [x] `npx tsc --noEmit` 通过；`npm test` 20 个测试全绿（新增 `src/index-db.test.ts` 6 例覆盖增量改/增/删/目录删/重复更新不产生重复行）。
- [x] 增量单文件更新实测 **15ms**（对照全量 18~59s）。
- [x] 生产库副本上实测：`/healthz` 900ms→**17ms**、`/api/tree` 615ms→**175ms**、`/api/files` 541ms→**146ms**、
      `/api/render` 小文档 ~650ms→**21ms**（大文档 608ms→437ms，剩余为真实渲染耗时）。
- [x] 接口结构与渲染结果不变：`/api/tree` 与线上逐节点一致（2865 节点）、`/api/render` 的 `html`/`headings`/键集合完全一致。
- [x] 隔离空间端到端验证 watcher：改动 1/50 个文件、删除 20 个、删目录，日志分别为
      `+1` / `+50` / `-20` / `-3 dir-1`，索引文件数与磁盘一致（280=280），已删文件/目录访问返回 404，无残留树节点。
- [x] 增量路径下 30s 内 `/api/status` 最慢仅 **25.8ms**（对照修复前同类操作冻结 40~60s）。

## 遗留（已由 `specs/perf-followups/` 承接，2026-09-21 全部完成）

- 前端载荷/渲染、索引库回收、保存空间全量重建三项已落地并上线，实测结论见 `specs/perf-followups/{spec,tasks}.md`。

## 原始遗留清单（未纳入本次）

- `POST /api/sets` 保存空间仍会触发一次全量重建（用户主动操作，可接受）。
- 前端每次刷新取两次 `/api/tree`、无 gzip、无静态资源长缓存、mermaid(3.3MB) 全量加载、大文档注入 HTML 的 4~7s 主线程阻塞。
- 索引库膨胀（609MB + 1.4GB WAL）可在增量上线后择机 `VACUUM` / WAL truncate 回收。
