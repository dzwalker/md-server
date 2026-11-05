# spec: 侧栏「已打开的文档」——按目录整组关闭 + 单篇悬浮关闭

## 背景

侧栏「已打开的文档」按 `路径第一段`（= 空间里的一级目录）分组列出所有已打开文档。之前只有「点标题激活」一个动作：

- 一段调研结束、某个目录下的 5～8 篇文档全看完，只能到顶部 tab 栏一个个点 ×；
- 每行右侧没有关闭入口，鼠标移动到行上也没有任何可操作提示。

## 目标

1. **组头关闭**：分组头（一级目录名）右侧常显一个图标按钮（×），点击关闭**该目录下所有已打开文档**。
2. **单篇关闭**：每篇文档行右侧一个图标按钮（×），**悬浮该行时出现**（与 tab 栏的关闭按钮同一交互习惯），点击只关这一篇。
3. 关掉当前正在看的文档时，自动接任：优先它**左边最近**还开着的一篇，否则**右边第一篇**；全关光则回到空态（与单篇关闭原有规则一致）。
4. 正在编辑（有未保存草稿）的文档被关掉时，仍然先弹确认（沿用 `confirmLeaveEdit`），取消则不关。
5. 关闭结果与 tab 栏、`localStorage`（`md-open-tabs-by-set`，按空间 set 分槽）保持一致。

## 非目标

- 不改 `⌘O` 已打开文档看板（`opened-switcher.tsx`）与 tab 栏本身的交互。
- 不新增「关闭其他 / 关闭右侧」这类菜单（需要时再单独做）。
- 不移动/重排分组逻辑（分组键仍是路径第一段）。

## 设计

- `web/src/state/store.tsx`：`docsReducer` 抽出 `removeDocs(state, drop)`，`close` / 新增的 `closeMany` 共用同一套「谁来接任当前文档」规则；
  对外新增 `closeDocs(paths: string[])`，并把 `closeDoc(path)` 收敛成 `closeDocs([path])`（未保存确认只走一条路径）。
  `close` 顺带修掉 `activeQuery` 判断里「拿改过的 activeDoc 去比」的失效条件：当前文档被关掉就清空搜索高亮。
- `web/src/components/sidebar/opened-panel.tsx`：分组头右侧常显 × 按钮（`aria-label` 带目录名与篇数）；文档行改成「标题按钮 + 悬浮 × 按钮」
  的行结构（避免 button 嵌套 button），× 用 `opacity-0 group-hover:opacity-100`，键盘 `focus-visible` 也可见。

## 验收标准（Given-When-Then）

- [x] Given `lark-archive` 下已打开 2 篇文档，Then 分组头右侧有 × 按钮，`title`/`aria-label` 写明「关闭「lark-archive」下全部 2 篇文档」。
- [x] Given 鼠标不在某文档行上，Then 该行 × 的 `opacity` 为 0（不干扰阅读）；悬浮该行后变为 1。
- [x] Given 正在看 README（同组还有 AGENTS），When 点 README 行的 ×，Then 只剩 AGENTS，且 AGENTS 成为当前文档，tab 栏同步只剩一个。
- [x] Given `lark-archive` 下已打开 1 篇，When 点分组头的 ×，Then 该组清空、侧栏显示「暂无打开的文档」、`md-open-tabs-by-set` 里该 set 的 `openDocs` 为空。
- [x] Given 正在编辑某篇且未保存，When 关闭它（单个或整组），Then 先弹确认，取消则不关。
- [x] 门禁：`cd web && npm run build`（含 `tsc --noEmit`）通过；根目录 `npx tsc --noEmit`、`npm test` 通过。
- [x] 浏览器验证：本地托管 `web/dist` + 代理真实 API，用无头 Chrome 实测（见交付记录）。

## 交付记录

- 改动：`web/src/state/store.tsx`（`removeDocs` + `closeMany` + `closeDocs`）、`web/src/components/sidebar/opened-panel.tsx`（组头 × + 行内悬浮 ×）。
- 实测（无头 Chrome，真实数据 `/lark-archive/AGENTS.md`、`/lark-archive/README.md`）：
  - 组头 × 可见，文案带篇数；行内 × 悬浮前 `opacity:0`、悬浮后 `1`；
  - 单篇关闭 README 后：`openDocs=['/lark-archive/AGENTS.md']`、`activeDoc` 回落到 AGENTS、tab 栏剩 1 个；
  - 组头 × 后：`openDocs=[]`、`activeDoc=null`、显示「暂无打开的文档」，`md-open-tabs-by-set` 落盘一致。
