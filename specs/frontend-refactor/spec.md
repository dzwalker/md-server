# spec: 前端重构（React + shadcn/ui + 可调宽布局 + 移动端）

## 背景

当前前端是 `public/index.html` 单文件 933 行（原生 JS + 内联 CSS，无构建步骤）。功能可用，但：手写组件难维护、无成熟组件库、布局固定不可调宽、移动端只有一处粗略 `@media`。

## 目标

在「功能与信息架构不变、后端 API 契约不变」前提下，用 React 18 + Vite + shadcn/ui 重写前端：

- 布局采用组件库方式：桌面三栏可拖拽调宽（活动栏 / 侧栏 / 主区 / TOC），宽度本地持久化。
- 移动端：侧栏折叠为抽屉（Sheet），TOC 变浮动面板，命令面板全屏，按断点自动切换。
- 用成熟组件替换：树（react-arborist）、Tabs（Radix + dnd-kit）、命令面板（cmdk）、标签/收藏/空间表单、图标（lucide）。
- Markdown 渲染保留服务端（`/api/render` 返回 HTML），客户端继续二次渲染 katex/mermaid。
- 图谱保留现有 force-directed canvas，封装为 React 组件（算法不变）。

## 非目标

- 不改后端 API、检索/渲染逻辑（仅新增静态托管 `dist/` 与 SPA fallback）。
- 不改业务功能与数据模型。
- 不迁移到客户端 markdown 渲染。
- 不引入服务端状态库（首版用轻量 hooks，不引 React Query）。

## 验收标准（DoD）

- [x] 桌面三栏可拖拽调宽并持久化（localStorage）。
- [ ] 移动端（<768px）侧栏抽屉 ✅ / TOC 浮动待补 / 命令面板（Dialog 响应式）。
- [x] 现有功能全部可用：树、搜索（全文+语义）、标签、收藏、空间管理、Tabs 拖拽排序、命令面板 Cmd+P、TOC scroll-spy、图谱。
- [x] 视觉与交互对齐 Notion/Linear 风格，明/暗主题。
- [x] 后端 `npx tsc --noEmit` 通过；前端 `npm run build` 通过；后端 `npm test` 通过（前端组件测试待补）。
- [x] Docker 构建产物托管 `dist/`（后端静态托管已本地验证；Dockerfile 多阶段就绪，未实测 `docker build`）。
