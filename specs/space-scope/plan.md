# plan: 空间作用域

## 技术方案

### 1. 作用域模型（`src/config.ts`）

```
set.dirs[i] = "notion-archive/学习成长"        // 作用域条目（任意深度）
      │ rootNameOf() 取第一段
      ▼
Root { url: "/notion-archive", dir: BASE_DIR + "/notion-archive" }   // 物理 root，与以前完全一致
```

- 物理层（scanner / index / asset / watcher）仍按「root URL 一段」工作，**不改**。
- 视图层（侧栏树 / 笔记 / 已打开 / 术语表 / embed）按 `inScope(urlPath, entry)` 前缀判定。
- 文档 urlPath 保持 `/notion-archive/学习成长/a.md`：图片相对链接、收藏、双链、mtime 锁、索引行都不动。

### 2. 校验

- `validateSets`：拒 `..` / `.` / 空段 / 反斜杠 / 以 `/` 开头；条目去首尾 `/`；同 set 内重叠即拒（相等视作重复、静默去重）。
- `POST /api/sets`：额外校验条目在 `BASE_DIR` 下是真实目录（`fs.statSync().isDirectory()`）。

### 3. 目录浏览（`src/browse.ts` + `GET /api/browse`）

- `normalizeBrowsePath` → `resolveBrowseDir`（`path.resolve` 越界检查 + `realpath` 软链检查）→ `listBrowseDirs`（单层）。
- 跳过 `.` 开头与 `EXCLUDES`；`mdCount` 由 `index.ts` 注入（对索引里的 urlPath 做前缀统计，一次查询）。
- 只读，不读正文。

### 4. 前端

- `lib/utils.ts`：`scopeSegs/scopeLabel/inScope/scopeDirOf/scopeLabels`（与后端同口径）。
- `tree-view.tsx`：`visible` 改为「每个条目 → 全局树里对应 path 的子树」；显示名取最后一段、`title` 放完整路径；条目缺失时给占位节点。
- `notes-panel.tsx` / `opened-panel.tsx`：分组键从「路径第一段」改成「命中的条目」；组名同规则。
- `spaces-panel.tsx`：输入框 → 「选择目录」按钮；`dir-picker.tsx` 弹窗（面包屑 + 逐层 + 多选 + `仅显示含文档的目录` + md 篇数）；客户端先挡重叠。

## 影响面

| 区域 | 影响 |
|---|---|
| `sets.json` | 兼容（一级目录 = 深度 1 特例）；子目录条目旧版本会拒绝，回滚需改回 |
| 索引 / urlPath | 不变，无需迁移 |
| API | 新增只读 `GET /api/browse`；`POST /api/sets` 增加「目录必须存在」校验 |
| MCP | 不变 |
| 前端 | 树/笔记/已打开的分组口径改为「条目」；侧栏「选择目录」流程重做 |

## 风险与回滚

- 风险：树按条目取子树时，若条目在全局树里不存在（空目录）会显示空节点 → 已用占位节点兜底。
- 风险：同 set 条目重叠会让树/笔记重复展示 → 前后端双重拒绝。
- 回滚：`git revert` 本组改动 + `cd web && npm run build`；`sets.json` 里已写入的子目录条目需手工改回一级目录。
