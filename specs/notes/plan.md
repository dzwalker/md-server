# plan: 正文笔记（`> note: 内容` 一行）

## 技术方案

### 1) 后端业务：新增 `src/notes.ts`（唯一持有「笔记行」业务）

纯函数 + 一个落盘函数，`index.ts` 只做参数解析与错误码映射（符合 `AGENTS.md` 分层）：

- `NOTE_LINE_RE = /^ {0,3}> ?note:[ \t]?(.*)$/i`：行首最多 3 空格（与 CommonMark blockquote 一致）；`render.ts` 与前端共用同一份判定，保证「能编辑的就是能渲染的」。
- `isNoteLine` / `noteTextOf` / `buildNoteLine` / `normalizeNoteText`：识别与规范化（换行折叠成空格，保证「一条笔记 = 一行」）。
- `insertNote(content, afterLine, text)` / `updateNote` / `deleteNote` / `applyNoteOp`：字符串级增删改，返回 `{ content, line }`；`splitLines` / `joinLines` 记录并保持 CRLF、末尾换行。
- `applyNoteToFile(fsPath, input)`：读原文 → 校验 → 改行 → **临时文件 + `rename` 原子替换**（`chmod` 保持原权限）；`expectMtimeMs` 与磁盘 `mtimeMs` 不一致（>0.5ms）直接 409。
- `NoteError { status }`：业务错误携带 HTTP 码（400 参数 / 404 文件不存在 / 409 目标行不是笔记行或外部已修改 / 500 写失败）。
- `toNoteOpInput(body)`：把线路字段 `mtimeMs` 归一化成业务字段 `expectMtimeMs`（**e2e 抓到的 bug**：最初路由把 `body` 原样传入，乐观锁静默失效，见 `src/notes.test.ts` 回归用例）。

### 2) 后端渲染：`src/render.ts`

- `notePlugin`：新增 block 规则 `md_note`，`md.block.ruler.before('blockquote', ...)`——不抢在 blockquote 之前注册就会被当成普通引用块。渲染成 `<div class="md-note" data-note-line data-note-raw data-line-start data-line-end><div class="md-note-label">笔记</div><div class="md-note-body">…</div></div>`；正文用 `md.renderInline(raw, env)`（因此 `[[双链]]`、公式、图片相对路径重写都走既有规则）。
- `srcLinePlugin`：`md.core.ruler.push` 给所有顶层块 token（`level === 0 && map`）打 `data-line-start`（1-based 首行）/ `data-line-end`（末行行号）；`math_block` 是自定义 token，在它自己的 renderer 里补上锚点。
- `data-note-raw` 用 `escapeHtml` 转义原文——**不能**从前端渲染结果反推原始 markdown（`**加粗**`、`[[双链]]` 会丢）。

### 3) 后端路由：`src/index.ts`

```ts
POST /api/notes  { path, op: 'insert'|'update'|'delete', afterLine?, line?, text?, mtimeMs? }
  → { ok, path, line, mtimeMs, size }
```

- `resolveUrlPath(path)` 保证路径落在某个 root 内；`notes.ts` 再要求 `.md`。
- 写成功后 **立即 `indexFiles([toMdFile(fsPath)])` + `bumpVersion()`**：`/api/render`、`/api/stat` 马上反映新 mtime，否则紧接着改第二条笔记会被乐观锁误判成「外部修改」。
- 索引另有 chokidar watcher 兜底（写入也会触发一次变更事件，幂等）。

### 4) 前端

- `web/src/lib/api.ts` + `lib/types.ts`：`api.saveNote(NoteRequest)`、`NoteResponse`；`RenderResult` 显式加 `mtimeMs`。
- 新增 `web/src/lib/notes.ts`（命令式 DOM，沿用 `markdown-extras.ts` / `mermaid-lightbox.ts` 风格）：
  - `resolveNoteContext(container, event)`：命中 `.md-note[data-note-line]` → 编辑/删除目标；否则取 `closest('[data-line-end]')` 得插入位置（没有锚点时兜底为「最后一个块」）。
  - `startInsertEditor` / `startNoteEditor` / `closeActiveNoteEditor`：就地编辑器（textarea + 保存/取消 + 错误行），同一时刻只允许一个；`Enter` 保存、`Esc` 取消、`isComposing` 时忽略回车（中文输入法）；失败在编辑器内红字提示。
- `web/src/components/doc-view.tsx`：
  - 正文容器挂 `contextmenu` 监听 → `resolveNoteContext` → React 状态 `noteMenu`；菜单用**受控 `DropdownMenu` + 1px 固定定位触发器**锚在鼠标位置（正文是 `dangerouslySetInnerHTML` 注入的 HTML，没有 React 组件树可用；`modal={false}` + `onCloseAutoFocus` preventDefault，避免抢走 textarea 焦点）。
  - 保存 → `api.saveNote(...)` →（带上渲染时的 `mtimeMs`）→ `api.render` + `cacheRender`：正文立即刷新，编辑器随 DOM 重注入消失。
  - 删除走 `Dialog` 二次确认；失败用底部轻提示。
  - 切文档 / mermaid 主题重渲染前调用 `closeActiveNoteEditor()`，避免残留在被替换的 DOM 上。
- `web/src/index.css`：`.md-note` 卡片、`.md-note-label`、`.md-note-input` / `.md-note-actions` / `.md-note-btn` 样式，颜色走现有 md 主题变量（`--md-note-border` 缺省回退 `--md-accent`）。

### 5) 修复轮：保存后「页面跳一下」+ 编辑器样式（2026-09-28 追加）

**跳位的根因**（实测定位，不是猜的）：正文是服务端 HTML 整篇注入，而 `.md-content > *` 开着
`content-visibility: auto`（`contain-intrinsic-size: auto 28px`）来跳过屏外块的布局。整篇替换会丢
掉浏览器「记住的真实尺寸」，屏外块退回 28px 估值 → 同一段内容在新 DOM 里的位置整体偏移。
在 625 行的长文档里做对照实验：**裸 `content.innerHTML = content.innerHTML`（不改任何内容）就让
标记段落漂移了 114px，而滚动容器的 scrollTop 完全没变**——这就是用户看到的「跳一下」。

**修法**：新增 `web/src/lib/scroll-anchor.ts`——替换前记下「视口内第一个块」的行号与它相对滚动容器
顶部的位置，替换后把同一个逻辑块钉回原位置（行号位移按 op 补偿：插在 afterLine 之后 → 其下 +1；
删掉 line → 其下 -1）。接入点：

- `submitNote`（保存笔记）与 mtime 轮询（外部改动刷新）前 `markScrollAnchor()`；
- `useLayoutEffect([activeRender])` 在 React 提交后的同一布局帧里校正（不等绘制，不会闪）；
- `renderExtras`（数学/图表二次渲染）结束后再校正一次并清掉锚点；
- mermaid 主题换肤那条手工 `innerHTML` 路径同样处理；
- 锚点绑定 `activeDoc`：保存后立刻切文档不会把旧锚点套到新正文上。

实测：插入/编辑/删除三种操作，视口首块位置漂移 ≤1px（对比修复前 114px）；外部改动刷新 1px。

**写盘身份**（同轮修复，用户报障）：`fs.writeFileSync(tmp) + rename` 会把临时文件的 uid/gid/mode 带成新文件的身份——容器以 root 跑时，用户的 `dev:dev 644` md 就变成了 `root:root`，用户自己的编辑器随即读写被拒。修法：rename 前
`fs.chownSync(tmp, before.uid, before.gid)` + `fs.chmodSync(tmp, before.mode & 0o777)`；进程 uid/gid
已等于源文件属主时跳过（普通用户自托管场景），chown 失败则抛 500 **拒绝写入**，绝不静默换属主。
验证：同一个镜像跑两个一次性容器（都挂 `/tmp` fixture，不碰生产数据），修前（镜像自带旧 src）→
`root:root`，修后（挂当前 src）→ `dev:dev 644`，内容与权限位不变、无 `.mdnote-*.tmp` 残留；
单测新增「属主/属组/权限位前后一致」与「不留临时文件」两条。

**编辑器样式**：输入区改为「田」字结构——`.md-note-field` 负责边框与聚焦光环（`focus-within` +
`color-mix` 淡环），`.md-note-input` 透明无边框、`resize: none`、`overflow: hidden`（不再出现默认
滚动条，只有粘贴超长内容时 JS 才放开为可滚动）；左下角一个 `.md-note-status` 槽位平时显示
「Enter 保存 · Esc 取消」、出错变红显示原因（同槽位不跳版）；按钮改为轻量 ghost + accent 实心，
颜色全部走 `--md-note-border`/`--md-accent`，明暗主题与 4 套 md 主题都成立。笔记卡片本身也补了
`--note-accent` 变量、hover 阴影与更松的行距。

### 7) 修复轮③：保存笔记时整篇重渲染导致的「闪一下」（2026-09-29）

**实测定位**（121 段 / 242 个公式的 fixture，KaTeX 已预热）：点保存 **t+155ms** 整篇 `innerHTML`
被替换——埋点段落节点永久断开；替换瞬间 **242/242 个公式全部退回未渲染占位**（页面上就是原始
TeX），最后一个公式要约 **195ms** 后才补完；期间还连带 mermaid 重画、图片重解码。
根因是「整篇替换」这个动作本身：`/api/render` 给的是未做二次渲染的 HTML（公式是占位 span），
前端注入后再补妆。

**做法（方案 A：只换一个节点）**：

- 正文注入由 React 的 `dangerouslySetInnerHTML` 改成**命令式 layout effect**：用
  `{ 容器元素, key=activeDoc+html }` 记录「DOM 里当前是哪一份 HTML」，key 变了才整篇重写；
  容器元素换了（切到图谱这类工具文档会让正文容器卸载重挂）也一定会重写。
- 新增 `web/src/lib/note-patch.ts`：保存成功后从新的 `/api/render` HTML 里**只取出目标那张笔记卡片**，
  `replaceWith`（insert 用临时编辑器卡片的位置 / update 用现有卡片）或 `remove`（delete）；
  插入/删除后把下方块的 `data-line-*` / `data-note-line` **重编号**（只写属性、不触发布局），
  否则下一次笔记操作会按错行号去写文件；卡片在**脱离文档**的状态下先跑一次 `renderExtras`
  （KaTeX/mermaid），换进去即是最终形态。结构不符 → 返回 false，调用方回退整篇重注入（复用滚动锚点）。
- 缓存照旧是**新的**（`cacheRender(fresh)`），只是 DOM 不再被 React 整篇重写；目录里的「笔记」列表
  本就是读 DOM（`toc-panel.tsx`），配合重编号后天然同步。

**实测对比**：

| 指标 | 修前 | 修后 |
|---|---|---|
| 整篇 DOM 替换 | t+155ms 发生 | **不发生**（埋点段落保持连接） |
| 保存过程中未渲染公式峰值 | 242 / 242 | **0 / 242** |
| 公式空窗 | 32ms 采样窗口，末个公式 +195ms 补完 | **0ms** |
| mermaid 图节点 | 重画 | **保持连接（不重画）** |

### 6) 文档

- 本 spec 三件套；`specs/README.md` 现状列表；`README.md` 功能；`AGENTS.md` 分层表 + 「生产数据只读」原则的精确例外；`.dsh/skills/code-map/SKILL.md` 结构表。

## 影响面

- **唯一越过只读边界的地方**：新增 `POST /api/notes`，能力被限制在「笔记行」的增/改/删，且带 mtime 乐观锁；没有通用写接口。
- 渲染增加 `data-line-*` 属性（每个顶层块约 +40 字节 HTML；`/api/render` 有 br 压缩，实测可忽略）；`> note:` 行从普通引用块变为笔记卡片（当前 4 个空间无历史笔记行，无存量影响）。
- 前端新增 2 个 lib 文件（`notes.ts`、`scroll-anchor.ts`）、`doc-view.tsx` 新增约 200 行；依赖零新增（`radix-ui`、`lucide-react` 已在依赖内）。
- 后端新增 1 个模块 + 2 个测试文件；索引/检索行为不变（笔记文本照常进 FTS）。
- 上线需 `docker compose up -d --build`（`web/dist` 在镜像内，未挂载）。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 写坏用户 md 文件 | 只改目标行 + 临时文件 `rename` 原子替换；update/delete 前校验目标行必须是笔记行，否则 409；CRLF/末尾换行/权限逐字保持；单测覆盖 |
| 并发覆盖（外部编辑器同时改同一文件） | `mtimeMs` 乐观锁（线路字段 `mtimeMs` → 业务 `expectMtimeMs`），不一致 409 并在编辑器内提示；e2e 用例覆盖 |
| 中文输入法回车误提交 | `keydown` 里判 `e.isComposing` / `keyCode === 229` |
| 右键菜单抢焦点导致无法输入 | `modal={false}` + `onCloseAutoFocus` preventDefault；e2e 断言「编辑器自动聚焦」 |
| `> note:` 与普通引用块冲突 | 识别规则要求 `note:` 紧跟 `>`；`> notes:`、四空格缩进代码块都有单测断言不受影响 |
| root 容器写笔记把用户文件变成 root:root（用户读写被拒） | 临时文件在 rename 前显式 `chown` 回源文件的 uid/gid 并 `chmod` 源权限位；进程身份已等于源属主时跳过；无法 chown 时**拒绝写入**（500）而不是悄悄换属主。root 容器对照实测：修前 root:root → 修后 dev:dev 644 |
| 长文档整篇重注入导致可视位置漂移（「保存后跳一下」） | 滚动锚点补偿（先记视口首块行号 + 相对位置，替换后钉回），实测插入/编辑/删除漂移 ≤1px；`content-visibility` 的估值问题本身保留（那是长文档首屏性能的既有设计），但保存瞬间不再跳 |
| 回滚 | 纯新增（`src/notes.ts`、`web/src/lib/notes.ts`、`web/src/lib/scroll-anchor.ts`、路由、渲染规则、样式）；回退本 spec 涉及文件即可，无需数据迁移；已产生的笔记行只是普通引用块，不会损坏文档 |

## 验证方式

1. `npx tsc --noEmit` + `npm test` + `cd web && npm run build`。
2. 临时 `:3099` 实例（fixture `/tmp/md-notes-fixture` + 独立 `MD_INDEX_DB`）+ 本机 Chromium **DOM 断言 23/23**（不截图）：菜单项、插到「该块之后的一行」、卡片渲染行内 md、原始 markdown 初值、取消不落盘、Esc/Enter、删除二次确认（含取消）、普通引用块不误判、外部改动后 409 不覆盖、无 console error。
3. 长文档跳位回归：625 行 fixture 上对比「裸重注入 vs 补偿后」（`content.innerHTML = content.innerHTML` 对照实验漂移 114px → 补偿后 ≤1px），并覆盖插入/编辑/删除/外部改动刷新四种触发。
4. 视觉/手感由用户在浏览器确认（依用户偏好，不以截图代替人工确认）。
