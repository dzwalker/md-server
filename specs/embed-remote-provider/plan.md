# plan: 远端 embedding

## 技术方案（`src/embed.ts` 重写）

- `PROVIDER = EMBED_PROVIDER || 'local'`；`openai` 分支 POST `${EMBED_BASE_URL}/embeddings`，body `{model, input, encoding_format:'float'}`。
  - **不能传 `dimensions`**：网关（litellm）对 text-embedding 系列报 `UnsupportedParamsError`，维度取端点默认；`EMBED_DIM` 只做返回值校验。
  - **单批 ≤ 10 条**：DashScope text-embedding-v4 的硬限制（16 会报 `batch size is invalid`），`EMBED_BATCH` 默认 10。
  - 重试 3 次指数退避；单批失败只跳过该批，不中断整体。
- `SIGNATURE = provider|base_url|model|dim`，存 `embed_meta.signature`；不符则 `DELETE FROM embeddings` 后重建。
- `embeddings` 表加 `mtime_ms` / `sig`；向量存 `Float32Array` 的 Buffer，读取兼容旧 JSON 字符串。
- `buildEmbeddings({force})`：按 mtime 跳过未变文件（重启不重算）；`semanticSearch` 在指纹不符时直接返回空（不给假相似度）。

## 影响面

- `src/config.ts`：`SpaceSet.exclude` + `isEmbedEnabled` 排除逻辑（对 set 内生效）。
- `sets.json`：`learning` set 打开 embed 并写入 exclude。
- `.env`：`EMBED_PROVIDER/BASE_URL/MODEL/DIM/BATCH/API_KEY`（600、gitignore）。
- 部署：**改 `.env` 后必须 `docker compose up -d --force-recreate`**，`restart` 不会重读 env_file（本次踩过）。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 敏感目录被嵌入外发 | `exclude` 白名单 + 嵌入后核对 `reorg-archived/recruitment` 向量数为 0 |
| 网关不可用 | 查询失败返回空并打日志，不影响全文检索 |
| 换模型后维度混乱 | 指纹机制强制清表重建 |

回滚：`EMBED_PROVIDER=local` + 重启（会自动按 local 指纹清表）。
