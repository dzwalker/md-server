# tasks: 命令面板空态「最近更新」+ ⌘O 已打开文档看板（2026-09-22）

## T1 后端：最近更新查询（TDD）

- [x] RED：`src/index-db.test.ts` 新增 `listRecentFiles` 用例（全局倒序 / dirs 过滤 / 多目录合并 / limit 截断 / 未知目录为空 / 返回字段），先跑出 `listRecentFiles is not a function`。
- [x] GREEN：`src/index-db.ts` 新增 `listRecentFiles({dirs, limit})`（单条 SQL + limit 夹到 1–200）。
- [x] `src/index.ts` 新增 `GET /api/recent?dirs=&limit=`（dirs 逗号分隔，缺省全局）。
- [x] 全量测试：8 个用例全绿（本文件）；`npx tsc --noEmit` 通过。

## T2 前端：⌘P 空态最近更新

- [x] `web/src/lib/types.ts` 新增 `RecentFile`；`web/src/lib/api.ts` 新增 `recent()`。
- [x] `web/src/lib/utils.ts` 新增 `relativeTime()`、`topDirOf()`。
- [x] `command-palette.tsx`：打开即取最近更新；空 query 渲染 `Command.Group「最近更新 · 空间名」`（20 条，标题 + 相对时间 + 路径），非空保持原搜索分支。

## T3 前端：⌘O 看板切换器

- [x] 新增 `web/src/components/opened-switcher.tsx`：一级目录分列（列序 = tab 栏顺序）、列头计数、当前文档圆点标记。
- [x] 键盘：`←→` 换列且行号尽量保持（超出夹到末行）、`↑↓` 列内移动并夹边界、`Enter` 打开并关闭、`Esc` 关闭（Radix）。
- [x] 鼠标：点击打开、悬停把选中态移过去；选中项 `scrollIntoView` 保证列/项可见。
- [x] `ui/dialog.tsx` 新增可选 `overlayClassName`，两个面板统一毛玻璃。
- [x] `App.tsx` 注册 ⌘/Ctrl+O（preventDefault）并与 ⌘P 互斥。

## T4 验证

- [x] `web/ npm run build`（含前端 `tsc --noEmit`）通过。
- [x] 本机 dev 实例（:3001，索引库用真实库副本）实测 `/api/recent`：20 条 5.3KB / **3.9ms**；`limit=999` → 200 上限生效；未知目录 → `[]`。
- [x] Playwright + 本机 Chrome 功能断言 **36/36 通过**（含长列滚动 7 项、空态/无结果 5 项：19 个 tab 时面板高 565px < 视口、列内 `scrollHeight 520 > clientHeight 468`、↓↓ 到底后末项被滚到可见区、↑↑ 到顶夹住不跨列）：⌘P 空态标题/条数/顺序与接口一致、输入后回搜索、⌘O 分列与列序、选中落当前文档、`←→↑↓` 夹边界与行号保持、Enter 打开、Esc 关闭、⌘P/⌘O 互斥、无 console error。
- [x] 验证脚本落在 `/tmp/md-dev-verify/`（`verify_palette.py` / `verify_switcher_scroll.py` / `verify_empty_state.py`；一次性冒烟脚本，未入库以免引入前端测试框架依赖）。

## T5 文档

- [x] `specs/command-palette-nav/{spec,plan,tasks}.md`。
- [x] `README.md` 功能列表加命令面板一行；`specs/README.md` 现状补一条。
- [x] `.dsh/skills/code-map` 前端结构刷新（原「public/index.html 单文件」已过时）并登记 `/api/recent`。

## T6 交付 ✅

- [x] 提交并推送 `origin/main`：`feac444`（下载 md 原文件，上一次会话遗留需求）+ `8697634`（本次命令面板两功能）。
- [x] `docker compose up -d --build` 重建容器：启动 `index ready (incremental, 0 changed, 3382ms)`，`files=2483 / sets=4`。
- [x] 线上容器内实测：`/api/recent` 200 / 20 条 / 未知目录 `[]`；`web/dist/assets/index-Dj3D02CR.js` 与本地构建产物 **md5 一致**（`40615fc0…`），产物内含「最近更新 / 已打开的文档 / 切换目录 / 下载 Markdown 文件」。
- [ ] 用户在 https://md.zwalker.me 实际点击确认视觉效果（该站有登录网关，助手不代验证）。
