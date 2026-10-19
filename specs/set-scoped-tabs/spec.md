# set-scoped-tabs：已打开的文件跟随当前空间 set（含切回零延迟）

## 背景

md-server 的「空间 set」把多个文档目录组合成一个工作视图（`/set/{id}`）。
但前端「已打开的 tab」（`openDocs` / `activeDoc` / `activeQuery`）此前只有一份全局状态，
存在 localStorage 的单一键 `md-open-tabs` 里，**跨 set 共享**：

- 在 set A 打开的文档，切到 set B 后 tab 栏仍在、还在看 A 的文档 → 视图与 set 不一致。
- 用户期望：打开的文件跟着「当前 set」走。

## 目标

- 打开的文件按「当前空间 set」隔离：切走时该 set 的 tab 整体关闭；切回时该 set 的 tab 重新打开。
- 每个 set 各自记住上次打开的 tab（含当前激活文档 / 查询），刷新后仍生效。
- 切回**零延迟**：正文命中缓存，不再请求服务端，也不重新渲染 KaTeX/mermaid。

## 非目标

- 不做跨设备同步 / 服务端存储 tab（继续 localStorage，符合单机个人应用定位）。
- 不改后端 / 索引 / 其它 UI 状态持久化（侧栏展开、布局等保持现状）。

## 方案（要点）

- 存储由单一键改为按 set 分槽：`localStorage['md-open-tabs-by-set'] = { [setId]: {openDocs, activeDoc, activeQuery} }`。
- 切换 set（`switchSet` 与浏览器前进/后退 `popstate`）统一走 `applySet(id)`：
  先把当前 set 的 docs 落盘，再把目标 set 的槽位 hydrate 进 reducer（无记录 = 空 = 全部关闭）。
- 启动时 set 解析完成后再 hydrate 该 set 的 tab（初始 docs 置空，避免异步 resolve 前闪现错 set 内容）。
- 一次性迁移：首次升级若存在旧键 `md-open-tabs`，迁到「启动时解析出的当前 set」槽位后删除旧键。
- `renderCache`（正文 HTML）全局保留，切 set 不清空 → 切回不发请求。
- 正文 **DOM 缓存**（`web/src/components/doc-view.tsx`）：切走时把整块已渲染的正文节点收进
  `DocumentFragment`，切回时整块挪回，跳过 `innerHTML` 重注入与 KaTeX/mermaid 二次渲染；
  LRU 上限 12 篇；带 `<mark>` 高亮的正文（搜索命中）与查询词绑定，不入缓存。
- 正文容器常驻：`activeDoc` 为空时用 `hidden` 隐藏而不是卸载，保证切到「没有打开文档」的
  set 再切回时同一节点仍在，DOM 缓存可用。

## 验收标准（Given-When-Then）

1. 在 set A 打开 a1、a2 → `md-open-tabs-by-set.a.openDocs == [/seta/a1.md, /seta/a2.md]`。
2. 切到 set B → tab 栏清空、正文不再显示 A 的文档；`...a` 仍保留两个 doc。
3. 在 set B 打开 b1 → `...b.openDocs == [/setb/b1.md]`。
4. 切回 set A → a1、a2 重新打开，正文恢复。
5. 刷新页面 → URL 仍为 `/set/a`，a 的两个 tab 仍在。
6. 升级场景：仅有旧键 `md-open-tabs` 时 → 迁移入当前 set，旧键删除。
7. 零延迟：打开含 mermaid/KaTeX 的文档 → 切到空 set 再切回 →
   mermaid SVG 为同一 DOM 节点（未重画），且无新增 `/api/render` 请求。
8. 零延迟：同 set 内切 tab 再切回同样复用节点；插入笔记走局部替换，图表不重渲染。

## 影响面 / 回滚

- 前端两个文件：`web/src/state/store.tsx`（按 set 分槽 + 迁移）、
  `web/src/components/doc-view.tsx`（正文 DOM 缓存 + 容器常驻）；不涉及后端 / API / MCP 签名。
- 行为变化：tab 不再跨 set 共享（即需求本身）；正文容器改为常驻隐藏。
- 回滚：恢复单键实现 / 去掉 DOM 缓存即可；已写入的分槽键无害（不会被旧版本读取）。

## 验证记录

本地 :3010 起服务（fixture 两个 set，含 mermaid + KaTeX 文档），Playwright（系统 Chrome）端到端：

- set 隔离 16 项、旧键迁移 3 项、DOM 复用 8 项、笔记插入回归 5 项，全部 PASS，无 JS 运行时错误。
- 关键证据：切回后 mermaid `<svg>` 上的自定义标记仍在（同一节点）、`/api/render` 请求计数不增。
