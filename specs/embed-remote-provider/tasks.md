# tasks: 远端 embedding

- [x] 1. `embed.ts` 加 openai 分支（不加 dimensions、批 ≤10、3 次重试）
- [x] 2. 模型指纹 `embed_meta` + 变更清空重建
- [x] 3. 向量改 Float32 BLOB（兼容旧 JSON 行）+ `mtime_ms` 增量
- [x] 4. `config.ts` 加 `SpaceSet.exclude`，`isEmbedEnabled` 排除生效
- [x] 5. `sets.json`：learning set（learning-ad + neolix-mgmt）开启 embed，排除 reorg-archived/recruitment
- [x] 6. `.env` 写入 `EMBED_*`（key 与 OpenViking 同源，600）
- [x] 7. `docker compose up -d --force-recreate`，跑满 430/430
- [x] 8. 验证：排除目录 0 向量、inbox 13 条、4 组语义查询命中
- [ ] 9. （后续）给 `/api/search-semantic` 加 query 结果缓存，压到 300ms 内
