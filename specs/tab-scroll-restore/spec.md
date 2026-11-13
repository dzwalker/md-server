# tab-scroll-restore：切 tab / 刷新后保留每篇文档的阅读位置

## 背景

正文滚动容器（`doc-view.tsx` 的 `contentAreaRef`）是**所有文档共用的一个**，切 tab 时只替换
里面的 HTML，scrollTop 却沿用了上一篇文档的位置（或被新文档的高度截断到 0）：

- 长文档读到中间 → 切去别篇 → 切回来，位置丢了（停在别篇的位置或顶部）。
- 刷新页面同理：tab 能恢复（`specs/set-scoped-tabs/`），但都回到顶部。
- 进出编辑态也会丢（阅读区被 `hidden` 隐藏时浏览器把 scrollTop 归零）。

## 目标

- 每篇文档的阅读位置跟着「已打开文档」一起持久化，切 tab / 刷新 / 切空间 set 回来都能接上。
- 恢复的是**视觉位置**（同一段内容停在视口同一处），不是裸像素；长文档不许偏。

## 非目标

- 不做跨设备 / 服务端同步（继续 localStorage，单机个人应用定位）。
- 不记 `/__tools__/`（图谱等工具 tab）的位置。
- 不改后端 / API / 索引；不改 tab 本身的持久化结构（`md-open-tabs-by-set`）。

## 方案（要点）

- 新模块 `web/src/lib/scroll-positions.ts`：
  - 存储键 `localStorage['md-scroll-pos-by-set']`，与 `md-open-tabs-by-set` **同构、同槽位**：
    `{ [setId]: { [docPath]: { top, line?, offset? } } }`。单独一个键是为了不和对面的写路径
    互相覆盖（那边是 docs 状态变就整槽重写，这边是滚动过程中高频写）。
  - 值 = `scrollTop` 兜底 + 「视口内第一个块的行号（`data-line-start`）与其相对容器顶部的
    偏移」精确锚点。只存像素不行：正文块开着 `content-visibility: auto`，重新注入后屏外块的
    估值高度会让同一段内容的像素位置漂（见 `web/src/lib/scroll-anchor.ts`）。
  - 写入 300ms 去抖（滚动监听另有 200ms 节流），`pagehide` / 切后台时强制 flush；
    每 set LRU 上限 300 篇。
  - `settleScrollPos()`：恢复时**逐帧重钉同一条锚点到稳定**（连续两帧 scrollTop 变化 ≤1px，
    上限 45 帧）。刚注入的屏外块还是估值高度，单次定位实测长文档会偏几百 px；
    用户开始滚动（wheel / touchstart / pointerdown / keydown）或切了文档就收手。
- `web/src/components/doc-view.tsx`：
  - 正文注入 effect 里区分「换了一篇」和「同一篇整篇重注入」：
    - 换篇：替换 DOM **之前**把上一篇的位置读下来（此时正文还是旧文档的，读得准）；
      被关掉（不在 `openDocs`）、正在编辑（阅读区隐藏）、工具 tab 的不记。
    - 同篇重注入（保存笔记 / 外部改动）：仍走原来的 `scroll-anchor` 单帧补偿，行为不变。
  - 新注入的文档第一次有正文内容时恢复它的位置；带锚点打开（双链 / ⌘P / 笔记跳转，
    `scrollTarget` 命中当前文档）时不恢复，位置交给锚点滚动。
  - 滚动时 200ms 节流记录当前位置；`pagehide` / `visibilitychange=hidden` 立即落盘。
  - 进出编辑态：进编辑时让在跑的位置校准作废；退出编辑后恢复该篇位置。
- `web/src/state/store.tsx`：关闭 tab 时 `forgetScrollPos`（关掉再打开 = 从头读）；
  改名时 `migrateScrollPos`（位置跟着新路径走）。

## 验收标准（Given-When-Then）

1. doca 滚到中部（视口首块 = 第 85 块）→ 打开 docb → 点 doca tab →
   视口首块仍为第 85 块、偏移差 ≤ 1px。
2. 同上，刷新页面 → 同一位置（不回到顶部、也不偏几屏）。
3. `localStorage['md-scroll-pos-by-set'][<setId>]['/alpha/doca.md']` 存在且含 `line` / `offset`。
4. 切到 set B 再切回 set A → A 的文档与位置都恢复；两个 set 的槽位互不干扰。
5. 关闭 doca 的 tab 再打开 → 从顶部开始（旧位置已丢弃）。
6. 滚到中部 → 进编辑态 → 结束编辑 → 回到进编辑前的位置。
7. 保存笔记这类「同一篇整篇重注入」不发生位置漂移（原 `scroll-anchor` 行为不变）。

## 影响面 / 回滚

- 前端 3 个文件：新增 `web/src/lib/scroll-positions.ts`；改 `web/src/components/doc-view.tsx`、
  `web/src/state/store.tsx`。不涉及后端 / API / MCP 签名。
- 行为变化：切 tab / 刷新不再回到顶部；关 tab 会丢弃该篇位置；切篇不再把上一篇的锚点
  误套到新正文上（原来是单帧 anchor 会这么做）。
- 回滚：删掉 `md-scroll-pos-by-set` 读写与调用点即可，多余的 localStorage 键无害。

## 验证记录

本地隔离实例（`MD_PORT=3013`、fixture `/tmp/md-fix`、`MD_INDEX_DB=/tmp/md-scroll-index.db`，
不碰 `/data` 生产数据），Playwright + 系统 Chrome，长文档每篇 120 节 / 362 个块：

- 打开在顶部 / 滚到 3000 / 切 docb / 切回 doca（首块 85 号、偏移 -42）/ localStorage 分槽
  与锚点字段 / 刷新后同位置 / 关 tab 再开回顶部 / 退出编辑回到 4000 —— 10/10 PASS。
- 切空间集：set A 滚到首块 103 号 → popstate 切 set B → 切回 set A，首块 103 号、偏移差 1px；
  `a` 槽位里只有 `/alpha/doca.md`（无 B 的内容），槽位隔离 PASS。无 JS 运行时错误。
