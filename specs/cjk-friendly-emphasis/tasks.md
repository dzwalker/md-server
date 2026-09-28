# tasks: CJK 友好强调

- [x] 调研上游与社区做法：commonmark-spec#650 状态、CJK-friendly 草案、各实现/产品采纳情况（VitePress / Rspress / Cherry Studio / comrak / goldmark / Markdig）
- [x] 复现根因：flanking 规则 + GitHub 官方 API 对照（同句同为字面 `**`）
- [x] 盘点影响面：`learning-ad` 181 个 md → 36 处失效强调；沙箱实测插件效果（652 例零差异、38 文件 / 227 行 diff）
- [x] 取得用户批准安装依赖
- [x] `npm install markdown-it-cjk-friendly@3.0.0`（写入 `package.json` / `package-lock.json`）
- [x] `src/render.ts`：`import cjkFriendly` + `md.use(cjkFriendly)`（置于 `katexPlugin` 之前）
- [x] `src/render.test.ts`：新增 6 例（3 中文句式 + 1 韩文 + 2 反向断言）
- [x] `npx tsc --noEmit` 通过
- [x] `npm test` 全绿（28/28）
- [x] 本地起服务，`/api/render/*` 验证真实产物（`matrix-basics.md` 命中 `<strong>&quot;方差越小 → 权重越大&quot;</strong>`，字面 `**` 行数 0）
- [x] `specs/README.md` 现状清单补条目；`README.md` 渲染能力补「CJK 友好强调」
- [ ] 上线：`docker compose up -d --build` 重建 md-server 容器（**待用户批准**）
- [ ] 上线后抽查那 38 个文件在 `md.zwalker.me` 的实际观感
