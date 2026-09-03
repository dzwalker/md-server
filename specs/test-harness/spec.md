# spec: 建立测试运行器与首个冒烟测试

## 背景

md-server 当前零测试、无测试框架，回归全靠人工。目标（来自 dev-check 诊断）：建立长期可维护流程，先补最小测试地基。

## 目标

引入轻量测试运行器（vitest），跑通一个端到端冒烟测试，作为 TDD 门禁的起点。

## 非目标

- 不追求高覆盖率（先跑通机制）。
- 不改变任何业务代码的现有行为。

## 验收标准（DoD）

- [x] `npm test` 可运行测试并通过（3 文件 / 6 测试）。
- [x] 至少一个冒烟测试覆盖「scan + render 一条路径」（`src/scan-render.test.ts`）。
- [x] 不改动 `src/` 业务逻辑（仅一处最小类型标注修正 `src/mcp.ts`，无运行时行为变化，见 plan）。
- [x] `npx tsc --noEmit` 通过。

## 备注

实现时按 spec → plan → tasks 补齐 `plan.md` 与 `tasks.md`（见 `specs/README.md`）。
