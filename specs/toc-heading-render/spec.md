# spec: 右侧目录正确处理引号实体与 KaTeX 公式

## 背景

右侧「目录」面板直接用 `/api/render` 返回的 `headings[].text` 渲染，而 `text` 是**渲染后标题 HTML 去标签**的结果，带着 markdown-it 转义后的实体、也把公式退化成裸 LaTeX：

- `### 分辨率 5" 屏幕`（未配对的直引号，typographer 不会转成弯引号）→ 目录里显示 `分辨率 5&quot; 屏幕`。
- `## 公式 $E=mc^2$` → 目录里显示 `公式 E=mc^2`，而不是渲染后的公式；正文里同一个标题是正常渲染的 KaTeX。
- `### $F_1$`（整条标题只有一个公式）→ `markdown-it-anchor` 默认取词只认 `text`/`code_inline`，slug 为空 → `id=""`，这条标题**在目录里根本不出现**（也点不动）。
- 顺带：行内位置的 `$$…$$` 走 `math_block` 渲染器，会在 `</hN>` 前留一个换行，`src/render.ts` 的标题正则用 `.` 匹配内容（不含换行）→ 这类标题也从目录里消失。

正文（`.md-content`）没有这些问题：HTML 由浏览器解析，实体自然还原，`.katex-math/.katex-block` 占位符由 `renderExtras` 用 KaTeX 二次渲染。

## 目标

1. 目录条目的文本与正文显示语义一致：HTML 实体按浏览器口径还原一次（源码里字面写的 `&quot;` 仍显示为 `&quot;`），成对直引号仍由 typographer 转成弯引号。
2. 标题里的公式在目录里用 **同一个 KaTeX 通道**渲染，而不是显示裸 LaTeX。
3. 整条标题就是公式、或含行内 `$$…$$` 的标题，不再从目录里消失。

## 非目标

- 不动正文渲染结果：`/api/render` 的 `html` 逐字节不变。
- 不给已有标题改 id：只有过去 slug 为空（`id=""`，谁都链不上）的纯公式标题会拿到新 id。
- 不往目录里注入标题 HTML（无 `dangerouslySetInnerHTML`）：加粗/代码/链接在目录里仍然只显示文字。
- 不改任何 MCP 工具签名；`headings` 只是新增可选字段 `parts`，无公式时该字段不出现，旧客户端忽略即可。
- 不处理「标题里只有图片」的极端情况（仍是无文本、无 id）。

## 验收标准（Given-When-Then）

**A. 文本与实体**

- [x] Given 标题 `# 分辨率 5" 屏幕 & <尖括号>`，When 渲染，Then `headings[0].text === '分辨率 5" 屏幕 & <尖括号>'`（无 `&quot;` / `&amp;` / `&lt;`）。
- [x] Given 标题 `# 标题 "引号"`，When 渲染，Then `text === '标题 “引号”'`（typographer 的弯引号，与正文一致）。
- [x] Given 标题 `# 转义 &amp;quot; 与 &amp;amp;`，When 渲染，Then `text === '转义 &quot; 与 &amp;'`（只解一层，字面实体仍是字面）。
- [x] Given 标题 `# 中文 **加粗** 与 \`代码\` 与 [链接](http://x)`，Then `text === '中文 加粗 与 代码 与 链接'`，且 `parts` 不出现。

**B. 公式**

- [x] Given 标题 `## 公式 $E=mc^2$ 与 $a<b$ 结束`，Then `parts === [{text,'公式 '},{math,'E=mc^2'},{text,' 与 '},{math,'a<b'},{text,' 结束'}]`。
- [x] Given 标题 `# $x^2$`，Then `parts === [{math,'x^2'}]`，且 `id === 'x2'`（不再是空 id）。
- [x] Given 标题 `# $$\\frac{a}{b}$$`，Then `parts === [{math,'\\frac{a}{b}'}]`（含 `math_block` 的尾随换行也要能匹配、不留空白片段）。
- [x] Given 公式片段与正文 span 同源，When 公式源码里有实体，Then 只解一层（`<span class="katex-math">a &amp;lt; b</span>` → `a &lt; b`），保证 KaTeX 拿到和正文相同的 TeX。

**C. 前端（浏览器实测，服务 `MD_PORT=3011` 隔离实例）**

- [x] 目录 6 个条目全部显示；含公式的 4 个条目上 `.katex-math[data-md-rendered="1"]` 均为 1，且各自有 `.katex .katex-html`。
- [x] 目录 `innerText` 不含 `&quot;` / `&amp;` / `&lt;`；`分辨率 5" 屏幕` 显示为直引号。
- [x] 纯公式标题 `$x^2$` 出现在目录里（末项），点击后 `document.getElementById('x2')` 命中正文标题。

**D. 门禁**

- [x] `npx tsc --noEmit` 通过（根 + `web/`）。
- [x] `npm test` 全绿（64 例，`src/render.test.ts` +7 例）。

## 交付记录

- 2026-09-29 实现：`src/render.ts`（`headingContent` 拆 parts + 实体解码 + 标题正则容忍换行 + anchor `getTokensText` 空文本时兜底公式源码）、`web/src/lib/types.ts`（`TocPart`/`Heading.parts`）、`web/src/components/toc-panel.tsx`（按 parts 渲染 + 复用 `renderExtras`）、`web/src/index.css`（目录内 KaTeX 字号 1em、公式内不换行）。
- 2026-09-29 验证：`npm test` 64/64；本地隔离实例 `/api/render/demo/sample.md` 的 `headings` 结构如上；Chromium（playwright，`/tmp/md-verify/check.py`）实测目录 DOM 与点击滚动。
- 2026-09-29 **未上线**：本机 `md-server` 容器仍是旧镜像，需 `docker compose up -d --build`（需用户批准）。
