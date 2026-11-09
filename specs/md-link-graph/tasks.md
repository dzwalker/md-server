# tasks: markdown 相对链接进图谱

- [x] 1. `index-db.ts`：加 `kind` 列迁移（`PRAGMA table_info` → `ALTER TABLE links ADD COLUMN kind`）
- [x] 2. `index-db.ts`：实现 `extractMdLinks()` / `extractLinks()`，`stripCode()` 复用
- [x] 3. `index-db.ts`：`insertOne` 改用 `extractLinks`，`insLink` 带 `kind`
- [x] 4. `index-db.ts`：`migrateLinks` 升级为 `links_md_v1`，用 `files.body` 全量重算
- [x] 5. `index-db.ts`：`backlinks` 支持 mdlink 精确路径 + wikilink basename 兜底
- [x] 6. `index-db.ts`：新增 `orphans()` / `impact()` / `graphStats()`
- [x] 7. `mcp.ts`：暴露 `backlinks` / `outlinks` / `orphans` / `impact` / `graph_stats`
- [x] 8. `index.ts`：`GET /api/impact/*`、`GET /api/graph-stats`
- [x] 9. 单测：`src/link-graph.test.ts`（相对路径归一化、图片/外链/代码块排除、反链、孤儿、影响面）
- [x] 10. `npx vitest run` 全绿
- [x] 11. `docker compose up -d --build` 重建容器，验证线上 `links` 行数与 `neolix-mgmt` 覆盖
- [x] 12. `specs/README.md` 索引补一行
