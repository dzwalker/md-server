# spec: 阅读态列表样式（项目符号 / 编号丢失）

## 背景

用户反馈：阅读模式下 `* xxx` / `1. xxx` 的列表退化成「缩进段落」，项目符号与编号全丢（截图见下），源码里的列表结构没错。

- 正文 HTML 由服务端 `renderMarkdown`（`src/render.ts`）产出，结构是正确的 `<ul><li>` / `<ol><li>`：
  实测 `* 甲\n* 乙` → `<ul><li>甲</li><li>乙</li></ul>`。
- 阅读态样式在 `web/src/index.css` 的 `.md-content` 段。旧版 `public/index.html`（无构建步骤）靠浏览器默认
  `ul { list-style: disc }` 就能显示符号，所以这个问题一直没暴露。
- 前端重构为 React + **Tailwind v4**（`specs/frontend-refactor/`）后，Tailwind 的 **preflight** 在 `@layer base`
  里做了 `ol, ul, menu { list-style: none; margin: 0; padding: 0 }`。`.md-content ul/ol` 只补回了
  `padding-left: 1.5em`，没有还原 `list-style`，于是 `li` 的计算样式是 `list-style-type: none`。
- 无头浏览器复核（构建产物真实 CSS）：`li` 的 `list-style-type` 全部为 `none`，四级嵌套、有序列表、任务清单一致。

## 目标

1. 阅读态（`.md-content`，含块编辑器的「渲染态」块、`- [ ]` 任务清单）恢复列表标记：
   - 无序：一级 `disc`、二级 `circle`、三级 `square`（与 GitHub 渲染习惯一致）；
   - 有序：一级 `decimal`、二级 `lower-alpha`、三级 `lower-roman`；
   - 任务清单项（`li.task-list-item`）不叠项目符号（勾选框本身就是标记），勾选框加 `accent-color` 跟随主题。
2. 术语表悬浮定义（`.glossary-tip-md`，同样是 markdown 渲染的 HTML）一并修，避免同一 bug 在下一处复现。
3. 不改 DOM 结构、不改服务端渲染、不改 API。

## 非目标

- 不改 `src/render.ts`（HTML 本来就对，问题是 CSS 层）。
- 不改富文本编辑器（Milkdown/Crepe、Muya）自己的列表渲染——它们是 `<div>` + 自己的 label，不依赖 `list-style`。
- 不改侧栏/目录/反链这些「非正文」列表（它们本来就有 `list-style: none`，是按钮列表）。
- 不做「阅读态点任务清单勾选框就写盘」——勾选仍是本地视觉，不落盘（现有行为）。

## 验收标准（Given-When-Then）

- [x] Given 用户那篇笔记（4 条无序列表），When 在 `claude` 主题阅读，Then 每条前面出现 `•`，缩进与正文一致。
- [x] Given `- 一级\n  - 二级\n    - 三级`，Then `li` 计算样式依次为 `disc` / `circle` / `square`。
- [x] Given `1. 甲\n2. 乙`（含二层 `1.`），Then 计算样式一级 `decimal`、二级 `lower-alpha`。
- [x] Given `- [ ] 待办`，Then 该 `li` 不显示项目符号，勾选框与文字基线对齐、可正常识别。
- [x] Given 术语表定义的 markdown 含列表，Then 悬浮定义里同样有项目符号。
- [x] Given 暗色主题（`.dark`），Then 标记颜色跟随正文色，不出现看不清的深色圆点。
- [x] 门禁：`cd web && npm run build`（含 `tsc --noEmit`）通过；根目录 `npx tsc --noEmit`、`npm test` 通过。
- [x] 浏览器验证：本地静态托管 `web/dist` + 代理真实 API，用构建产物 CSS 在应用内实测（见交付记录）。

## 交付记录

- 改动：`web/src/index.css` —— `.md-content ul/ol` 增加 `list-style-type`（含嵌套层级），`li` 间距、嵌套列表外距、
  `li.task-list-item` 去符号与勾选框样式；`.glossary-tip-md ul/ol` 同步还原。
- 复核方式（无头 Chrome，用 `npm run build` 的 CSS）：
  - 修前：所有 `li` 的 `list-style-type` = `none`（与用户截图一致，列表变缩进段落）；
  - 修后：`ul>li`=`disc`、`ul ul>li`=`circle`、`ul ul ul>li`=`square`、`ol>li`=`decimal`、`ol ol>li`=`lower-alpha`、
    `li.task-list-item`=`none`（有勾选框）；
  - 真实文档（`/lark-archive/AGENTS.md`，4 个 ul + 1 个 ol）在 `claude` 与 `prose`+暗色两套主题下均正常。
- 生效方式：容器镜像在构建阶段产出 `web/dist`（Dockerfile 多阶段），因此需要重新 build 镜像才会上线；
  本地/开发直连后端时若 `web/dist` 不存在，会回退 `public/index.html`（旧前端无 preflight，不受影响）。
- 2026-11-05 **已上线**：本机 `docker compose up -d --build`，镜像 `md-server-md-server:latest`
  （manifest `sha256:b57184b6…`）。核对：镜像内 `web/dist/assets/index-Ba3tqIMb.css` 与本地已浏览器验证的产物
  sha256 逐字节一致（`96b31a18…`）；容器 `healthz` = ok（8 roots / 5 sets / 3402 files）；对容器直连跑无头 Chrome，
  真实文档 `/lark-archive/AGENTS.md` 的 `ul>li`=`disc`、`ol>li`=`decimal`；`https://md.zwalker.me` 仍是既有登录网关 302。
