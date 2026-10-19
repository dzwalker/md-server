# spec: 出链去重 + 引用次数 + 点击跳转

## 背景

- 现状：`GET /api/outlinks/*` 把 `links` 表里该文档的每一行原样返回——同一个 `[[目标]]` 在正文出现 N 次就返回 N 条；前端 `doc-view.tsx` 用纯文本 `<li>` 渲染。
- 后果（截图反馈）：
  1. 列表全是重复项（`kalman-filter` 出现 9 次、`least-squares` 出现十几次），一眼看不出「到底链到几篇笔记」；
  2. 条目不可点，看到出链还得回左侧树里手找；
  3. 标题括号里的数字是「出现次数」，不是「链到几篇笔记」，越长越离谱。
- 根因：`links` 表按**出现次数**存行（`extractWikilinks` 每命中一次插一行），`outlinks()` 直接 `SELECT target ... ORDER BY target`，既不去重也不聚合。

## 目标

1. **去重**：同一 `target` 只出现一次，并带回引用次数；前端 `count > 1` 时显示 `×N`。
2. **顺序**：按正文首次出现顺序（跟阅读顺序一致），不再按 target 字母序。
3. **可点击**：能解析到目标文档的条目渲染成链接按钮，点击直接打开；解析不到的（悬空双链）保持灰色纯文本、不可点。
4. **计数**：面板标题括号里的数字 = 去重后的目标数。
5. **API 签名变更**：`GET /api/outlinks/*` 响应从 `string[]` 变为 `{ target: string; count: number }[]`（同步 README、specs 与本仓库两个前端）。

## 非目标

- 不改 `links` 表结构与索引写入（仍然按出现次数存行，聚合在查询期做）。
- 不改 `/api/backlinks`、`/api/graph`、MCP 工具。
- 不按「同一文件的不同写法」二次合并：`[[a]]` 与 `[[/x/a.md]]` 仍是两个 target；它们能否解析到同一篇文档由前端 `resolveWikilink` 决定（与正文内双链点击同一套逻辑）。
- 不做悬空双链的单独分组 / 「未创建」标记（本次只保持灰文本、不可点）。

## 验收标准（Given-When-Then）

**A. 接口**

- [x] Given 文档正文 `[[zeta]] [[b]] [[zeta]] [[b|别名]] [[c#sec]] [[b]]`，When `GET /api/outlinks/<该文档>`，Then 返回 `[{ target: 'zeta', count: 2 }, { target: 'b', count: 3 }, { target: 'c', count: 1 }]`（去重 + 正文首现顺序 + 计数）。
- [x] Given 文档没有双链，Then 返回 `[]`。
- [x] Given 不存在 / 未索引的文档路径，Then 返回 `[]`，且不报错。

**B. 面板**

- [x] Given 出链面板，Then 同一目标只出现一次；`count > 1` 时在名字后显示 `×N`。
- [x] Given 目标文档存在（当前树里有同 basename 或同路径的文件），Then 条目为主题色按钮、hover 下划线，点击打开该文档（进已打开列表 + 切换 active tab）。
- [x] Given 目标文档不存在（悬空双链，如 `bicycle-model`），Then 条目为灰色纯文本，不可点击，点击无副作用。
- [x] Given 面板标题，Then 括号里的数字 = 去重后的条目数。
- [x] Given 从有出链的文档切到另一篇文档，Then 面板内容与计数随之更新。

**C. 兼容与降级**

- [x] Given 未构建 `web/dist`、走单文件兜底前端（`public/index.html`），Then 出链同样去重、可点击。
- [x] Given 本仓库内的其它调用方（仅 `web/` 与 `public/index.html`），Then 无影响；构建产物类型检查通过。

## 影响面

- 后端：`src/index-db.ts`（`outlinks()` 返回值）、`src/index.ts`（路由透传，无逻辑改动）。
- 前端：`web/src/lib/types.ts`（新增类型）、`web/src/lib/api.ts`、`web/src/components/doc-view.tsx`（出链面板渲染；解析复用 `lib/doc-links.ts` 的 `resolveWikilink`）。
- 兜底前端：`public/index.html`。
- 文档：`README.md` 功能列表、`specs/README.md` 索引。

## 交付记录

- 2026-10-19 实现完成：`npx tsc --noEmit` 通过、`npm test` **88/88** 全绿、`web/ npm run build` 成功（bundle `index-COoF97Iu.js`）。
- 本地 dev 实例（fixture 4 篇文档 + 独立 `MD_INDEX_DB`，:3098）Playwright + 本机 Chrome **DOM 断言 13/13 通过**：去重条数/计数/正文首现顺序、`×3` 徽标、可点按钮跳转、悬空双链灰文本不可点、切换文档后恢复、无 console error。
- 旧版兜底前端（临时移走 `web/dist/index.html`）**7/7 断言通过**（去重/计数/可点/跳转）；其中 `/api/roots` 404 是旧版前端自身既有请求，与本次改动无关。
- 2026-10-19 上线：commit `238b79f`（main，已 push）；`docker compose up -d --build` 镜像 `4dfee2139d9c`，容器 healthy（2724 files / 99 tags / 7 roots），线上 bundle `assets/index-COoF97Iu.js` 与本地 Playwright 验证过的产物哈希一致。
- 线上核对（真实索引副本 + 真实 md 数据，独立实例 :3096）Playwright **8/8 通过**：`/learning-ad/concepts/transformer.md` 出链由 20 条重复 → **10 组**（`kalman-filter×5` 首项、`sensor-fusion×2` 悬空灰显不可点、其余可点并成功跳转），无 console error。
