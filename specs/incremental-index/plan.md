# plan: 增量索引 + 请求不再全库扫盘

## 技术方案

### 1. 让 FTS 能按行定位（增量删除的前提）

`fts` 是普通 FTS5 表（非 external content），`DELETE FROM fts WHERE path=?` 需要全表扫描，
正是全量重建慢的原因之一。改为**让 `fts.rowid` 与 `files.rowid` 一一对应**：

```sql
INSERT INTO files(...) VALUES(...);            -- 取 lastInsertRowid
INSERT INTO fts(rowid, path, body) VALUES(?,?,?);
DELETE FROM fts WHERE rowid IN (SELECT rowid FROM files WHERE path=?);
```

老库的 fts 行号与 files 行号无关，若直接增量删除会残留脏行。用 `meta` 表打标记
`fts_rowid_v2`：标记缺失时先做一次全量重建（启动时本来就要重建一次，因此部署后不会额外付费）。

### 2. 增量接口（`src/index-db.ts`）

- `indexFiles(files: MdFile[])`：逐个 `removeOne` + `insertOne`，单事务。
- `removeIndexPaths(urlPaths)`：逐个 `removeOne`（fts / tags / links / files 四张表一起清）。
- `removeIndexPrefix(urlPrefix)`：目录被删/改名时按前缀清（返回删除条数）。
- `makeStatements(d)` 统一 prepare，供全量与增量共用；`rebuildIndex` 也改用它，避免两套写入逻辑漂移。
- 新增 `links(source)` 索引，让按来源删链接不再全表扫描。

### 3. 请求不再全库扫盘

- `scanner.ts` 新增：`toMdFile`（单文件）、`resolveUrlPath`（urlPath→绝对路径）、`fsPathToUrlPath`。
- `index-db.ts` 新增只读查询：`listFileSummaries`（树）、`listFilesMeta`（/api/files）、`getFileMeta`（单文件）。
- `index.ts`：`/api/tree` 用 `listFileSummaries + scanDirs`；`/api/render`、`/api/files/*` 用 `getFileMeta + resolveUrlPath`（正文仍单文件读盘）；
  `/api/files` 用 `listFilesMeta`；`/healthz` 用 `indexStats().files`。索引里查不到时回退磁盘单文件探测，保证刚创建的文件也能打开。

### 4. watcher

- `flushChanges`：`unlinkDir` → `removeIndexPrefix`；文件增删改 → `toMdFile` 判定存在与否，分别进 `indexFiles` / `removeIndexPaths`；`bumpVersion()` 只在真有变更时调用。
- 单次批量 ≥500 变更回退全量重建（防御性，避免巨量小事务）。
- `chokidar` 的 `ignored` 增加 `EXCLUDES` 段匹配，node_modules/dist 等不再触发索引。

## 影响面

- HTTP / MCP 接口**签名与响应结构不变**（已逐字段比对 `/api/tree`、`/api/render`、`/api/files` 与线上一致），前端无需改动。
- 语义索引：`embedFiles` / `deleteEmbeddings` 逻辑保留，只是不再由「目录事件」触发全量 `buildEmbeddings`。
- 行为差异：树/搜索的数据来自索引，文件落盘到可检索之间有最多 ~1.5s 防抖延迟（前端 5s 轮询 dataVersion，正常无感；直接按 URL 打开刚创建的文件仍可用，因为 render 有磁盘回退）。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 老库 fts 行号不一致导致删除残留 | `meta.fts_rowid_v2` 标记 + 缺失时先全量重建；已用 609MB 生产库副本验证 |
| 增量漏索引（事件丢失） | 保留 `/api/reindex` 手动全量重建；≥500 变更自动全量；索引与磁盘数量在测试中对账 |
| 容器内 `tsx` 直跑源码，改完需重启容器生效 | 重启 `md-server` 容器即可（源码是 bind mount） |
| 需要回滚 | `git revert` 对应 commit 后 `docker compose up -d --build`（老代码会自行全量重建，无需数据迁移） |

## 验证记录（2026-09-20）

- 隔离空间（300 文档）：改动 1/50 文件、删 20 文件、删目录 → `+1` / `+50` / `-20` / `-3 dir-1`，索引 280 = 磁盘 280，已删文件/目录 404，无残留树节点；30s 内 `/api/status` 最慢 25.8ms。
- 生产库副本：单文件增量 15ms（全量 58.9s）；`/healthz` 900→17ms；`/api/tree` 615→175ms；`/api/files` 541→146ms；`/api/render` 小文档 ~650→21ms。
