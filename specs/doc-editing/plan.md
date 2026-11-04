# plan: 正文编辑（新建 / 改名 / 编辑保存正文）

## 1. 为什么是「块级源码编辑 + 服务端实时预览」

- 前端没有 markdown 解析器，渲染全在服务端（`src/render.ts`）。要「编辑时看到格式化结果」，只有两条路：
  1. 前端再引入一个 markdown 解析器 → 两套渲染口径必然漂移（术语表、双链、笔记卡片、KaTeX 全要重做），否决；
  2. **服务端渲染**：把「一段源码」丢给同一个 `renderMarkdown`，拿回 HTML。
- 所以：源码框是真源，块下方/旁边的预览是服务端返回的 HTML。活跃块输入防抖 250ms 调一次 `POST /api/render-block`。
- 不用 contenteditable：HTML → Markdown 反解无法无损表达 `[[双链]]` / `$公式$` / 脚注 / frontmatter，而且会静默改字节（与仓库「绝不误改」的调性冲突）。

## 2. 服务端

### 2.1 抽公共写盘底座 `src/file-write.ts`

从 `notes.ts` 抽出，笔记与整篇保存共用同一套安全边界：

| 导出 | 职责 |
|---|---|
| `WriteError` | 携带 HTTP status 的业务错误（父类；`NoteError` / `DocError` 继承它） |
| `statMdFile()` | 只允许 `.md` / `.markdown`；不存在 404、不是文件 400 |
| `checkMtimeLock()` | `mtimeMs` 乐观锁（容差 0.5ms，兼容不同文件系统精度）→ 409 |
| `writeFileAtomic()` | 临时文件（`.mddoc-*` / `.mdnote-*` 便于排查与测试断言）→ 显式 chown/chmod → rename；失败清临时文件 |

`notes.ts` 改为调用它，行为与错误文案不变（27 个用例保持绿）。

### 2.2 新增 `src/docs.ts`

| 函数 | 语义 |
|---|---|
| `validateDocBaseName()` | 基名校验：去首尾空白、去一层 `.md`、拒空/以 `.` 开头或结尾/路径分隔符/Windows 保留字符/超 120 字符 |
| `saveDocFile(path, content, mtimeMs?)` | 整篇保存：mtime 锁 → 大小上限 5MB → 内容相同则不重写（保 mtime）→ 原子写 |
| `createDocFile(path, content='')` | 用 `flag: 'wx'` 一次完成「不存在才创建」（避免 stat 后写之间的竞态）；已存在 409 |
| `renameDocFile(old, new)` | 只允许**同目录**换基名；目标已存在 409（rename 会静默覆盖，必须先挡）；改名不改 inode，内容/属主/权限天然保持 |

### 2.3 路由（`src/index.ts`）

| 路由 | 说明 |
|---|---|
| `POST /api/docs` | 整篇保存；成功后 `indexFiles` + 增量向量（若该空间开启）+ `bumpVersion` |
| `POST /api/docs/create` | `{dir, name}` → urlPath；创建后同样入索引 |
| `POST /api/docs/rename` | `{path, name}` → 新路径；旧路径删索引/向量、新路径入索引、`renameFavorite` 迁移收藏、`bumpVersion` |
| `POST /api/render-block` | `{path, markdown}` → `{html, headings, glossary}`：用该文档的 `baseDir`（图片/资源链接改写）与所在空间的术语表渲染；只读，不碰磁盘；片段上限 200KB |

所有路径一律 `resolveUrlPath` 收口（不在任何 root 内 → 400），新建/改名只拼「目录 + 校验过的基名」，不可能越出目录。

`src/index-db.ts` 新增 `renameFavorite(old, new)`：收藏按 urlPath 存，改名不迁移就会静默掉收藏；保留原 `pinned` / `added_at`。

### 2.4 渲染器修正：围栏代码块的行号锚点

markdown-it 的 fence 规则：`highlight` 返回以 `<pre` 开头的字符串时**原样返回、token 属性全丢**。结果围栏代码 / mermaid 没有 `data-line-*` → 块编辑器只能把它们当「未覆盖源码块」，拿不到高亮也拿不到「图表」标签。`render.ts` 里补了一个 fence renderer：保留默认输出，把锚点塞回第一个 `<pre>`（有回归测试）。

## 3. 前端

### 3.1 状态（`state/store.tsx`）

- `editingPath` / `editingDirty`：同一时刻最多一篇在编辑；草稿全文放在编辑器组件里（每次按键都写 store 会让整棵树重渲染）。
- `beginEdit` / `endEdit` / `setEditingDirty`。
- `confirmLeaveEdit(nextPath)`：统一守卫——没有改动就静默退出；有改动弹确认（v1 用系统 `confirm`，避免把确认弹层散到每个离开入口）。挂在 `openDoc` / `activateDoc` / `closeDoc` / `switchSet` 上。
- `createDoc(dir, name)`：建 → 刷新树 → 打开 tab → 进编辑态。
- `renameDoc(path, name)`：改名 → 迁移 openDocs / activeDoc / renderCache / scrollTarget → 刷新树与收藏；正在编辑该文档时直接抛错。
- reducer 增加 `rename` 动作（tab 路径与标题一起换）。

### 3.2 编辑器（`components/doc-editor.tsx` + `components/block-source-editor.tsx` + `lib/md-codemirror.ts`）

数据模型：整篇源码按「段」组织，段是**唯一真源**的切分，不靠行号二次定位：

```
segments = [ {kind:'gap', src:['','']}, {kind:'block', cls:'text', src:[...], html}, ... ]
整篇源码 = segments.map(s => s.src.join('\n')).join('\n')
```

- 进入编辑：`GET /api/files/*` 取原文（记 `eol`、`mtimeMs`）→ `POST /api/render-block` 渲染整篇 → 用顶层元素的 `data-line-start/end` 切段；块之间的空白行→`gap`（不显示输入框，原样回写）；块之间的非空行（原始 HTML、脚注定义、YAML 头）→`source` 源码块。
- **单栏编辑（没有上下分栏）**：块空闲时用服务端渲染结果展示；点某块 → 原地换成 CodeMirror 源码编辑器（`block-source-editor.tsx`，`import('@/lib/md-codemirror')` **动态加载**）。
- **行内装饰**（`md-codemirror.ts`）：用 Lezer markdown 语法树 + 少量正则兜底，实现 Typora 式手感——
  - 加粗/斜体/行内代码：内容按格式显示，标记符号藏掉；
  - 链接：只显示链接文字（`[` 与 `](url)` 藏掉）；双链 `[[x|y]]` 按链接样式显示；
  - 行内公式 `$…$`：KaTeX widget；图片：`<img>` widget（相对路径按 `/api/asset` 改写）；
  - 标题/引用/代码块/表格/分割线：行级样式；标题 `#` 在光标不在该行时藏掉；
  - **光标进入即还原成源码**：装饰只在选区不与之相交时生效；
  - CJK 紧贴强调（`**"中文"**中文`）用正则补一份，保证与 markdown-it（cjk-friendly）一致。
- 列表回车自动续行、Tab 缩进、⌘Z/⌘⇧Z 撤销重做（CM6 history）、`Esc` 收起当前块、`⌘S` 保存（事件冒泡到文档级快捷键）。
- 收起编辑：源码变了才 `POST /api/render-block` 重新渲染**这一块**并更新缓存，不整篇重载。
- 保存：`POST /api/docs`（`mtimeMs` 乐观锁）→ `onSaved()` → 父组件退出编辑态并重渲染；409 时置 `conflict`，给「覆盖保存（不带 mtime）/ 放弃修改并重新载入」。
- 兜底：「整篇源码」切换（普通 textarea，不改块结构）。

### 3.3 文档视图（`components/doc-view.tsx`）

- 头部：编辑按钮（收藏左侧）；编辑态 → 「取消」+「保存」（primary，保存中禁用）；编辑态隐藏收藏/下载（避免操作到磁盘旧内容）。
- 正文：渲染区 `display:none`（DOM 缓存与滚动容器都保留），旁边渲染 `<DocEditor>`（宽度沿用 `mdMax`）。
- 编辑态：跳过 5s `/api/stat` 轮询、禁用右键笔记菜单、关闭浮动目录；`⌘S` / `Esc`；`beforeunload` 拦未保存；tab 上显示脏点。
- 保存成功：`endEdit()` → `api.render()` → `cacheRender`，把 `appliedHtmlRef` 清空强制重新注入。

### 3.4 资源管理器（`components/sidebar/tree-view.tsx` + `components/doc-name-dialog.tsx`）

- 目录节点菜单：`新建 Markdown 文件` → 命名对话框；文件节点菜单：`… / 下载 / ── / 重命名`。
- 命名对话框（共用）：自动聚焦 + 全选、固定 `.md` 后缀提示、`Enter` 提交（输入法组字中的 Enter 不算）、`Esc` 取消、提交中禁用、失败红字不关闭。
- 重命名时先查 `/api/backlinks/*`，有引用就提示「有 N 篇文档引用了它…，改名后引用不会自动更新」。
- Radix 的坑：ContextMenu 关闭时 FocusScope 会延迟把焦点还给触发元素，会和对话框自动聚焦打架 → 用一个 flag 在 `onCloseAutoFocus` 里跳过这次归还。

## 4. 影响面

- **写盘例外从「只改笔记行」扩到「整篇正文 + 新建 + 改名」**（`AGENTS.md` 原则 4 已同步更新；这是用户明确要求的产品能力）。
- API 新增 4 个（`/api/docs`、`/api/docs/create`、`/api/docs/rename`、`/api/render-block`），不改旧接口；MCP 工具未变。
- 渲染器只多打一个属性（fence 的 `data-line-*`），HTML 结构与样式不变；笔记/术语表/目录行为不受影响。
- 前端新增依赖：`@codemirror/{state,view,language,commands,lang-markdown}`（只在进入编辑态时动态加载，`md-codemirror-*.js` 独立 chunk ≈492KB 原始 / 阅读路径不受影响）。
- 改名不迁移引用：`[[双链]]` / 相对链接仍指向旧路径（确认框提示，v1 不自动改）。
- 编辑态下滚动位置会回到顶部（渲染区被 `display:none`，滚动容器高度归零）；这是已知取舍。

## 5. 风险与回滚

| 风险 | 处置 |
|---|---|
| 保存覆盖别处的改动 | mtime 乐观锁 + 409 + 显式「覆盖保存」；不传 mtime 只由用户在冲突条上点选 |
| 块区间与渲染结构对不上（异常 HTML/脚注） | 未覆盖区间退化成源码块；再兜底「整篇源码」；解析不出任何块时给空文本块 |
| 大文档进入编辑慢 | 进入只做 1 次原文读取 + 1 次整篇渲染；每块渲染态二次渲染按块懒跑（mermaid 走 IntersectionObserver）；源码编辑器只在点开的那一块创建 |
| 前端构建产物没更新 | 部署走 `docker compose up -d --build`（Dockerfile 里会 `npm run build`）；本机验证必须重建 `web/dist` |
| 回滚 | 单 commit 可整体回退；写盘能力只在新路由上，旧功能（笔记 / 只读浏览）不依赖 `docs.ts` |

## 6. 已知限制 / 后续可做

- `Esc` 在源码框里只收当前块；`⌘Z` 是浏览器/textarea 原生撤销（没有跨块的历史栈）。
- 起草稿不持久化（刷新会丢，`beforeunload` 拦一下）；多文档并行编辑未做。
- 改名不改引用（可按 backlinks 自动改写，但要处理别名/相对路径，单独做）。
- 保存后不保留编辑前的滚动位置。
- 富文本 / 表格可视化编辑、图片粘贴上传未做。
