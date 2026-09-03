# tasks: 建立测试运行器与首个冒烟测试

- [x] 1. 新增 vitest devDependency + `package.json` 的 `"test": "vitest run"` 脚本
- [x] 2. 写 `src/render.test.ts`（渲染冒烟：标题/代码高亮/任务/数学）
- [x] 3. 写 `src/scanner.test.ts`（buildTree）+ `src/scan-render.test.ts`（临时目录「扫描→渲染」端到端冒烟）
- [x] 4. 跑 `npm test` 全绿（3 文件 / 6 测试通过）
- [x] 5. 跑 `npx tsc --noEmit` 通过
