# spec: 命令面板空态「最近更新」+ ⌘O 已打开文档看板

## 背景

- ⌘P 命令面板打开后若没有输入，面板是**一片空白**（上一个提交还刻意移除了「输入关键词搜索」提示）。用户想「一眼看到最近在改什么」时，必须先想起一个关键词。
- 在多个文档之间来回切，只能靠 tab 栏横向找，或侧栏「已打开的文档」的线性列表；文档一多就难以按「哪个目录」定位。

## 目标

1. **⌘P 空态**：面板打开且未输入时，直接显示**当前空间内最近更新的 20 篇文档**（按修改时间倒序），输入后回到原有搜索。
2. **⌘O / Ctrl+O（新增）**：与 ⌘P 同款毛玻璃弹层，把**已打开的文档按一级空间目录分列**做成看板；`←→` 切到相邻目录（上下位置尽量保持）、`↑↓` 列内选择、`Enter` 打开、`Esc` 关闭。

## 非目标

- 不改 ⌘P **输入后**的搜索范围与排序（仍是全库搜索，不按空间过滤）。
- 不做移动端专门布局（沿用现有 Dialog 响应式）。
- 不改 tab 栏的打开/关闭/拖拽排序行为；⌘O 只是「另一种切换入口」。
- 不新增收藏、关闭 tab、重命名等看板内操作。

## 验收标准（Given-When-Then）

**A. ⌘P 空态最近更新**

- [x] Given 当前空间为 `learning`（dirs = learning-ad, neolix-mgmt），When 打开 ⌘P 且不输入，Then 显示分组标题「最近更新 · learning」与 **20** 条结果。
- [x] Given 同一时刻，When 对比 `/api/recent?dirs=learning-ad,neolix-mgmt&limit=20`，Then UI 列表**顺序与内容完全一致**（含路径与「N 分钟前」新鲜度）。
- [x] Given 空态，When 输入关键字，Then 分组标题消失、回到原搜索结果列表（不受影响）。
- [x] Given 空间含少量文档（如 `lark-archive`），When 请求 `limit=999`，Then 最多返回 200 条；`limit=0` 时回落默认 20。

**B. ⌘O 已打开文档看板**

- [x] Given 打开 5 篇文档（learning-ad 3 篇、neolix-mgmt 2 篇，tab 顺序交错），When 按 ⌘O，Then 出现 2 列、列序与 tab 栏首次出现顺序一致（learning-ad → neolix-mgmt），列内条数为 3 / 2。
- [x] Given 看板打开，When 打开前正在看 `/neolix-mgmt/ad/README.md`，Then 选中态落在该文档（「当前文档」用圆点独立标记，与键盘选中态区分）。
- [x] Given 选中在第 1 列第 2 行，When 按 `←`/`→` 换列，Then 换到相邻列且**行号保持不变**；目标列更短时夹到该列末行。
- [x] Given 选中在列首/列尾，When 继续按 `↑`/`↓`，Then 夹住不越界、不跨列。
- [x] Given 选中某文档，When 按 `Enter`，Then 该文档成为当前 tab、面板关闭；When 按 `Esc`，Then 面板关闭且当前文档不变。
- [x] Given ⌘P 已打开，When 按 ⌘O，Then ⌘P 关闭（两者互斥）。
- [x] Given 全程操作，Then 浏览器无 console error / pageerror。

**B2. ⌘O 视觉缺陷修正（2026-09-22 用户上线后反馈）**

- [x] Given 打开 ⌘O，When 读 `document.activeElement`，Then 焦点在弹层内的**面板容器**上（`tabindex=-1`），而不是列表第一项；列表项无任何可见焦点框（`outline` 全为 none）。修复前：Radix 自动聚焦第一项，`outline auto 1px` 灰框**永远停在第一项**（方向键只改状态、不搬 DOM 焦点）。
- [x] Given 选中某项，Then 选中底色为**实心主色**（浅色 `oklch(0.205)` / 深色 `oklch(0.922)`），与列底真实合成亮度差 ΔL 0.96 / 0.77，文字对比度 17.2:1 / 14.2:1。修复前：`bg-accent` = `oklch(0.97 0 0)` 叠在同为近白的列底上，ΔL 仅约 0.018（等于看不见）。
- [x] Given ⌘P 打开（空态最近更新 / 搜索结果两个分支），Then 选中项同样是实心主色，标题对比度 17.2:1（浅）/14.2:1（深）、路径副标题按 70% alpha 合成后 8.8:1（浅）/6.0:1（深）；输入框仍保持焦点不被抢。

- [x] Given 看板打开，When 切换列，Then 「当前列」用**底色**区分（浅色 `#e7e7e7` vs `#fbfbfb`；深色 `#292929` vs `#1b1b1b`）且跟着 ←→ 移动，不再用 1px 深色 ring（视觉上像一条多余边框）。

**C. 工程门禁**

- [x] 后端 `npx tsc --noEmit`、`npm test`（22 个用例）全绿；新增 `listRecentFiles` 用例（RED → GREEN）。
- [x] 前端 `web/ npm run build`（含 `tsc --noEmit`）通过。
- [x] 实机验证：真实浏览器（Playwright + 本机 Chrome）驱动本机 dev 实例，**36/36 项断言通过**（24 项交互 + 7 项长列滚动/视口 + 5 项空态/无结果），无截图（本模型无读图能力，视觉效果由用户直接确认）。
- [x] Given 打开的文档很多（19 个 tab 挤在一列），When 打开 ⌘O 并用 ↓ 走到末项，Then 列内自行滚动、面板不超视口、末项被滚到可见区。

## 实测数据（2026-09-22，本机 dev 实例）

| 项 | 结果 |
|---|---|
| `GET /api/recent?dirs=neolix-mgmt&limit=20` | 5.3KB / **3.9ms** |
| 索引规模 | 2483 篇文档 |
| `limit=999`（lark-archive） | 183 条（未超 200 上限） |
| 浏览器断言 | 36/36 通过（交互 24 + 长列滚动/视口 7 + 空态 5） |
