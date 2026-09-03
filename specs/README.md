# specs/ 使用说明（spec → plan → tasks → implement）

本目录用「规格驱动开发（SDD）」沉淀需求与实现步骤，避免需求口径漂移。

## 目录结构

```
specs/<feature-slug>/
  spec.md   需求规格：背景 / 目标 / 非目标 / 验收标准（可用 Given-When-Then）
  plan.md   实现计划：技术方案 / 影响面 / 风险与回滚
  tasks.md  任务清单：拆分到可独立验收的小步（- [ ] 勾选）
```

## 流程

1. **spec**：先写清楚「要做什么、为什么、怎么算做完（验收标准）」。未写 spec 不动手实现大功能。
2. **plan**：确认技术方案与影响面（动哪些模块、是否破坏 API/MCP 兼容、回滚方式）。
3. **tasks**：拆成小步，每步可独立验证。
4. **implement**：按 tasks 逐条落地，每完成一项满足 `AGENTS.md` 的 DoD。

## 现状

- `test-harness/`：为 md-server 建立测试运行器与首个冒烟测试（首个 spec）。
