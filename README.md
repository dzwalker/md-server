# md-server

自托管 Markdown 知识库/维基服务（由旧 SilverBullet 部署重写而来）。扫描多个文档空间，提供全文/拼音/语义检索、双链/图谱、收藏、待办，并通过 HTTP API、Web UI 与 MCP 暴露。

## 功能

- 多空间（roots）扫描与热更
- Markdown 渲染：GFM 任务列表 / 脚注 / emoji / KaTeX 数学 / mermaid / 代码高亮
- SQLite 全文检索（FTS5 trigram）+ 中文拼音检索
- 标签 / 双链 backlink / outlink / 关系图谱
- 收藏置顶 / 待办 / 到期任务（`(due: YYYY-MM-DD)`，供 n8n 到期提醒消费）
- 语义（向量）检索（`multilingual-e5-small`）
- MCP 服务（SSE，端口 3002）：`list_allowed_directories` / `search_docs` / `read_doc` / `search_semantic` / `list_tags` / `list_todos` / `list_due_tasks`

## 快速开始

```bash
npm install
npm run dev   # http://localhost:3001
```

## 配置多空间

文档空间的映射（URL 前缀 → 目录）通过三种方式指定，优先级从高到低：

1. `roots.json`（路径由 `MD_ROOTS_FILE` 指定，默认 `/app/roots.json`）
2. 环境变量 `MD_ROOTS`（JSON 数组）
3. 代码内默认值（`src/config.ts`）

示例见 [`roots.example.json`](./roots.example.json)，Docker 部署示例见 [`docker-compose.example.yml`](./docker-compose.example.yml)。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MD_PORT` | `3001` | HTTP 端口 |
| `MD_ROOTS` | 内置默认 | JSON 数组，如 `[{"url":"/docs","dir":"/data/docs"}]` |
| `MD_ROOTS_FILE` | `/app/roots.json` | roots 配置文件名（多空间管理热加载） |
| `MD_INDEX_DB` | `/data/index/md-index.db` | SQLite 索引库路径 |
| `EMBED_MODEL` | `Xenova/multilingual-e5-small` | 语义向量模型 |
| `MCP_PORT` | `3002` | MCP SSE 端口 |

## 开发

- 开发宪法与硬门禁见 [`AGENTS.md`](./AGENTS.md)
- 功能开发走 spec：见 [`specs/README.md`](./specs/README.md)
- 测试：`npm test`；类型检查：`npx tsc --noEmit`
- 项目级 skill 见 `.dsh/skills/`（tdd / spec-driven-dev / code-map）

## License

[MIT](./LICENSE)
