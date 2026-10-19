# plan: 出链去重 + 引用次数 + 点击跳转

## 技术方案

### 1. 后端聚合（`src/index-db.ts`）

`outlinks(path)` 从「原样返回每行 target」改为「按 target 聚合」：

```sql
SELECT target, COUNT(*) AS count, MIN(rowid) AS first
FROM links
WHERE source = ?
GROUP BY target
ORDER BY first
```

- `MIN(rowid)` = 该 target 在 `links` 表里第一次被插入的行号；索引写入时 `extractWikilinks` 按正文顺序逐条 `INSERT`，增量索引也是整文件先删后插，因此 rowid 顺序 = **正文出现顺序**。
- `COUNT(*)` = 引用次数（正文里出现几次）。
- 返回值类型：`{ target: string; count: number }[]`（导出 `Outlink` 接口）。

### 2. 路由（`src/index.ts`）

`/api/outlinks/*` 保持透传，无改动；响应体形状由 `outlinks()` 决定。

### 3. 前端（`web/`）

- `lib/types.ts`：新增 `export interface Outlink { target: string; count: number }`。
- `lib/api.ts`：`outlinks: (path) => get<Outlink[]>(...)`。
- `components/doc-view.tsx`：
  - state 类型改 `Outlink[]`；
  - 渲染每条时调 `resolveWikilink(o.target, fileIndex)`（与正文内 `[[双链]]` 点击**同一套解析**，不引入第二套规则）：
    - 解析到 → `<button>`，`text-primary hover:underline`，点击 `openDoc(path, title)`；
    - 解析不到 → `<span className="text-muted-foreground">`，不可点；
  - `count > 1` 时追加 `×N`（`text-xs text-muted-foreground`）；
  - 标题继续用 `outlinks.length`，现在自然是去重后的目标数。
  - 显示文本仍用 target 原文（不换成标题），保证条目可辨认；`title` 属性给解析到的文档标题。

### 4. 兜底前端（`public/index.html`）

同样的渲染规则用原生 DOM 实现（`ol` 现在已是聚合对象；去掉 `new Set`；有 `path` 的加 `cursor:pointer` + `loadFile`）。

### 5. 测试

- `src/index-db.test.ts` 末尾新增 describe：同一目标多次出现 → 去重、计数、正文首现顺序；`|别名`、`#锚点` 归一；悬空目标也保留。
- 前端无单测运行器，沿用前几轮的 **Playwright + 本机 Chrome DOM 断言**（本地 dev 实例 + fixture 文档），断言去重条数、`×N`、可点/不可点、点击后 active tab。

## 影响面 / 兼容性

| 面 | 影响 |
|---|---|
| HTTP API | `GET /api/outlinks/*` 响应 `string[]` → `{target,count}[]`（**破坏性变更**，仓库内调用方仅 `web/` 与 `public/index.html`，本次一并改） |
| MCP | 无出链工具，不受影响 |
| 索引 / DB | 无 schema 变更、无重扫；纯查询期聚合 |
| 性能 | 单文件出链目标数 < 50，`GROUP BY` 走 `idx_links_source`，无额外开销 |
| 生产数据 | 只读查询，不写 md |

## 风险与回滚

- 风险 1：外部脚本/别的工具直连 `/api/outlinks` 并假定 `string[]` → 仓库内无此类调用；README 未承诺该响应形状。回滚方式：`git revert` 本次提交并重建前端。
- 风险 2：解析规则与正文链接不一致 → 直接复用 `resolveWikilink`，不新写规则，天然一致。
- 风险 3：目标名与标题不同的条目仍显示 slug → 有意为之（可辨认），后续如需要再改显示标题。
