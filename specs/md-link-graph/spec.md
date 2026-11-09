# spec: markdown 相对链接进图谱 + 图谱查询给 agent

## 背景

- `links` 表只由 `extractWikilinks()` 填充，**只认 `[[双链]]`**。但实际知识库的引用绝大多数写成 markdown 相对链接 `[文本](../分区/x.md)`。
- 实测线上库（2026-11-09）：`files` 3,371 行，`links` 仅 **388** 行；其中 `neolix-mgmt` **只有 9 行**，而该目录正文里有 **1,442** 处 markdown 链接、只有 11 处 `[[双链]]`。→ 知识库的 99% 引用关系对「反链 / 出链 / 图谱 / MCP」不可见。
- 后果：
  1. 反链面板几乎空白，看不出「改这篇会影响谁」；
  2. MCP 没有任何图谱查询工具，agent 无法做影响面判断；
  3. 无法发现孤儿文档、无法量化「活跃分区依赖只读归档」这类结构性风险。

## 目标

1. `links` 表同时记录 **wikilink** 与 **markdown 相对链接**，后者存**归一化后的 urlPath**（`/neolix-mgmt/ad/x.md`），并带 `kind` 区分。
2. 反链按 urlPath 精确匹配（wikilink 保留原有 basename 兜底）。
3. 新增 4 个查询：`orphans` / `impact` / `graph_stats`，并把 `backlinks` / `outlinks` / `orphans` / `impact` / `graph_stats` 暴露为 MCP 工具。
4. 存量库通过一次迁移自动重算（读 `files.body`，不重扫磁盘、不改任何 md 文件）。

## 非目标

- 不做语义/类型化关系（`works_at` 那类）：本库的人/组织关系用表格表达，链接只说「引用」。
- 不改前端「出链」面板的渲染规则；mdlink 目标会显示为完整路径（可点、可解析）。
- 不改 `graph()`（`/api/graph` 与前端图谱视图的响应形状保持不变，新增 `kind` 字段为追加式）。

## 验收标准

- Given 一篇含 `[见](../ad/README.md)` 的文档，When 建立索引，Then `links` 出现 `(source=该文档, target=/neolix-mgmt/ad/README.md, kind=mdlink)`，且 `backlinks('/neolix-mgmt/ad/README.md')` 返回该文档。
- Given 图片 `![](a.md)`、外链 `[x](https://a.com/b.md)`、锚点 `[x](#h)`、代码块里的 `[x](y.md)`，Then 都不产生链接行。
- Given 线上库升级后启动，Then 无需手动 reindex，`links` 行数从 388 升到千级，`neolix-mgmt` 入链可查。
- Given `orphans()`，Then 返回零入链文档（排除 `README.md`），`neolix-mgmt` 约 58 篇。
- Given `impact(path, 1)`，Then 返回所有直接引用该文档的文档（去重、带 depth）。
