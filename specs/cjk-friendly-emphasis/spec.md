# spec: CJK 友好强调（`**"中文"**中文` 能正常加粗）

## 背景

- CommonMark 用「左/右贴合（left/right-flanking）」规则判定 `**` 是否构成强调，前提是**词与标点之间有空格**（英文习惯）。
- 中文没有词间空格，于是收尾 `**` 左边是标点（`"`、`）`、`」`）、右边紧跟汉字时，两条 right-flanking 判定都不成立 → `**` 退化成字面文本：
  - `**"方差越小 → 权重越大"**这句话，写成矩阵形式就是"对角元取倒数"。`（learning-ad/concepts/matrix-basics.md）
  - 起始侧同理：`反过来看**"自由"那一支**（…）`。
- 这是 **CommonMark 规范层缺陷**，不是 md-server 的 bug，也不是作者的写法问题：上游 issue [commonmark-spec#650](https://github.com/commonmark/commonmark-spec/issues/650) 2020-05-26 开、至今 open（237 条评论，2026-04 有人做跨实现采纳汇总并明确「不提议改规范」）。GitHub 官方 markdown API（cmark-gfm）对同一句同样输出字面 `**`。
- 实测影响面：`learning-ad` 181 个 md 中有 **36 处**（开分隔符失败 15 / 收分隔符失败 19 / 混合 2）；接入插件后整仓渲染输出变化 **38 个文件 / 227 行 HTML，`<strong>` 净增 173 个**。

## 目标

1. md-server 渲染时，`**…**` 只要紧邻 CJK 字符/CJK 标点，就按作者意图识别为强调（起始侧与收尾侧都要修）。
2. 采用社区已收敛的事实标准做法，而不是让作者在 36 处笔记里补空格，也不是自己发明一套规则：
   **接入 tats-u 的 CJK-friendly 修订草案**（[markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly)）的 markdown-it 实现 `markdown-it-cjk-friendly`。
3. **opt-in、对非 CJK 输入零影响**：CommonMark 官方用例逐例输出不变（VitePress v2 / Rspress v2.0.5 / Cherry Studio 均采用同一方案）。

## 非目标

- 不改 `learning-ad` 笔记内容（渲染器修好后存量自然恢复）。
- 不改任何 API / MCP 工具签名（纯渲染层，`/api/render` 的返回结构不变）。
- 不修改 CommonMark 的默认语义：插件只在 CJK 相邻场景生效，不引入新的语法。
- 不做富文本编辑器侧（`web/` 前端不解析 markdown，服务端渲染是单点）。
- 不追求与其他工具观感一致：GitHub/GitLab 网页渲染仍会显示字面 `**`（上游未采纳该草案）。

## 验收标准（Given-When-Then）

**A. CJK 场景**

- [x] Given `**"方差越小 → 权重越大"**这句话，…`，When 渲染，Then 输出 `<strong>&quot;方差越小 → 权重越大&quot;</strong>这句话`，且无字面 `**`。
- [x] Given `这个想法在**M2 的占据栅格图（occupancy grid map）**里…`，When 渲染，Then 加粗内容为 `M2 的占据栅格图（occupancy grid map）`。
- [x] Given `反过来看**"自由"那一支**，…`，When 渲染，Then 起始侧 `**` 被识别为强调。
- [x] Given `*스크립트(script)*라고`（韩文，用半角括号），When 渲染，Then 输出 `<em>스크립트(script)</em>라고`。

**B. 兼容与不回归**

- [x] Given CommonMark 0.31.2 官方 652 个用例，When 逐例对比接入前后输出，Then **差异 0 例**。
- [x] Given 纯英文场景 `a**.test.**b`（规范判定「不是强调」），Then 仍输出字面 `a**.test.**b`（不放宽）。
- [x] Given `` `**not emph**` `` 与代码块里的 `**literal**中文`，Then 原样保留。
- [x] Given Python `**` 幂运算符所在的代码块，Then 不受影响（`learning-ad` 全量接入后残留字面 `**` 的 56 行全在代码块/行内代码）。

**C. 门禁**

- [x] `npx tsc --noEmit` 通过。
- [x] `npm test` 全绿（22 → 28 例）。
- [x] 本地起服务，经 `/api/render/*` 验证真实渲染产物（见交付记录）。

## 交付记录

- 2026-09-28 实现完成：`src/render.ts` 增 `md.use(cjkFriendly)`，`src/render.test.ts` 增 6 例，`package.json` 增依赖 `markdown-it-cjk-friendly@^3.0.0`。
- 2026-09-28 验证：官方 652 例零差异；`learning-ad` 181 个 md 渲染 diff = 38 文件 / 227 行（`<strong>` +173）；本地 `MD_PORT=3011` 起服务，`/api/render/learning-ad/concepts/matrix-basics.md` 返回 `<strong>&quot;方差越小 → 权重越大&quot;</strong>`，该文件字面 `**` 行数 0。
- 2026-09-28 **未上线**：本机 `md-server` 容器仍是旧镜像，需 `docker compose up -d --build`（需用户批准）。
