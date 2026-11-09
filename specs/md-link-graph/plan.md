# plan: markdown 相对链接进图谱

## 技术方案

### 1. 抽取（`src/index-db.ts`）

新增 `extractMdLinks(body, sourcePath)`：

```ts
const re = /(?<!!)\[([^\]\n]*)\]\(\s*<?([^)\s>]+?\.md)>?(?:#[^)]*)?\s*\)/g;
```

- `(?<!!)` 跳过图片；`stripCode()` 先剔代码块/行内代码（复用现有函数，避免 `np.array([[..]])` 那类假链接）。
- 跳过 `#锚点` 与带 scheme 的（`http:`/`mailto:`/`data:`）。
- 用 `path.posix.normalize(path.posix.join(dirname(sourcePath), href))` 归一化 → urlPath；`decodeURI` 兜底空格。
- 越界（`/../` 开头）丢弃。

统一入口 `extractLinks(body, sourcePath): {target, kind}[]` = wikilink（原样 target，`kind='wikilink'`）+ mdlink（urlPath，`kind='mdlink'`）。

### 2. 表与迁移

- `links` 加列 `kind TEXT`（`PRAGMA table_info` 检测后 `ALTER TABLE`）。
- 迁移键 `links_md_v1`：未打标时用 `files.body` 全量重算（与现有 `links_clean_v1` 合并到同一个 `migrateLinks`），事务内 `DELETE` + 重插。
- 新建库直接按新口径写入（`insertOne` 调用 `extractLinks`）。

### 3. 查询

| 函数 | 语义 | SQL 要点 |
|---|---|---|
| `backlinks(path)` | 谁引用我 | `kind='mdlink' AND target=?` 精确；`kind='wikilink'` 走 `target=name OR target LIKE '%/'||name` |
| `orphans(limit)` | 零入链 | `NOT EXISTS(SELECT 1 FROM links WHERE (kind='mdlink' AND target=f.path) OR (kind='wikilink' AND target=f.name...))`，排除 `%README.md` |
| `impact(path, depth)` | 改动波及面 | 迭代调用 `backlinks` 做 BFS，depth 上限 3 |
| `graph_stats()` | 体检 | 边数/悬空边、入链 Top N、跨分区边矩阵（JS 聚合，千级边无压力） |

### 4. 暴露

- MCP（`src/mcp.ts`）：`backlinks` / `outlinks` / `orphans` / `impact` / `graph_stats` 五个工具（现有 7 个 → 12 个）。
- HTTP（`src/index.ts`）：`GET /api/impact/*`、`GET /api/graph-stats`。

## 影响面

- 只改索引读路径与 `links` 表内容，**不写任何 md 文件**。
- 前端：出链面板的 mdlink 目标显示为完整 urlPath；`resolveWikilink()` 已支持 `/path.md` 形态（`doc-links.ts` 先试 `'/'+target`），所以可点、不会灰显。
- 兼容：`graph()` 形状不变（edges 增加 `kind` 字段，追加式）。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 迁移把线上 `links` 算错 | 事务内执行；失败回滚后旧数据仍在，下次启动重试 |
| 首次启动重算耗时 | 3,371 行 body + 千级插入，秒级；不触发全量 reindex |
| 出链面板变长 | 可接受；后续可加「相对当前目录缩短」显示（非本次） |

回滚：`git revert` 本次提交 + 删除 meta 键 `links_md_v1` 后重启（下次启动按旧口径重算）。
