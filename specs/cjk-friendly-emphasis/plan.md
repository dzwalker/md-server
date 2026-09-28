# plan: CJK 友好强调

## 技术方案

- 依赖：`markdown-it-cjk-friendly@3.0.0`（2026-08-22 发布，MIT，ESM-only，dist 3.2KB，唯一运行时依赖 `get-east-asian-width`）。
  - peer：`markdown-it: *`（本机实装 **14.3.1** ✓）、可选 `@types/markdown-it >= 14.2.0`（本机 **14.2.0** ✓）。
  - v3 同时支持 markdown-it 14 / 15；v1 对应 markdown-it 13。升级 markdown-it 到 15 时插件无需改动。
- 接线（唯一改动点 `src/render.ts`）：在 `md.use(katexPlugin)` **之前** `md.use(cjkFriendly)`。
  - 插件通过子类化 `md.inline.State` 并覆盖 `scanDelims()` 生效，只改分隔符贴合判定，不新增 inline 规则，因此与 katex / wikilink / anchor / emoji / footnote / task-lists 不冲突（已实测）。
- 测试（`src/render.test.ts`）：新增 `describe('CJK-friendly 强调')` 6 例——3 个中文句式 + 1 个韩文 + 2 个反向断言（纯英文标点相邻不得放宽、代码里的 `**` 原样保留）。

## 影响面

- 渲染层单点，**无 API / MCP 签名变更**，`/api/render/*` 与 MCP 工具返回结构不变（仍是 `{ html, headings }`）。
- 前端 `web/` 不解析 markdown（无 markdown-it 依赖），无需同步改动。
- 语义变化仅限「CJK 字符/CJK 标点紧邻 `**`」的场景：这些位置此前渲染成字面 `**`，此后变为强调。
- 实测 diff（`learning-ad` 181 个 md，真实渲染管线含 KaTeX/wikilink）：38 文件 / 227 行 HTML 变化，`<strong>` 净增 173；抽样全部是「本应加粗却显示字面 `**`」的修复。
- 依赖体积/构建：+1 直接依赖 + 1 传递依赖，`npm install` 后 `package-lock.json` 有对应变更；Docker 镜像需重建才生效。

## 风险与回滚

| 风险 | 说明 | 处置 |
|---|---|---|
| 与上游规范不一致 | 这是 opt-in 草案，GitHub/GitLab 网页渲染同一份笔记仍显示字面 `**` | 已知并接受；需要外部一致时用 VS Code 扩展 `markdown-cjk-fix`（注入同一插件） |
| 耦合 markdown-it 内部结构 | 插件覆盖 `md.inline.State.scanDelims`，依赖内部分隔符判定 | 锁 `^3.0.0`；升级 markdown-it 前先跑 `npm test` 与 652 例对比脚本 |
| 少数多重强调边界 | 少量笔记里 `**"记忆"**——…**马尔可夫性**` 这类多重强调会重新配对 | 上线后抽查那 38 个文件（已确认主题均为「修复」，无「由加粗变不加粗」） |
| 依赖变更 | 违反零依赖直觉 | 已在 2026-09-28 经用户批准后安装 |

**回滚**：删掉 `src/render.ts` 里那一行 `md.use(cjkFriendly)`（或注释掉）即可恢复原行为，无需改数据；彻底回滚再 `npm uninstall markdown-it-cjk-friendly`。

## 验证脚本

- 652 例对比与语料 diff 的沙箱脚本（隔离于仓库，`/tmp` 下）：`/tmp/cjktest/exp.mjs`（规范用例 + 语料）、`/tmp/cjktest/diff.mts`（真实渲染管线 diff）。
- 本地联调：`MD_BASE_DIR=/home/dev/workspace MD_SETS_FILE=./sets.json MD_INDEX_DB=/tmp/md-verify/index.db MD_PORT=3011 npx tsx src/index.ts`，再 `curl /api/render/<space>/<path>`。
