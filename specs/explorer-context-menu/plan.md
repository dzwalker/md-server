# plan: 资源管理器文件树右键菜单（复制文件名 / 复制完整路径 / 下载）

## 技术方案

### 1) 新增 `web/src/components/ui/context-menu.tsx`

- 按项目既有 shadcn/ui 约定，封装依赖里**已有**的 `radix-ui` 包（`radix-ui` 1.6.7，含 `ContextMenu`），不新增依赖。
- 只导出用到的 5 个：`ContextMenu` / `ContextMenuTrigger` / `ContextMenuContent` / `ContextMenuItem` / `ContextMenuSeparator`。
- 样式与 [dropdown-menu.tsx](../../web/src/components/ui/dropdown-menu.tsx) 逐字对齐（`bg-popover` + `shadow-md` + `ring-foreground/10` + `data-open:` 动画变体）。

### 2) `web/src/components/sidebar/tree-view.tsx`

- `TreeNodeRow` 原本整行就是一个 `div`（react-arborist 通过 `style` 给绝对定位与缩进）。改成：

  ```
  <div style={style} className="text-sm">        // 外层保留 arborist 的 style
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-full w-full items-center gap-1 pr-2">…原内容…</div>
      </ContextMenuTrigger>
      <ContextMenuContent>…按节点类型给项…</ContextMenuContent>
    </ContextMenu>
  </div>
  ```

  外层不换成 Trigger，避免动 arborist 依赖的行元素（它靠行元素测量/定位）。
- 菜单项由节点类型决定：`file` → 3 项；`dir` → 仅「复制完整路径」；`tool` 或 `path.startsWith('/__tools__')` → 直接渲染裸行，不套 ContextMenu。
- 「复制文件名」用 `d.name`（`buildTree` 里文件名节点 `name = segs[i]`，即真实文件名含扩展名）；「复制完整路径」用 `d.path`（urlPath）——与树、URL、收藏、搜索一致，**零后端改动**（不需要 `fsPath`/`baseDir` 映射）。
- 轻提示：`ToastContext`（module 内 `createContext`）把 `showToast` 下发给每个行组件，由 `TreeView` 顶层渲染一个 `fixed bottom-6` 的提示条。**不能把提示放进菜单里**——Radix 选中后会立刻卸载菜单内容。

### 3) 新增 `web/src/lib/clipboard.ts`

- `copyText(text)`：安全上下文（https / localhost）走 `navigator.clipboard.writeText`；否则/失败时降级到隐藏 `textarea` + `document.execCommand('copy')`（局域网 IP 以 http 打开的场景）。
- 返回 `boolean`，调用方据此提示「已复制」还是「复制失败，请手动复制」。

### 4) `web/src/lib/download.ts` 抽出 `downloadDocByPath(path)`

- 把 `doc-view.tsx` 里「`api.rawFile` → `downloadBlob`」的逻辑提成公共函数；`doc-view.tsx#onDownload` 改为调用它（行为不变），右键「下载」复用同一函数，避免两处重复。

### 5) 文档

- 新增本 spec 三件套；`specs/README.md` 现状列表、`.dsh/skills/code-map` 前端结构表同步。

## 影响面

- **前端**：新增 2 个文件 + 改 3 个文件；左键行为、树展开持久化、⌘P/⌘O 均未触碰。
- **后端 / API**：零改动（复制与下载都走既有 `/api/files/*`）。
- **依赖**：零新增（`radix-ui`、`lucide-react` 已在依赖里）。
- **数据**：只读，不写 `/data` 下任何 md 文件或索引。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| `ContextMenuTrigger asChild` 嵌进虚拟列表行导致布局/定位异常 | 外层 row div 原样保留，只包内层内容；实测缩进、行高 28px、选中态 `bg-accent` 均正常 |
| 剪贴板 API 在非安全上下文不可用 | `copyText` 内置 `execCommand` 降级，失败时给「复制失败，请手动复制」提示 |
| 右键菜单与「工具」虚拟节点冲突 | `/__tools__` 前缀节点不套菜单（其 path 复制出去无意义） |
| 下载逻辑抽取后文档头下载回归 | 同一函数、同一接口；冒烟用例覆盖下载文件名与内容 |
| 回滚 | 纯前端新增 + 一处等价重构，回退本 spec 涉及文件即可，无数据迁移 |

## 验证方式

1. `npx tsc --noEmit`（后端）+ `cd web && npm run build`（前端 tsc + vite 构建）+ `npm test`（22/22）。
2. 临时 dev 实例（`:3099`，`MD_BASE_DIR` 指向 3 个 md 的 fixture 目录 + 独立 `MD_INDEX_DB`），Playwright + 本机 Chromium 做 **DOM 断言**（不截图）：13/13 通过——文件 3 项/顺序、文件夹仅 1 项、虚拟节点无菜单、复制内容、下载文件名与原文、菜单自动关闭、轻提示出现、无 console error。
3. 视觉/手感最终由用户在浏览器确认（依用户偏好，不以截图代替人工确认）。
