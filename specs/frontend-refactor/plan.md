# plan: 前端重构

## 技术方案

- **前端工程**：新增 `web/` 目录（Vite + React 18 + TS + Tailwind + shadcn/ui），独立 `package.json`，构建输出 `web/dist/`。
- **目录结构**：`web/src/{components, features, lib, hooks}`。
- **数据层**：复用现有 `/api/*`，封装一个类型化 fetch 客户端；首版不引 React Query，用轻量 hooks + 缓存。
- **布局**：`react-resizable-panels` 三栏（活动栏固定 48px / 侧栏可拖 220–420px / 主区 / TOC 可拖 200–340px）。
- **移动端**：Tailwind 断点 + Radix `Sheet`/`Dialog`；<768px 侧栏收起为抽屉、TOC 变浮动、命令面板全屏。
- **树**：`react-arborist`（虚拟化、键盘可达）；**Tabs**：Radix Tabs + `@dnd-kit/core`；**命令面板**：`cmdk`；**图标**：`lucide-react`。
- **主题**：shadcn CSS 变量（light/dark），沿用 `prefers-color-scheme` + 手动切换按钮。
- **Markdown**：保留服务端 HTML，组件用 `dangerouslySetInnerHTML` + `useEffect` 跑 katex/mermaid（沿用现有 `renderExtras` 逻辑）。
- **图谱**：现有 canvas 逻辑封成 `<GraphView />`，算法不改。

## 后端改动（最小）

- `src/index.ts`：新增 `web/dist` 静态托管 + SPA fallback 指向新 `index.html`（`/media/*` 仍从 `public` 托管）。
- `Dockerfile`：多阶段构建（build 阶段 `cd web && npm run build`，运行阶段只带后端依赖 + `dist/`）。
- API 契约不变。

## 影响面 / 风险

- 新增 `web/` 及前端依赖；后端仅静态托管 + Dockerfile。
- 风险：Tailwind/shadcn 版本差异、react-arborist 与现有树交互对齐、移动端回归、构建产物路径。
- 回滚：保留 `public/index.html` 作为回退（git 历史可切回），新前端在 `web/` 独立演进。

## 分阶段

1. 工程底座 + 布局壳（resizable + 移动端抽屉 + 主题）
2. 侧栏各面板（树 / 搜索 / 标签 / 收藏 / 空间）
3. 主区（Tabs dnd + 文档头 + 内容渲染 + TOC）
4. 命令面板 + 图谱
5. 后端托管 dist/ + Dockerfile + 测试 + 部署 + 移动端回归
