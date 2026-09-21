# spec: 性能收尾三件事 —— 前端载荷 / 索引库回收 / 空间保存不再全量重建

## 背景

2026-09-20 已上线「增量索引 + 请求不再全库扫盘」（见 `specs/incremental-index/`），
服务端 40~60s 冻结已消除。用户环境实测剩余瓶颈分三块：

- **W1 前端载荷与渲染**：初次加载要下 `mermaid.min.js` 3.3MB；`/api/tree` 每次刷新取两遍（431KB，未压缩）；
  所有响应（含静态资源）都带 `Cache-Control: no-cache`；大文档注入 1MB HTML 时主线程被占 4.2s
  （864KB 的 lark bitable 实测 6.8s）；19 张 mermaid 的文档实测 5.4s；`dataVersion` 一变就无条件重取并重注入正文。
- **W2 索引库膨胀**：`md-index.db` 609MB、WAL 1.37GB。实测 `freelist_count = 62363 页 = 255MB` 是历史全量重建留下的空洞；
  FTS 实测 `fts_data 260MB + fts_content 35MB`（干净重建同一批正文只要 122.7MB，说明生产 FTS 被反复 delete/insert 撑大了）。
- **W3 保存空间仍全量重建**：`POST /api/sets` 走 `rebuildIndex()`，加一个大目录（如 neolix-ad 1781 篇）会再冻结 ~50s。

## 目标

| 工作流 | 目标 |
|---|---|
| W1 | 首屏下载量降到 <1MB（无图表文档）；打开 864KB 大文档 <2.5s；19 图文档 <2s；切换文档不再无条件重渲染 |
| W2 | 索引库 609MB → ~355MB（回收 freelist）；WAL 从 1.37GB 降到 <100MB 且不再无限增长 |
| W3 | 保存空间立即返回；新增/移除目录走增量，后台分批索引，期间 `/api/status` 不出现 >200ms 抖动 |

## 非目标

- 不改文档渲染的**产出**（HTML 结构、锚点、代码高亮样式、`/api/render` 响应字段不变）。
- 不改搜索排序规则与 `specs/` 里既定的排序优先级。
- 不引入服务端渲染框架、不重写前端框架；不引入除压缩中间件外的新依赖。
- 不做多用户/权限、不做 CDN。

## 已排除的方案（有实测依据）

| 方案 | 实测 | 结论 |
|---|---|---|
| FTS 用 `detail=none` 缩索引 | 122.7MB → 58.2MB，但 4 字以上中文查询直接报 `phrase queries are not supported`（"计算架构"/"干预记录" 均报错） | 否决（除非同时做查询改写，收益/风险不划算） |
| FTS 只索引正文前 50KB | 122.7MB → 112.0MB（仅省 10MB），大文档尾部关键词命中 0 | 否决（省得少、丢检索） |
| 用 nginx 全局 gzip 代替应用层压缩 | 可行，零代码 | 备选（见 W1-2） |

## 验收标准（按工作流）

### W1 前端载荷与渲染

- [x] 初次加载转移字节：无图表文档 **4.3MB → 191KB**；mermaid 首屏不加载（katex 只加载 23KB 的 CSS，JS 按需）。
- [x] `/api/tree` 每次刷新只请求 **1 次**（原 2 次）；线上 431KB 响应压缩后浏览器实收 **57.9KB (br)**。
- [x] 静态资源长缓存：`/assets/*` = `public, max-age=31536000, immutable`、`/media/*` = `public, max-age=604800`；`/api/*` 与 HTML 保持 `no-cache`。
- [~] 864KB bitable 文档「点击→正文」**6.8s → 5.3s**（未达 <2.5s 目标）：实测瓶颈是浏览器对 45,750 个元素/42,935 个表格单元格的样式+布局（解析只用 103ms），已试 `table-layout:fixed`、`contain`、行级 `content-visibility` 均无效（详见 `tasks.md` 归因段）。剩余优化需行级虚拟化或归档侧拆表。
- [~] 19 张 mermaid 文档：首屏图表数从 19 张降到 **3 张**（点击→正文 2.38s → **1.56s**，首图 2.94s）；其余随滚动渲染，功能（放大/导出）不变。若要求「首图 <1s」需进一步压缩首屏 3 张的 eager 数量。
- [x] 外部改动不影响当前文档时零重渲染：静置 20s 仅 `/api/status`×4 + `/api/stat`×4，无 `/api/render` 重注入。

### W2 索引库回收

- [x] `md-index.db` **581MB → 157MB**、`-wal` **1310MB → 0**（目标 ≤380MB / ≤100MB，超额达成）。
- [x] 停机窗口实测约 **10s**（FTS optimize 6.4s + VACUUM 3.7s），备份保留在 `/home/dev/backup/md-index-backup-20260921.db`（校验 `files=2429 / fts=2429`）。
- [x] 维护后功能自检：搜索（中文/拼音/英文/标签）、反链/出链、`/api/tree` 节点数 **2865**、待办、收藏、大文档打开全部正常；`quick_check = ok`。
- [x] 附加收益：启动索引同步 **40~60s → 1.4s**（`index ready (incremental, 3 changed, 1369ms)`）。

### W3 保存空间不再全量重建

- [x] `POST /api/sets` 响应 **112ms**（目标 <300ms；改造前 3.9s，更早版本冻结 ~50s）。
- [x] 新增目录：后台分批索引完成（日志 `sets applied: added /clawgrid-mcp (index +1)`），树与搜索可见。
- [x] 移除目录：索引 2429 → 2274（-156 篇），搜索/图谱不再返回。
- [x] 全程 `/api/status` 最慢 **144ms**（目标 <200ms）。
- [x] 仅改名/换序不触发索引工作（差集为空时日志 `sets applied: no index change`）。
