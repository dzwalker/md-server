# glossary 实现计划

## 分层

| 模块 | 职责 |
|---|---|
| `src/glossary.ts`（新增） | 文件名判定、术语表解析（纯函数）、空间作用域聚合、长词优先匹配器、mtime 缓存与版本号 |
| `src/render.ts` | markdown-it core 插件：inline text token 切分并包 `span.glossary-term`；笔记卡片复用同一函数；`renderMarkdown` 增加术语索引入参并返回定义 payload |
| `src/index.ts` | `/api/render/*` 传术语索引；`/api/stat` 增加 `glossaryVersion` |
| `web/src/lib/glossary.ts`（新增） | 浮层 DOM、定位翻转、事件委托、KaTeX 定义渲染 |
| `web/src/components/doc-view.tsx` | 绑定浮层；`/api/stat` 比较 `glossaryVersion` 触发重渲染 |
| `web/src/lib/types.ts`、`src/index.css` | 响应类型、下划线与浮层样式 |

## 关键实现

### 解析（`parseGlossaryMarkdown`）

逐行状态机：fence 跟踪 → 一级标题结束块 → 二级标题开块 → 别名行收集 → 其余进定义。别名分隔符 `、，,;；/|`；定义 / 主名称都做行内 markdown 清理（链接、反引号、加粗、HTML 标签）后得到纯名字。

### 聚合与缓存（`glossaryForDoc`）

1. `spaceDirsForPath(urlPath)`：一级目录 → 所有包含它的 set 的目录并集（排序保证确定性）。
2. `listFileSummaries()`（SQLite，一次查询）过滤出这些目录里的术语表文件；`fs.statSync` 取 mtime，按 urlPath 排序。
3. `version = djb2(dirs + "|" + 每个文件 urlPath:mtimeMs)`；索引按 version 缓存（LRU 24 个）。
4. 单文件解析按 `urlPath` 缓存、mtime 命中即复用，避免 5s 轮询重复解析。
5. `buildGlossaryIndex(files)`：名字 → `{ display, names[], defs[] }`；定义按原文去重。匹配器一次编译，按字符数降序 + 去重（规范化后），带 `gi`。

### 匹配与切分（render.ts）

- 每个 alternative 用 `(?<![A-Za-z0-9_])` / `(?![A-Za-z0-9_])` 包裹——**仅当首/尾字符是 ASCII 字母数字下划线时**加，保证中文子串与「中文+英文边界」语义不变。
- core 规则 `after('inline')` 遍历每个 inline 块的 children：维护 link 深度，跳过 `link_open..link_close` 之间的文字；对 `text` token 用共享正则 `exec` 扫描，切成 `text` + `glossary_term` token（`attrSet('data-glossary', normalize(matched))`）。
- `glossary_term` 渲染器：`<span class="glossary-term" data-glossary="key">原文</span>`（`escapeHtml`），并把 key 记入 `env.glossaryUsed`。
- 笔记卡片：`md.parseInline(raw, env)` 后对同一 children 复用切分函数，再 `renderer.renderInline`；这样 `> note:` 内也生效。
- 渲染完成后，仅对**本文档命中**的 key 生成 `glossary.terms`（最多 3 条定义，`total` 为去重后总数），定义用同一个 md 实例 `md.render(raw, {})`（空 env 防止递归标注）。

### 前端浮层

- `bindGlossaryTooltip(container, getPayload)`：`mouseover` 委托识别 `.glossary-term`，点击（触屏）也打开；`mouseout`/`mouseleave`/滚动/Esc/点击空白关闭；浮层自身可进入（悬停不关闭、可滚动、可点链接）。
- 定位固定 `position: fixed`，默认在词下方 6px，超出视口翻到上方，左右夹取；测量后再显示避免闪烁。
- 内容：名字（主名称 + 别名）→ 每条定义（正文 HTML + 来源文件名）→ 截断提示；定义里若有公式，调用 `renderExtras` 局部补渲染 KaTeX。
- 事件绑在常驻的 `.md-content` 容器上，正文整篇/局部替换都不需要重新绑定。

### 自动刷新

`/api/stat` 返回 `glossaryVersion`；`doc-view.tsx` 的 5s 轮询原本只比 `mtimeMs`，现在同时比 `glossaryVersion`，不一致就重拉 `/api/render`。

## 兼容性 / 风险

- `renderMarkdown` 第三参数可选：不传时 core 插件不做任何事，HTML 与旧版逐字节一致；现有测试零改动。
- `/api/render`、`/api/stat` 只是新增字段，不破坏前端旧版本。
- 每个打开文档 5s 一次：一次 SQLite 全量文件清单查询 + 少数几次 stat，毫秒级；解析有 mtime 缓存。
- 定义 HTML 走现有 markdown 信任模型（与正文同源，`html: true`），不引入新的安全边界。
- 长词优先/左优先的边界行为已写进 spec，避免被当成 bug。

## 回滚

删除 `src/glossary.ts`、`web/src/lib/glossary.ts`，回退 `render.ts` / `index.ts` / `doc-view.tsx` 三处改动即可；不涉及数据迁移（无新表、无写入）。
