# spec: 语义索引改用内网网关的远端 embedding

## 背景

- 现状（2026-11-09 前）：`src/embed.ts` 用 `@huggingface/transformers` 在 Node 进程内跑 `Xenova/multilingual-e5-small`（ONNX）。推理时**阻塞事件循环**，本机实测「一开语义索引整个服务就卡」，所以 `sets.json` 里所有 set 都是 `embed:false`，语义检索实际不可用（`built 0`）。
- 决策：改用 neolix 内网网关 `https://claude.neolix.ai/v1` 的 `text-embedding-v4`（1024 维）——**与 OpenViking 同一套配置**，本地零算力、文本不出内网链路。

## 目标

1. `src/embed.ts` 支持 `EMBED_PROVIDER=local|openai`，openai 走任意 OpenAI 兼容 `/embeddings`。
2. 模型指纹（provider/base_url/model/dim）写进 `embed_meta`；**指纹变化自动清空向量重建**，避免不同维度/语义空间混算。
3. 向量改存 Float32 BLOB（兼容旧的 JSON 文本行），带 `mtime_ms` 支持增量。
4. `SpaceSet` 支持 `exclude`：被列掉的目录即使落在 embed=true 的 set 里也不进语义索引（合规用）。
5. 只索引需要的空间：`learning` set（learning-ad + neolix-mgmt），排除 `neolix-mgmt/reorg-archived`、`neolix-mgmt/recruitment`；`inbox` 保留（用户明确要求）。

## 非目标

- 不自建向量库/不引入 sqlite-vec：430 篇规模下全表点积足够（实测查询 460–1080ms，主要是网关 query 编码）。
- 不改 `search_semantic` 的返回形状。

## 验收标准

- Given 打开 embed 后重启，Then `embeddings/status` 返回 `built == total`（430/430），模型为 `text-embedding-v4`、`dim 1024`。
- Given `reorg-archived/` 与 `recruitment/`，Then 其向量数为 0；`inbox/` 有向量。
- Given 查询「数到二就停了 汇报口径 2h44m」，Then 命中的前 3 条里包含 `inbox/2026-10-29-1026事故CEO复盘会-Sinba发言弹药包.md`。
- Given 把 `EMBED_MODEL` 改成别的模型，Then 启动时自动清空旧向量并按新指纹重建（不产生混维垃圾）。
