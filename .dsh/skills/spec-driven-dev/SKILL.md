---
name: spec-driven-dev
description: 用 spec → plan → tasks → implement 四步沉淀 md-server 的需求与实现，确保口径统一、可验收。
whenToUse: 开发新功能、较大重构、或需求口径可能漂移时；动手前先在 specs/ 建目录写 spec。
---

# 规格驱动开发（SDD）

## 流程

1. **spec.md**：写清楚背景、目标、非目标、验收标准（可用 Given-When-Then）。
2. **plan.md**：技术方案、影响面（动哪些模块、是否破坏 API/MCP 工具兼容）、风险与回滚。
3. **tasks.md**：拆成可独立验收的小步，用 `- [ ]` 勾选。
4. **implement**：按 tasks 逐条实现，每步满足 `AGENTS.md` 的 DoD。

## 硬约束

- 未写 spec 不动手实现大功能。
- API / MCP 工具签名变更必须先在 spec 中声明，并同步 `AGENTS.md` / `README.md`。
- spec 变更走增量更新，保留历史口径，不静默覆盖旧 spec。

## 模板与示例

- 用法见 `specs/README.md`
- 首份示例见 `specs/test-harness/spec.md`
