# spec: 空间作用域（目录可选任意层子目录 + 目录选择弹窗）

## 背景

- 「空间 set」原本只允许填**一级目录名**（`sets.json` 里 `dirs: ["notion-archive"]`）：`validateSets` 明确拒绝含 `/` 的条目，报错「只能是根目录下的单个文件夹名」。
- 实际使用里这不够：`notion-archive` 下有「学习成长 / 工作相关 / 爱好 / 个人信息」几块互不相关的内容，希望各自放进不同空间（侧栏只看到那一块），而 `notion-archive` 整棵又没必要同时出现。
- 这条限制不是随手加的：全站有多处把「路径第一段 = 空间」当作不变量（`resolveUrlPath`、`/api/asset/*`、`isEmbedEnabled`、`spaceDirsForPath`、`ROOTS` 派生）。放开限制如果只是让 `dir` 变成多段、继续按第一段找 root，就会出现：树整块空白（`tree-view` 按 `dirs` 过滤顶层节点）、embed 开关静默失效、术语表作用域错位。
- 另外入口是自由输入框，容易写错（拼错目录名、多打一个 `/`）。

## 目标

1. **空间 set 的目录条目（下称「作用域」）支持任意深度**：`notion-archive/学习成长`、`notion-archive/工作相关` 都能作为独立条目放进不同 set。
2. **物理 root 仍只按第一段派生**：`notion-archive/学习成长` → root `/notion-archive → <MD_BASE_DIR>/notion-archive`。文档的 `urlPath` 因此与磁盘路径一致（`/notion-archive/学习成长/a.md`），图片相对链接、收藏、双链、编辑保存的 mtime 锁、索引行全部零变化。
3. **侧栏树把每个作用域条目渲染成一级节点**：名字取最后一段（`学习成长`），`title` 放完整路径；同名条目用「上一级/名字」区分。
4. **笔记面板 / 已打开面板按作用域条目分组**（原来按「路径第一段」分组）。
5. **术语表作用域 / 语义索引开关按作用域前缀判定**（原来按第一段，子目录条目会永远不命中）。
6. **空间管理改为「选择目录」弹窗**：从挂载根逐层浏览、勾选任意深度目录（可多选）、显示每目录的 md 篇数；去掉手打目录名的输入框。
7. **校验前置**：同一 set 内条目不许重叠（父/子、相等去重）；拒绝 `..` / `.` / 空段 / 反斜杠 / 以 `/` 开头；保存时条目必须在挂载根下真实存在。

## 非目标

- 不做「嵌套 root」（不改 `scanner` / `/api/asset` / 索引归属的解析方式）。
- 不做跨目录移动文件、不做按 set 隔离全局搜索（树/笔记/最近更新本来就是 set 作用域，搜索仍是全局）。
- 不做作用域自定义别名（显示名固定取最后一段）。
- 不改 MCP 工具签名。

## 关键设计

- `src/config.ts`：
  - `normalizeScope` / `rootNameOf` / `inScope` / `scopesOverlap` 四个纯函数；
  - `deriveRoots` 只取 `rootNameOf(entry)`（第一段），root 集合与「整棵一级目录」场景完全一致；
  - `validateSets` 允许条目内 `/`，做上述规范化与重叠检查；
  - `isEmbedEnabled(urlPath, sets = SETS)` 改为「任一 embed=true 的 set 的某个条目是 urlPath 的目录前缀」，并支持注入 sets 便于测试。
- `src/browse.ts`（新增）：只读目录浏览——`normalizeBrowsePath` / `resolveBrowseDir`（`path.resolve` + `realpath` 双重 containment，软链越界也拒）/ `listBrowseDirs`（单层、跳过隐藏与 `EXCLUDES`、注入 md 计数）。
- `src/index.ts`：新增 `GET /api/browse?path=`；`POST /api/sets` 在写入前校验每个条目在 `BASE_DIR` 下是真实目录。
- `src/glossary.ts`：`spaceDirsForPath` 与术语表候选文件都改用 `inScope` 前缀匹配；候选缓存从 `{urlPath, top}` 简化为 `urlPath[]`。
- 前端：`web/src/lib/utils.ts` 增加 `scopeSegs` / `scopeLabel` / `inScope` / `scopeDirOf` / `scopeLabels`（与后端同口径）；`tree-view.tsx` 用 `findNodeByPath` 从全局树里取作用域子树当一级节点；`notes-panel.tsx` / `opened-panel.tsx` 改为按命中的条目分组；`spaces-panel.tsx` 用「选择目录」按钮 + `dir-picker.tsx` 弹窗替代输入框，并在客户端先挡一次重叠。

## 验收标准（Given-When-Then）

1. Given `sets.json` 里某 set 的 `dirs: ["notion-archive/学习成长"]`，When 打开 `/set/<id>`，Then 侧栏树只显示一个一级节点「学习成长」（title 为完整路径），不显示 `notion-archive` 下的其它子目录，也不显示其它空间的目录。
2. Given 同一 set 有 `["notion-archive/学习成长", "notion-archive/工作相关"]`，When 打开该 set，Then 两个一级节点并列显示，各自可展开到文档。
3. Given 某 set 的 `dirs: ["notion-archive"]`，When 打开，Then 仍显示整棵 `notion-archive`（原有行为不变）。
4. Given 点「选择目录」，Then 弹窗从挂载根开始列出目录与 md 篇数；默认只显示含文档的目录（`_assets` 之类被过滤）；可逐层进入、多选、一次添加。
5. Given 同一 set 已有 `notion-archive`，When 再添加 `notion-archive/学习成长`，Then 客户端直接红字提示「重叠」，不写进草稿；后端 `POST /api/sets` 同样返回 400。
6. Given 条目写成 `../etc`、`a/../b`、`a//b`、`a\b`、`/abs`，Then 保存被拒并给出明确错误。
7. Given 条目在磁盘上不存在，Then 保存被拒（`目录不存在：…`）。
8. Given 侧栏「笔记」面板，Then 分组名取作用域条目最后一段，`N 篇 · M 条` 只统计该条目下的文档。
9. Given 文档在 `notion-archive/学习成长/a.md`，Then `GET /api/files/*` 可读、`GET /api/docs` 可保存、`POST /api/docs/create` 可在该目录新建，图片 `/api/asset/notion-archive/...` 正常（urlPath 未变）。
10. Given `GET /api/browse?path=../../etc` 或软链指向 `BASE_DIR` 外，Then 400。
11. 门禁：`npx tsc --noEmit`、`npm test`、`cd web && npm run build` 全过，并在本地实例上用无头浏览器走查上述交互。

## 影响面 / 回滚

- 修改：`src/config.ts`、`src/glossary.ts`、`src/index.ts`、`web/src/lib/{utils,api,types}.ts`、`web/src/components/sidebar/{tree-view,notes-panel,opened-panel,spaces-panel}.tsx`；新增 `src/browse.ts`、`src/browse.test.ts`、`web/src/components/sidebar/dir-picker.tsx`。
- 兼容：既有「一级目录」配置就是作用域深度 1 的特例，行为不变；`urlPath` 与索引行不变，无需迁移。
- 新增只读接口 `GET /api/browse`；不改 MCP。
- 回滚：还原上述文件 + 重新构建前端即可；`sets.json` 里已写入的子目录条目在旧版本会被 `validateSets` 拒绝并提示，需要手工改回一级目录。

## 验证记录

本地 fixture（`/tmp/md-smoke`：`base/notion-archive/{学习成长,兴趣爱好,工作相关,个人信息,_assets}` + `investment`）：

- 接口：`/api/browse` 根/子层/md 计数正常；`../../etc` → 400；`POST /api/sets` 子目录条目保存成功、重叠/不存在 → 400；`/api/files/*` 读嵌套文档、`/api/docs/create` 在子目录新建成功；`/api/notes`、`/api/recent` 按子目录过滤正确。
- 浏览器（Chrome headless + CDP，9 项断言全过）：树一级节点名取最后一段、只显示本 set 条目；切 set 后内容随之切换；笔记面板分组名/计数正确；目录弹窗逐层进入、默认过滤 `_assets`、勾选后「添加 1 个目录」；同 set 父子目录重叠时红字提示；保存后 `sets.json` 真的落盘（study set 增加 `notion-archive/工作相关`），刷新后两个一级节点并列显示。
- 门禁：`npx tsc --noEmit` 通过；`npm test` 157 用例全绿（新增 `browse.test.ts` 5 + `config.test.ts` 6 + `glossary.test.ts` 1）；`web` 类型检查与 `npm run build` 通过。
