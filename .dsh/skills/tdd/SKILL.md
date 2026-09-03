---
name: tdd
description: 在 md-server 中用「先写失败测试 → 再实现 → 重构」的红绿循环开发功能，交付前强制通过测试与类型检查门禁。
whenToUse: 需要新增或修改 md-server 功能/行为时（尤其涉及检索、渲染、索引、HTTP API 或 MCP 工具）。
---

# TDD（测试驱动开发）

## 硬门禁（不可跳过）

1. 写任何实现前，先写一个**失败**的测试。
2. 交付前必须 `npx tsc --noEmit` 通过 + `npm test` 全绿。
3. 不得用「跳过测试」绕过红灯；确需跳过的用例必须标注原因并记录到 spec。

## 循环

1. **RED**：写最小失败测试，表达新行为的期望。
2. **GREEN**：写最小实现让它通过。
3. **REFACTOR**：清理实现，测试保持全绿。

每完成一轮，跑一次全量测试确认无回归。

## 起步清单（当前项目）

- 运行器：vitest（待引入，见 `specs/test-harness/spec.md`）。
- 单元测试重点：
  - `src/render.ts`：markdown / 数学 / 代码高亮渲染
  - `src/scanner.ts`：扫描、`MdFile`、目录树构建
  - `src/index-db.ts`：检索召回与打分、标签、双链提取
- 集成测试重点：`src/index.ts` 的 HTTP 路由（用 `app.inject()`，不起真实端口）。

## 约束

- 测试只覆盖 `src/` 的纯逻辑与可注入依赖；生产数据（`/data`）绝不在测试中读写。
- 测试数据使用临时目录/内存 SQLite，不触碰 `MD_INDEX_DB` 指向的真实库。
