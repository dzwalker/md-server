# plan: 右侧目录正确处理引号实体与 KaTeX 公式

## 技术方案

1. **服务端给出「有序片段」而不是只有纯文本**（`src/render.ts`）
   - 标题 HTML 按 `<span class="katex-(math|block)">…</span>` 切分：公式片段取回原始 TeX，其余片段去标签 + 实体解码。
   - `headings[]` 新增可选 `parts`，**只在标题里出现公式时给出**；`text` 保持纯文本兜底（旧客户端、无公式标题的行为与形状不变）。
   - 实体解码只做一层，语义等同浏览器解析正文 HTML；源码里字面写的 `&quot;` 也不会被过度解码。
2. **两处标题丢失一并修掉**
   - `markdown-it-anchor` 自定义 `getTokensText`：默认取词为空（整条标题是公式）时兜底用公式源码，避免 `id=""`；默认取词非空的标题 id **一个都不变**。
   - 标题内容正则 `.` → `[\s\S]`：容纳 `math_block` 渲染器补的尾随换行；片段拼接后裁掉首尾空白。
3. **前端按片段渲染，复用既有 KaTeX 通道**（`web/src/components/toc-panel.tsx`）
   - `parts` 里的 math 片段渲染成 `<span class="katex-math">TeX</span>`，`useEffect([tree])` 里调 `renderExtras(listRef.current)` 补妆（无公式时是空转）。
   - math 片段的 React `key` 带公式原文：公式变了就换节点，否则 `renderExtras` 会因 `data-md-rendered` 跳过，目录里留着旧渲染结果。
   - 不加 `dangerouslySetInnerHTML`：目录保持纯文本 + 公式，不引入标题里的链接/图片/HTML。
4. **样式**（`web/src/index.css`）：`.md-toc-list .katex { font-size: 1em }` 把 KaTeX 默认 1.21em 压回目录行高；公式中间 `white-space: nowrap`。

## 影响面

| 文件 | 改动 |
|---|---|
| `src/render.ts` | `TocPart`/`headingContent`/`decodeEntities`；anchor `getTokensText`；标题正则 |
| `src/render.test.ts` | 新增 7 例（实体/typographer/纯文本无 parts/公式 parts/纯公式 id/`$$`/实体只解一层） |
| `web/src/lib/types.ts` | `TocPart`、`Heading.parts?` |
| `web/src/components/toc-panel.tsx` | parts 渲染 + KaTeX 补妆 effect + `md-toc-list` 容器 ref |
| `web/src/index.css` | 目录内 KaTeX 字号/换行 |
| `specs/README.md` | 现状清单加一条 |

- **不改**：`/api/render` 的 `html`、MCP 工具签名、索引/扫描、正文交互（笔记、右键菜单、搜索高亮）。
- **向后兼容**：`parts` 可选；只有「现在是空 id」的纯公式标题会拿到新 id（空 id 无法被 `[[文档#锚点]]` 引用，无破坏面）。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 实体解码过度 / 与正文显示不一致 | 只解一层，并用「与正文 span 文本一致」的测试锁住 |
| 改 id 语法影响既有锚点 | 只兜底「默认取词为空」的场景，其余 id 生成路径不碰 |
| 目录里公式节点被 React 与 KaTeX 双重管理 | math 片段 key 含公式原文；`renderExtras` 已按 `data-md-rendered` 幂等 |
| 目录条目变高/布局抖动 | KaTeX 压到 1em；浏览器实测 6 条目录的截图与 DOM 断言 |

回滚：改动集中在 4 个文件 + 测试/文档，`git revert` 单个提交即可；无数据迁移、无依赖变更。
