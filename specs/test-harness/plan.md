# plan: 建立测试运行器与首个冒烟测试

## 技术方案

- **运行器**：vitest（Vite 原生 TS 支持，零配置即可跑 `.ts` 测试，契合现有 `tsx` + ESM 生态）。
- **测试范围（冒烟，只覆盖现有正确行为，不改业务代码）**：
  1. `src/render.test.ts`：`renderMarkdown` 纯函数——标题提取/anchor、代码高亮、任务列表、数学块。
  2. `src/scanner.test.ts`：`buildTree` 纯函数 + `scanAll` 对临时目录的「扫描 → 渲染」端到端冒烟（用 `MD_ROOTS` 指向临时目录，配合 `vi.resetModules()` + 动态 `import` 隔离 `config.ts` 的启动时加载）。
- **配置**：不新增 `vitest.config.ts`，用默认 include（`**/*.test.ts`），默认 node 环境，自动排除 `node_modules`。

## 影响面

- 新增 devDependency：`vitest`（由 npm 解析具体版本）。
- `package.json`：新增 `"test": "vitest run"` 脚本。
- 新增测试文件：`src/render.test.ts`、`src/scanner.test.ts`、`src/scan-render.test.ts`。
- **不改动任何 `src/` 业务逻辑**；不破坏 API/MCP 工具签名；不影响生产构建（Dockerfile 只 `COPY` 并 `npx tsx` 启动，测试文件不影响运行）。
- 例外（最小类型修正）：`src/mcp.ts:77` 的 `Record<string, SSEServerTransport>` 改为 `Record<string, any>`——这是一个**既有**的类型标注错误（`require` 导入的值被当类型用），仅修类型、零运行时行为变化，目的是让 `npx tsc --noEmit` 门禁从第一天起就是绿的。

## 风险与回滚

- 风险：vitest 与现有 ESM / tsconfig（`moduleResolution: Bundler`）的 `.js`→`.ts` 解析兼容性。若默认配置报错，回退方案是加一个最小 `vitest.config.ts`（esbuild 处理 TS，无额外插件）。
- 回滚：删除两个测试文件、移除 `package.json` 的 `test` 脚本与 `vitest` devDependency，`npm install` 还原 lockfile。
