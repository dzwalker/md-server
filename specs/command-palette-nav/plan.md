# plan: 命令面板空态「最近更新」+ ⌘O 已打开文档看板

## 技术方案

### 1) 后端：新增 `GET /api/recent`（`src/index-db.ts` / `src/index.ts`）

```ts
listRecentFiles({ dirs?: string[]; limit?: number })
// SELECT path,title,name,dir,mtime_ms FROM files
//   [WHERE path LIKE '/dirA/%' OR path LIKE '/dirB/%']
//   ORDER BY mtime_ms DESC LIMIT ?
```

- 走 SQLite 索引已有列 `files.mtime_ms`，**一条 SQL 出结果**，不扫盘、不读正文。
- `dirs` 语义 = 空间（set）的目录名列表，按 urlPath 前缀过滤；不传即全局。
- `limit` 在函数内夹到 1–200（默认 20），路由层 `Number(limit) || 20`。
- 路由：`GET /api/recent?dirs=a,b&limit=20` → `{path,title,name,dir,mtimeMs}[]`。

> 为什么不复用 `/api/files`（全量元信息 869KB）让前端排序：树已经 431KB，为排序再拉一次全量不划算；单条 SQL 查询 3.9ms / 5.3KB，且「空间内最近」的口径放在服务端更准。

### 2) 前端：⌘P 空态（`web/src/components/command-palette.tsx`）

- 面板打开即请求 `api.recent({ dirs: activeDirs, limit: 20 })`（用 `dirsKey = activeDirs.join(',')` 作稳定依赖，避免 store 里数组引用变化导致重复请求）。
- `q` 为空 → 渲染 `Command.Group heading="最近更新 · {空间名}"`，列表项为「标题 + 相对时间 / 路径」；`q` 非空 → 维持原有搜索分支不变。
- 新增 `lib/api.ts#recent`、`lib/types.ts#RecentFile`、`lib/utils.ts#relativeTime`（可注入 now，便于测试）。

### 3) 前端：新增 ⌘O 看板（`web/src/components/opened-switcher.tsx`）

- 数据：store 的 `openDocs`（已持久化到 localStorage 的 tab 列表）；**一列 = 一个一级目录**（`topDirOf(path)`），`Map` 插入顺序天然等于 tab 栏顺序；工具页 `/__tools__/…` 归到「工具」列。
- 状态：`sel = {col, row}`；打开时定位到当前文档（便于「我在哪」），之后由键盘/鼠标掌控。
- 键盘（window keydown，打开期间注册、关闭即移除）：
  - `←/→`：换列，`row = min(当前 row, 目标列长度-1)` —— 即「上下位置尽量保持」；
  - `↑/↓`：列内移动，边界夹住不跨列；
  - `Enter`：激活选中项并关闭。
- 视觉：沿用 Dialog + `overlayClassName`（新增可选 prop）统一毛玻璃（遮罩 `backdrop-blur-sm`，面板 `bg-popover/75 backdrop-blur-2xl`），与 ⌘P 一致；选中态 `bg-accent`，「当前正在看的文档」额外加圆点 + 字重。
- 可测性：列/项带 `data-column` / `data-doc-path` / `data-selected` / `data-current`（`data-active` 已被 tab 栏占用，故改名，避免选择器撞车）。

### 4) 快捷键（`web/src/App.tsx`）

- `⌘/Ctrl+O` → `preventDefault()` 后开关看板，并关闭 ⌘P（互斥）；`⌘/Ctrl+P` 反之。浏览器默认的「打开本地文件」对话框被 preventDefault 拦下。

## 影响面

- **API**：新增只读接口，不改既有契约；`/api/recent` 只读索引库，不触碰 `/data` 下 md 文件。
- **前端**：新增 1 个组件 + 1 个可选 prop；⌘P 的搜索分支与打开逻辑未改；不影响既有 Dialog（目前仅命令面板使用）。
- **依赖**：无新增依赖。
- **文档**：`README.md` 功能列表、`specs/README.md` 现状、`.dsh/skills/code-map` 前端结构与本接口同步。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 浏览器抢占 ⌘O（打开本地文件） | 页面 `preventDefault` 生效（本机 Chrome 实测：面板正常弹出，无文件对话框）；即便某浏览器抢走，只是该快捷键失效，功能不受损，可改用其他键位 |
| `mtime_ms` 语义是「文件系统修改时间」 | 与「最近更新」语义一致；若将来要按「打开时间」排序，另开字段（非目标） |
| 看板列多时横向溢出 | 列容器 `overflow-x-auto`，选中项 `scrollIntoView({inline:'nearest'})` 保证当前列可见 |
| 单列 tab 很多时撑破面板 | 列内列表自身 `max-h-[52vh] overflow-y-auto`（实测 19 tab：scrollHeight 520 / clientHeight 468，面板高 565px） |
| 回滚 | 纯新增 + 一处快捷键：回退本 spec 涉及文件即可，无数据迁移 |

## 验证方式

1. 后端：`npx tsc --noEmit` + `npm test`（新增 `listRecentFiles` 用例，RED → GREEN）。
2. 前端：`web/ npm run build`。
3. 端到端：本机 dev 实例（`MD_INDEX_DB=/tmp/…` 用真实索引副本）起在 :3001，Playwright 驱动真实浏览器断言 24 项（含键盘导航、互斥、无 console error），不使用截图。
