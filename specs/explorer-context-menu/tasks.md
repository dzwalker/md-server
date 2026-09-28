# tasks: 资源管理器文件树右键菜单（2026-09-22）

## T1 基础件

- [x] 新增 `web/src/components/ui/context-menu.tsx`：封装 `radix-ui` 的 ContextMenu（Root/Trigger/Content/Item/Separator），样式与 `dropdown-menu.tsx` 对齐。
- [x] 新增 `web/src/lib/clipboard.ts`：`copyText()` 优先 Clipboard API，非安全上下文降级 `execCommand`。
- [x] `web/src/lib/download.ts` 抽出 `downloadDocByPath(path)`；`web/src/components/doc-view.tsx#onDownload` 改调它（行为不变）。

## T2 右键菜单

- [x] `web/src/components/sidebar/tree-view.tsx`：`TreeNodeRow` 外层保留 arborist 的 `style`，内层用 `ContextMenuTrigger asChild` 包住原行内容。
- [x] 文件节点：`复制文件名` / `复制完整路径` / `下载`（顺序固定）；文件夹节点：仅 `复制完整路径`。
- [x] `/__tools__` 前缀的虚拟节点（工具 / 图谱）不套菜单。
- [x] 「复制文件名」= `d.name`（真实文件名含 `.md`）；「复制完整路径」= `d.path`（urlPath）。
- [x] `ToastContext` 下发轻提示，`TreeView` 顶层渲染 1.8s 自动消失的提示条；下载失败 `console.warn` + 提示。

## T3 文档

- [x] 新增 `specs/explorer-context-menu/{spec,plan,tasks}.md`。
- [x] 更新 `specs/README.md` 现状列表。
- [x] 更新 `.dsh/skills/code-map/SKILL.md` 前端结构表（右键菜单 + 剪贴板/下载公共库）。

## T4 验证

- [x] `npx tsc --noEmit` 通过；`npm test` 22/22 全绿；`cd web && npm run build` 通过（web 侧 tsc 一并过）。
- [x] 临时 dev 实例（`:3099`，fixture：`spaceA/{note-a.md,sub/inner.md}` + `spaceB/other.md`，独立索引库 `/tmp/md-ctx-verify/index.db`）。
- [x] Playwright + 本机 Chromium **DOM 断言 13/13 通过**（不截图）：文件 3 项与顺序、复制文件名 `note-a.md`、复制完整路径 `/spaceA/note-a.md`、下载文件名与磁盘原文一致、文件夹仅「复制完整路径」且得 `/spaceB`、嵌套文件得 `/spaceA/sub/inner.md`、虚拟工具节点无菜单、菜单选中后自动关闭、轻提示出现、无 console error / pageerror。
- [x] 验证脚本落 `/tmp/md-ctx-verify/verify.py`（一次性冒烟脚本，未入库以免引入前端测试框架依赖）。
- [x] 用户确认后上线（2026-09-22）：`docker compose up -d --build` 重建并重启容器，镜像 `sha256:3e852b0c…`；容器内 `healthz` = ok / 7 roots / 2483 files，线上 bundle 切到 `assets/index-BKr1oOhj.js`（含「复制文件名」「复制完整路径」），MCP :3002 与 HTTP :3001 均正常监听。
- [ ] 用户浏览器确认视觉与手感（https://md.zwalker.me，需刷新拿新 bundle）。
