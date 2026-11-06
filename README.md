# md-server

自托管 Markdown 知识库/维基服务（由旧 SilverBullet 部署重写而来）。扫描多个文档空间，提供全文/拼音/语义检索、双链/图谱、收藏、待办，并通过 HTTP API、Web UI 与 MCP 暴露。

## 功能

- 多空间 set：一个 set 里组合多个目录、目录可深到任意层子目录（`notion-archive/学习成长` 这种），切换后侧栏只显示该 set 的目录；文档 URL/索引前缀仍是物理路径（见 `specs/space-scope/`）
- 阅读态列表样式：项目符号/编号按层级还原为 `•/◦/▪` 与 `1./a./i.`，任务清单用勾选框代替符号（见 `specs/reading-list-styles/`）
- Markdown 渲染：GFM 任务列表 / 脚注 / emoji / KaTeX 数学 / mermaid / 代码高亮 / CJK 友好强调（`**"中文"**中文` 能加粗，见 `specs/cjk-friendly-emphasis/`）
- 右侧目录：标题里的引号实体正常显示、公式用 KaTeX 同步渲染，纯公式标题也在目录里（见 `specs/toc-heading-render/`）
- 正文编辑（见 `specs/doc-editing/`）：文档头「编辑」进入**单栏**编辑（像 Typora/Obsidian，没有上下分栏）——空闲时整篇仍是渲染结果（与预览逐像素对齐：进入编辑态不跳），点哪一块哪一块原地变成**带格式装饰的源码**（加粗/斜体/行内代码/链接/双链/公式/图片按渲染形态显示，标记符号光标移入才露出）；**连续的行内块会合并成一个编辑区**，一次可以看/改多段；表格/代码/图表/块级公式/原始 HTML 光标进入才显示源码。编辑器可在「保存」右侧切换：分块（CodeMirror 6）/ 源码 / Milkdown（Crepe，**默认**），Milkdown 按需动态加载、保存会规范化 markdown；**多篇文档可以同时处于编辑态**（切 tab 不打断编辑、草稿按篇保留，tab 上有脏标记）；编辑态不显示目录面板、也不预留目录宽度；编辑态下「文档信息」（frontmatter）单独折叠编辑，粘贴/拖拽的图片上传到 Cloudflare R2（`pics` 桶，私有）+ 站内代理 `/api/asset/r2/*` 读取，markdown 写该代理路径；未配置 R2 时回落文档目录 `assets/`。「保存 / 取消」整篇写回（mtime 乐观锁，冲突时可选覆盖保存）；`⌘S` 保存。资源管理器右键「新建 Markdown 文件」「重命名」（改名会迁移标签页与收藏，不自动改引用）
- 正文笔记（`> note: 内容` 一行，见 `specs/notes/`）：预览里右键「插入笔记」、已有笔记右键「编辑 / 删除」；就地编辑 + 保存/取消，直接写回 md 文件（只改笔记行，带 mtime 乐观锁）
- 笔记浏览（见 `specs/notes-browse/`）：右侧目录里的笔记开关（笔记挂在所属标题下一级、点击跳转 + 落点高亮）；侧栏「笔记」tab 按 空间一级目录 → 有笔记的文件 → 每条笔记 三级浏览，支持收起与按文字搜索
- 术语表（见 `specs/glossary/`）：文件名含 `术语表` / `glossary` 的 md 就是术语表，`## 术语` + `别名：…` + 定义正文；空间内所有文档里命中的术语自动加虚线下划线，悬浮显示定义（同名多处定义只显示前 3 条）。长词优先（`CLIP模型` 优先于 `CLIP`）、英文忽略大小写且全词匹配（`CLIP` 不命中 `CLIP2`，`lip` 不命中 `clip`），代码/行内代码/链接文字不标注
- 本地资源链接（见 `specs/raw-asset-links/`）：正文里指向本地非 md 文件的相对链接（互动 HTML、PDF、CSV、脚本源码…）一点即开——服务端按文档目录改写为绝对 `/api/asset/*`，避免 SPA 的 `/set/<id>` 基址把相对链接解析错而被重定向
- SQLite 全文检索（FTS5 trigram）+ 中文拼音检索
- 标签 / 双链 backlink / outlink / 关系图谱；出链面板按目标去重、显示引用次数（`×N`）、可点击跳转，悬空双链灰显不可点（见 `specs/outlinks/`）
- 收藏置顶 / 待办 / 到期任务（`(due: YYYY-MM-DD)`，供 n8n 到期提醒消费）
- 命令面板：`⌘P` 搜索（空态列当前空间最近更新的 20 篇）、`⌘O` 已打开文档看板（按目录分列，方向键导航）
- 侧栏「已打开的文档」（见 `specs/opened-panel-close/`）：按一级目录分组，组头右侧一键关闭该目录下所有已打开文档，每行右侧悬浮出现 × 只关这一篇
- 语义（向量）检索（`multilingual-e5-small`）
- MCP 服务（SSE，端口 3002）：`list_allowed_directories` / `search_docs` / `read_doc` / `search_semantic` / `list_tags` / `list_todos` / `list_due_tasks`

## 快速开始

```bash
npm install
npm run dev   # http://localhost:3001
```

## 配置多空间（空间 set + 作用域）

文档空间由「空间 set」定义，配置在 `sets.json`（路径由 `MD_SETS_FILE` 指定，默认 `/app/sets.json`；也支持环境变量 `MD_SETS`，最后回落 `src/config.ts` 的内置默认值）。每个 set 形如：

```json
{ "id": "study", "name": "📚 学习成长", "dirs": ["notion-archive/学习成长"], "embed": false }
```

- `dirs` 里每个条目叫「作用域」：**相对挂载根**（`MD_BASE_DIR`，默认 `/data/workspace`）的目录，可以是一级目录（`investment`），也可以是任意层子目录（`notion-archive/学习成长`）。
- 物理 root 永远按条目的第一段派生：`notion-archive/学习成长` → URL 前缀 `/notion-archive`、磁盘 `<MD_BASE_DIR>/notion-archive`。因此文档的 urlPath（`/notion-archive/学习成长/a.md`）、图片相对链接、收藏、双链、索引行都不因为空间划分而改变。
- 切换 set 后，侧栏只显示该 set 的作用域目录（子目录条目显示成一级节点，名字取最后一段）；「笔记」「已打开」面板同口径分组；术语表与语义索引也按作用域前缀生效。
- 同一个 set 内的条目不能互相包含（父目录与它的子目录只能选一个）；跨 set 允许重叠。
- UI：侧栏「空间管理」→「选择目录」弹窗（`GET /api/browse`）逐层挑目录，不用手打目录名。

旧的 `roots.json` 映射（`MD_ROOTS` / `MD_ROOTS_FILE`）已由空间 set 取代；老部署如需保留，把 `{url, dir}` 改写成 set 的一级目录条目即可。示例见 [`roots.example.json`](./roots.example.json) 与 [`docker-compose.example.yml`](./docker-compose.example.yml)。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MD_PORT` | `3001` | HTTP 端口 |
| `MD_BASE_DIR` | `/data/workspace` | 空间目录的挂载根：set 里的作用域条目都相对它 |
| `MD_SETS` | 内置默认 | set 配置 JSON 数组（覆盖 `sets.json`） |
| `MD_SETS_FILE` | `/app/sets.json` | 空间 set 配置文件名（UI 保存后热加载） |
| `MD_INDEX_DB` | `/data/index/md-index.db` | SQLite 索引库路径 |
| `EMBED_MODEL` | `Xenova/multilingual-e5-small` | 语义向量模型 |
| `MCP_PORT` | `3002` | MCP SSE 端口 |
| `R2_ENDPOINT` | 本账号 R2 endpoint | 编辑态图片存储（S3 兼容） |
| `R2_BUCKET` | `pics` | R2 桶名 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | 空 | R2 凭证；**不配则图片回落保存到文档目录 `assets/`**，也不会打印到日志 |
| `R2_PREFIX` | `md` | 对象 key 前缀（`md/2026/11/<uuid>.png`） |
| `R2_PUBLIC_BASE_URL` | 空 | 设了则 markdown 写绝对 URL；空则写站内代理 `/api/asset/r2/<key>` |

## 开发

- 开发宪法与硬门禁见 [`AGENTS.md`](./AGENTS.md)
- 功能开发走 spec：见 [`specs/README.md`](./specs/README.md)
- 测试：`npm test`；类型检查：`npx tsc --noEmit`
- 项目级 skill 见 `.dsh/skills/`（tdd / spec-driven-dev / code-map）

## License

[MIT](./LICENSE)
