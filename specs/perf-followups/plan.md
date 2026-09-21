# plan: 性能收尾三件事

现状基线（2026-09-20/21 实测，headless Chrome + curl，同一台机器）：

| 场景 | 现状 |
|---|---|
| 首屏加载 | 4.3MB（含 mermaid 3.3MB + katex 273KB + bundle 569KB），页面+树就绪 854ms |
| `/api/tree` | 116ms / 431KB，未压缩；每次刷新请求 **2 次**（store 与 TreeView 各一份） |
| 打开 864KB 文档 | 6.8s 到可见，单次长任务 4.2s（浏览器解析/布局 1MB HTML 占 5.2s 采样中的 `(program)`） |
| 打开 19 图文档（145KB） | 2.4s 到正文，5.4s 全部图表渲染完 |
| `md-index.db` | 609MB（freelist 255MB = 历史重建空洞），FTS 实占 ~296MB，干净重建同一批正文仅 122.7MB |
| `md-index.db-wal` | 1.37GB（`journal_size_limit=-1`，checkpoint 后不截断） |
| `POST /api/sets` | `setImmediate(rebuildIndex)` → 大目录时冻结 ~50s |

---

## W1 前端载荷与渲染

### W1-1 树只取一次（S / 收益中）

`web/src/state/store.tsx` 与 `web/src/components/sidebar/tree-view.tsx` 各自 `useEffect([dataVersion])` 调 `api.tree()`。
改为：store 持有 `tree` 状态并提供 `refreshTree()`；TreeView 只读 store。`dataVersion` 变化时由 store 统一去抖（≥2s）刷新一次。

### W1-2 压缩（S；需依赖审批 / 或走 nginx）

- 方案 A（推荐，应用内）：`npm i @fastify/compress`，`app.register(compress, { global: true, encodings: ['br','gzip'] })`；
  只压 `application/json`、`text/html`、`text/css`、`application/javascript`，跳过图片/已压缩内容。
  实测可省：`/api/tree` 431KB→64KB（6.6×）、`/api/render` 233KB→44KB（5.2×）、bundle 569KB→~150KB。
- 方案 B（零依赖）：在 `src/index.ts` 的 `onSend` 钩子里用 `node:zlib` 手动 gzip（仅 JSON/HTML 且 >2KB、且 `accept-encoding` 含 gzip）。
  实现 ~30 行，但需自己处理 `Content-Length`/`Vary`/流式响应。
- 方案 C（零代码）：nginx `gzip on; gzip_proxied any; gzip_types ...`（作用于所有站点，需改 nginx-proxy 配置，回滚=改回并 reload）。

> 依赖变更按 `AGENTS.md` 需先审批；默认走 A，若不想动依赖则走 B。

### W1-3 缓存策略（S / 收益高，仅二次访问）

`src/index.ts` 的全局 `onSend` 现在对所有响应写 `Cache-Control: no-cache`。改为按路径：

| 路径 | 头 |
|---|---|
| `/api/*` | `no-cache`（保持现状，数据实时） |
| `/assets/*` | `public, max-age=31536000, immutable`（Vite 文件名带 hash） |
| `/media/*` | `public, max-age=604800`（mermaid/katex，文件名不带 hash，用 ETag 兜底） |
| `/`、`/set/*`、`index.html` | `no-cache`（随时拿到新 bundle 引用） |

### W1-4 mermaid / katex 懒加载（S / 收益高）

`web/index.html` 里的两个 `<script src="/media/...">` 移除（3.3MB + 273KB 不再进首屏）。
`web/src/lib/markdown-extras.ts` 增加：

```
ensureMermaid(): Promise<MermaidLike|undefined>   // 首次调用注入 <script>，缓存 promise
ensureKatex():   Promise<KatexLike|undefined>
```

`renderExtras(el)` 先看 `el.querySelector('.mermaid-src')` / `.katex-math,.katex-block` 是否存在，
**按需** await 对应库；没有图表/公式的文档完全不加载。

### W1-5 mermaid 按需渲染（M / 收益高）

现在 `for (const el of container.querySelectorAll('.mermaid-src'))` 串行渲染**全部**图表（19 图 ≈ 2~3s）。
改为：首屏 3 张立即渲染，其余交给 `IntersectionObserver`（`rootMargin: '600px'`）进入视口附近再渲染；
渲染占位符保留原尺寸（`.mermaid-src` 预置 `min-height`）避免滚动跳动。放大/导出逻辑不变。

### W1-6 大文档主线程阻塞（M / 收益高）

按投入从低到高：

1. **CSS 层**：`.md-content > *` 加 `content-visibility: auto; contain-intrinsic-size: auto 400px;`
   —— 屏幕外的块跳过布局，长文档（1MB HTML / 数万节点）首屏布局成本大幅下降；风险是锚点定位与 `scrollIntoView` 需要复核（对 `content-visibility` 内的元素，浏览器会在定位前强制布局，通常可用；需回归验证 TOC 跳转与链接锚点）。
2. **首屏后再做高亮**：`highlightContent` 与 mermaid 放到 `requestAnimationFrame` + `requestIdleCallback`（无则 setTimeout 0）里执行，先出正文再逐步“补妆”。
3. **不再无条件重注入**：新增轻量端点 `GET /api/stat?path=`（走索引 `getFileMeta`，实测 <1ms，返回 `mtimeMs/size`）；
   前端每 5s 只查**当前文档**的 mtime，变了才重取正文；`dataVersion` 变化只去抖刷新树（配合 W1-1）。
4. （可选，L）超大文档（>300KB）分块注入：先注入前 N 个块，其余用 `requestIdleCallback` 追加。收益最大但改动最深，先做 1~3 再评估。

### 影响面 / 风险

- W1-4/W1-5 会动 `markdown-extras.ts` 的渲染时序：需回归「图表主题切换」「全屏放大」「导出 SVG」「打印」。
- W1-6-1 会动 CSS：需回归 TOC 定位、正文内锚点跳转、代码块横向滚动、mermaid 图宽度。
- 全部为前端改动，回滚 = `git revert` + 重新 `npm run build`（`web/dist` 由 Vite 产出）。

---

## W2 索引库回收

### 现状与数字

- `page_count 148767 × 4KB = 609MB`，其中 `freelist_count 62363 页 = 255MB` 是历史全量重建留下的空闲页。
- FTS：`fts_data 260.7MB + fts_content 35.2MB + fts_idx 1MB`；对同一批 24.3MB 正文干净重建只需 122.7MB → 生产 FTS 被反复 delete/insert 撑大。
- WAL 1.37GB：`journal_size_limit = -1`，checkpoint 后文件不截断（空间可复用，但一直占着磁盘）。
- 预期：`VACUUM` 后 DB ≈ 355MB（= 已用页 86404 × 4KB）。

### 步骤（一次维护窗口，停机 ≤5 分钟）

1. 备份：`docker exec md-server node -e "require('better-sqlite3')('/data/index/md-index.db',{readonly:true}).backup('/data/index/md-index.backup.db')"`，并 `docker cp` 到宿主 `/home/dev/backup/`（保留 7 天）。
2. 停容器：`docker compose stop`。
3. 迁移标记复位：删除 `meta.fts_rowid_v2`（让启动时重建一次，顺便压缩 FTS）；或直接全量 `rebuildIndex`（启动本来就会做）。
4. `VACUUM`：用一次性脚本对库执行 `PRAGMA journal_mode=WAL; VACUUM; PRAGMA wal_checkpoint(TRUNCATE);`
5. 代码侧长期措施（随本次一起上）：`src/index-db.ts` 的 `init()` 增加
   `PRAGMA journal_size_limit = 67108864 (64MB)`；`rebuildIndex()` 结束与 `wal_checkpoint(TRUNCATE)` 在显式全量重建后执行一次。
6. 起容器：`docker compose up -d`，等 `index ready` 后跑功能自检。

### 功能自检清单

搜索（"数据线"/"架构"/拼音 "touzi"/英文）、标签面板、反链/出链、`/api/tree` 节点数（维护前 2865）、待办、收藏、按 URL 打开大文档。

### 风险与回滚

- `VACUUM` 需要独占（无其他连接/事务）→ 必须停容器；中途失败时库不会被破坏（SQLite 用临时文件替换），最坏是磁盘占用临时翻倍（当前剩余 14GB，够）。
- 回滚：备份文件直接覆盖 `md-index.db`（WAL/SHM 删除）后启动容器（启动会自动重建索引，数据源是 md 文件，索引可重建）。
- 附带收益：全量重建耗时也会下降（FTS 更小）。

---

## W3 保存空间不再全量重建

### 现状

`POST /api/sets` → `setImmediate(() => { rebuildIndex(); buildEmbeddings(); })`，其中 `rebuildIndex()` 同步阻塞 ~50s。

### 设计

1. **求差集**（`src/index.ts` + `src/config.ts`）：保存前记录旧 `ROOTS`，保存后算出
   - 移除的目录：`removeIndexPrefix('/dir')`（已有）+ 对应向量删除；
   - 新增的目录：`scanRoot(url, dir)`（`scanner.ts` 新增，复用 `scanDir`）→ 批量 `indexFiles`；
   - 仅改名/换序：不触发索引工作。
2. **分批让出事件循环**：`src/index-db.ts` 增加
   `async function indexFilesInBatches(files, batch = 100)`，每批之间 `await new Promise(setImmediate)`，
   保证单个 tick 的阻塞 <100ms（100 篇 ≈ 0.8s → 再降到 50 篇/批更稳，以 `/api/status` 抖动 <200ms 为准）。
3. **请求立即返回**：`POST /api/sets` 校验+落盘后立刻返回，索引在后台跑；进度通过既有 `dataVersion` 暴露，前端已有 5s 轮询。
4. **计数与日志**：结束后打 `sets applied: +N -M (incremental)`；`/api/reindex` 仍保留手动全量重建。
5. **兜底**：新增目录文档数 >3000 或事件异常时，回退全量重建（异步，分批策略同上）。

### 影响面 / 风险

- 语义一致性：`SETS/ROOTS` 热更新与索引更新之间存在秒级窗口（新目录文档短暂不可搜）→ 可接受，文档中说明。
- 若在后台索引期间又保存一次 sets：用「重入保护 + 待处理标记」，最后一次生效（与现有 `writingSets` 去抖一致的思路）。
- 回滚：恢复 `rebuildIndex()` 调用即可（老行为）。

---

## 推荐实施顺序（收益/成本）

| 顺序 | 工作 | 成本 | 主要收益 | 依赖 |
|---|---|---|---|---|
| 1 | W3 增量应用 + 分批 | M | 保存空间不再冻结 50s | 无（复用增量索引） |
| 2 | W2 库回收 + WAL 上限 | S（维护窗口） | 释放 ~255MB + 1.37GB WAL，重建更快 | 需停机确认 |
| 3 | W1-1 树取一次 + W1-6-3 只在变化时重渲染 | S | 阅读时不再无谓重渲染 | 无 |
| 4 | W1-2 压缩 + W1-3 缓存 | S | 首屏/刷新流量降 85%+，二次加载近乎 0 | 依赖审批（A 方案） |
| 5 | W1-4 mermaid/katex 懒加载 | S | 首屏少 3.6MB | 无 |
| 6 | W1-5 图表按需渲染 | M | 19 图文档 5.4s → <2s | 无 |
| 7 | W1-6-1/2 content-visibility + 延后高亮 | M | 大文档 6.8s → <2.5s | 需回归锚点/TOC |

每项独立可上线、独立可回滚；1/2 先做是因为「用户可感知的系统级不确定」优先于「单文档体验」。
