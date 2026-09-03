# AGENTS.md — md-server 开发宪法与约定

## 一句话定位

自托管 Markdown 知识库/维基服务：扫描多个文档空间 → SQLite 全文/拼音/语义索引 → Fastify HTTP API + MCP(SSE) + 单文件原生 JS 前端。

## 技术栈速览

- Node 22 + TypeScript（`tsx` 直跑，无编译步骤），`strict: false`
- Web：Fastify + `@fastify/static`
- 渲染：markdown-it（anchor / emoji / task-lists / footnote / 自写 KaTeX 数学）+ highlight.js
- 索引：better-sqlite3（FTS5 trigram 全文、中文拼音、标签、双链/反链/图谱、收藏、待办/到期）
- 语义检索：`@huggingface/transformers` + onnxruntime（multilingual-e5-small）
- MCP：`@modelcontextprotocol/sdk`（SSE transport，端口 3002）
- 前端：`public/index.html`（单文件，HTML+CSS+JS 混排）

## 构建 / 测试 / 发布命令

| 用途 | 命令 |
|---|---|
| 开发启动 | `npm run dev`（即 `npx tsx src/index.ts`） |
| 生产启动 | `npm run start` |
| 类型检查 | `npx tsc --noEmit` |
| 测试 | `npm test`（见 `.dsh/skills/tdd/SKILL.md`） |
| 发布/上线 | `docker compose up -d --build`，走 `deploy` / `main-deploy` / `safe-deploy` skill，不在本 repo 内手改线上 |

## 分层与边界

| 模块 | 职责 |
|---|---|
| `src/config.ts` | roots 多空间加载/热更、端口、排除目录 |
| `src/scanner.ts` | 扫描 md 文件 → `MdFile` 列表 + 目录树（只读 fs） |
| `src/index-db.ts` | SQLite 索引与检索：全文/拼音/标签/双链/图谱/收藏/待办 |
| `src/render.ts` | markdown → HTML 渲染（markdown-it 插件 + KaTeX 数学） |
| `src/embed.ts` | 语义向量（HF transformers + sqlite） |
| `src/mcp.ts` | MCP 工具服务（SSE） |
| `src/index.ts` | HTTP 路由 + 文件 watcher 实时索引 + 启动装配 |

**边界**：HTTP/MCP 层只做路由与参数解析，业务在各模块；`index.ts` / `mcp.ts` 不写检索/渲染逻辑；不跨模块直接读写 sqlite（一律走 `index-db.ts` / `embed.ts` 导出的函数）。

## 不可违背原则（硬门禁）

1. 改完必须跑 `npx tsc --noEmit`；`npm test` 全绿才能交付。
2. 引入 lint/格式工具后，不通过者不得提交。
3. API 或 MCP 工具签名变更，必须同步 `AGENTS.md` / `README.md` 与相关 spec。
4. 生产数据文件（`/data` 下 md 文件、`roots.json` 之外的多空间内容）只读，不擅自增删改。
5. 危险操作（见下）必须先停下来征求确认。

## 完成定义（DoD）

一个任务算「完成」当且仅当：

- 类型检查通过：`npx tsc --noEmit`
- 相关测试通过：`npm test`
- 新增/改动的 API 或 MCP 工具有对应文档/spec 同步
- 前端改动已在浏览器验证（本地 `:3001` 或部署实例）

## AI 自主度与需审批动作

- 默认**高自主**：写代码、补测试、写文档、建 spec 等能自动完成的动作自动做。
- 以下动作**必须先停下来征求确认**（审批）：
  - 任何 `docker compose` / 部署 / 上线相关命令（走 deploy 系列 skill）
  - 修改/删除生产数据或索引（`/data` 下 md 文件、`roots.json`）
  - 依赖变更（`npm install/uninstall` 或 lockfile 大改）
  - 修改 `src/config.ts` 默认 roots / 端口约定（影响线上）
