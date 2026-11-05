# tasks: 空间作用域

## 后端

- [x] `src/config.ts`：`normalizeScope` / `rootNameOf` / `inScope` / `scopesOverlap`；`deriveRoots` 按第一段派生；`validateSets` 允许子目录 + 重叠/非法段校验；`isEmbedEnabled` 支持注入 sets 并按前缀判定。
- [x] `src/glossary.ts`：`spaceDirsForPath` 与术语表候选文件改为 `inScope` 前缀匹配（候选缓存简化成 `urlPath[]`）。
- [x] `src/browse.ts`（新增）：`normalizeBrowsePath` / `resolveBrowseDir` / `listBrowseDirs`。
- [x] `src/index.ts`：`GET /api/browse`；`POST /api/sets` 校验条目在挂载根下真实存在。

## 前端

- [x] `lib/types.ts` / `lib/api.ts`：`BrowseEntry` / `BrowseResponse` 与 `api.browse()`。
- [x] `lib/utils.ts`：`scopeSegs` / `scopeLabel` / `inScope` / `scopeDirOf` / `scopeLabels`。
- [x] `sidebar/tree-view.tsx`：作用域条目 → 子树一级节点（显示名最后一段、title 完整路径、缺失占位）。
- [x] `sidebar/notes-panel.tsx`：按命中的作用域条目分组。
- [x] `sidebar/opened-panel.tsx`：同上（组头关闭仍按组）。
- [x] `sidebar/spaces-panel.tsx`：去掉手输，改「选择目录」按钮 + 客户端重叠校验 + 错误提示。
- [x] `sidebar/dir-picker.tsx`（新增）：面包屑 / 逐层进入 / 多选 / 仅含文档 / md 篇数 / 添加。

## 测试与验证

- [x] `src/config.test.ts`：子目录合法；`..`/`.`/空段/反斜杠/绝对路径被拒；同 set 重叠被拒、相等去重、跨 set 允许；root 只取第一段；`inScope`/`scopesOverlap`/`isEmbedEnabled`。
- [x] `src/browse.test.ts`（新增）：单层列举、跳过隐藏/构建产物目录、深度进入与 parent、mdCount 注入、非法路径/越界/软链逃逸。
- [x] `src/glossary.test.ts`：子目录作用域前缀命中、不串味。
- [x] 门禁：`npx tsc --noEmit`、`npm test`（157 全绿）、`cd web && npm run build`。
- [x] 本地实例走查（Chrome headless + CDP）：树节点/切 set/笔记分组/弹窗选目录/重叠提示/保存落盘/多子目录并列。
- [x] 文档：`specs/space-scope/`、`specs/README.md`、`README.md`、`AGENTS.md`。
