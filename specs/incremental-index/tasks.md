# tasks: 增量索引 + 请求不再全库扫盘

- [x] `scanner.ts`：新增 `toMdFile` / `resolveUrlPath` / `fsPathToUrlPath`，`buildTree` 入参放宽为 `TreeFile`。
- [x] `index-db.ts`：`meta` 表 + `fts_rowid_v2` 迁移标记；`links(source)` 索引。
- [x] `index-db.ts`：抽 `makeStatements` / `insertOne` / `removeOne`，全量与增量共用写入逻辑。
- [x] `index-db.ts`：`indexFiles` / `removeIndexPaths` / `removeIndexPrefix` 三个增量接口。
- [x] `index-db.ts`：`listFileSummaries` / `listFilesMeta` / `getFileMeta` 只读查询。
- [x] `index.ts`：`flushChanges` 改增量，`unlinkDir` 走前缀清理，≥500 变更回退全量。
- [x] `index.ts`：`/api/tree`、`/api/files`、`/api/files/*`、`/api/render/*`、`/healthz` 改读索引（正文单文件读盘 + 磁盘回退）。
- [x] `index.ts`：watcher `ignored` 加 `EXCLUDES` 段匹配。
- [x] `mcp.ts`：`read_doc` 改走索引 + 单文件读取。
- [x] `src/index-db.test.ts`：6 例覆盖全量重建、单文件改（无重复行）、连续改同一文件、新增、删除（含标签/链接清理）、目录前缀清理。
- [x] `npx tsc --noEmit` 通过。
- [x] `npm test`：5 文件 / 20 测试全绿。
- [x] 隔离空间端到端验证 watcher 增量路径与索引对账。
- [x] 生产库副本对比接口延迟与响应结构。
- [x] 补 `specs/incremental-index/{spec,plan,tasks}.md`。
- [ ] 重启 `md-server` 容器上线（需用户确认）。
