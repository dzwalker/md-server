# spec: 正文里指向本地非 md 文件的链接可直接点开

## 背景

`learning-ad/concepts/matrix-basics.md` 里有一行：

```markdown
> 🕹️ **可交互版（拖滑块实时看）**：[`interactive/derivative-interactive.html`](interactive/derivative-interactive.html)（Plotly 生成，完全自包含离线可开，单文件 4.9 MB）
```

这是一个指向仓库内本地 HTML 的**相对链接**。用户期望「点一下就打开这个互动页」，实测却是**被重定向**：

1. 前端在渲染正文时，对**带非 md 扩展名**的链接不做拦截，直接交给浏览器整页跳转（`web/src/components/doc-view.tsx` 的 `onContentClick`：`lastSeg.includes('.') && !/\.(md|markdown)$/` → `return`）。
2. 但前端 SPA 启动时会把地址栏 `history.replaceState` 成 `/set/<id>`（`web/src/state/store.tsx`）。浏览器对**相对 href** 会以当前地址（`/set/<id>`）为基址解析：
   `interactive/derivative-interactive.html` → `/set/interactive/derivative-interactive.html`。
3. 该路径首段 `set` 不是任何文档空间（root），`@fastify/static` 找不到文件 → 落到 `setNotFoundHandler` 返回前端壳（`web/dist/index.html`）→ SPA 再次 `replaceState` 回默认空间。观感就是「点了链接被弹回首页/默认空间」。

即：**相对资源链接在 SPA 的 `/set/<id>` 基址下被错误解析**；同时服务端也没有任何端点按「原始路径」返回这类本地非 md 文件（`/api/asset/*` 当时只放行图片与 PDF）。

## 目标

1. 正文里指向本地非 md 文件的**相对链接**（互动 HTML、PDF、CSV、JSON、脚本源码…）一点即开：浏览器拿到**正确路径**并内联查看。
2. 修复落在**服务端渲染层**（无需重建前端 bundle）：`renderMarkdown` 按文档目录（`env.baseDir`）把这类相对链接改写成**绝对** `/api/asset/<相对路径>`，与既有的图片改写（`image` 规则）完全对称。
3. `/api/asset/*` 放行「可内联查看」的扩展名：在原图片/PDF 基础上，增加 html/htm、txt/log、csv/tsv、json/xml、yaml/yml/toml/ini、css/js/mjs、py/sh/ts/tsx/jsx 源码（按纯文本返回，避免同源被当脚本执行）、图片补充 avif/bmp/ico、音视频与字体。

## 非目标

- **不改前端**（不重建 `web/dist`）：靠服务端改写出绝对路径解决基址问题。
- **不改 md 链接**：相对 `.md` 链接仍原样输出，由前端文档路由按 `activeDoc` 解析（行为不变）。
- **不动外部链接 / 协议 / 绝对路径 / 纯锚点 / `[[双链]]` / 无扩展名的相对链接**：原样保留。
- **不新增路由**：复用既有 `GET /api/asset/*`（已带 root 越界校验）。
- 不做「绝对路径的本地资源链接」自动改写（如 `/learning-ad/x.html`）——本次仅覆盖相对链接；如需可后续扩展。

## 验收标准（Given-When-Then）

**A. 渲染改写（`src/render.ts`，baseDir=`/learning-ad/concepts`）**

- [x] Given `[互动页](interactive/derivative-interactive.html)`，Then 输出 `href="/api/asset/learning-ad/concepts/interactive/derivative-interactive.html"`。
- [x] Given `[图](../images/a.png)`，Then 规范化为 `href="/api/asset/learning-ad/images/a.png"`。
- [x] Given `[页](interactive/x.html#sec-1)`，Then 保留锚点：`href="/api/asset/.../x.html#sec-1"`。
- [x] Given `[脚本](interactive/build.py)`，Then 改写为 `/api/asset/.../build.py`。
- [x] Given 相对 md `[另一篇](./other.md)`、无扩展名 `[姊妹篇](sibling)`，Then 原样输出（不含 `/api/asset`）。
- [x] Given 外链 `https://…`、绝对路径 `/learning-ad/x.html`、纯锚点 `#top`，Then 原样输出（不含 `/api/asset`）。

**B. 资源端点（隔离实例，端口 3011）**

- [x] Given `GET /api/asset/learning-ad/concepts/interactive/derivative-interactive.html`，Then `200`、`content-type: text/html; charset=utf-8`、4,868,497 字节。
- [x] Given `GET /api/asset/learning-ad/concepts/interactive/build_derivative_interactive.py`，Then `200`、`text/plain; charset=utf-8`。
- [x] Given 越界 `/api/asset/learning-ad/../../etc/passwd` 或非 root `/api/asset/neolix-mgmt/foo.html`，Then 非 200（404）。
- [x] Given 既有图片标记 `![…](images/x.png)`，Then `src` 仍被改写为 `/api/asset/...`（回归）。

**C. 端到端**

- [x] 隔离实例 `GET /api/render/learning-ad/concepts/matrix-basics.md` 返回的 HTML 里，该链接为 `href="/api/asset/learning-ad/concepts/interactive/derivative-interactive.html"`；该 URL 直接返回互动页 HTML 首屏。
- [x] SPA 客户端路由兜底不受影响：`GET /set/l` 仍返回前端壳（704 字节）。

**D. 门禁**

- [x] `npx tsc --noEmit` 通过。
- [x] `npm test` 全绿（86 例，`src/render.test.ts` +7）。

## 交付记录

- 2026-10-12 实现：`src/render.ts`（新增 `link_open` 规则 + `rewriteLocalAssetHref`，与图片规则对称）、`src/index.ts`（扩充 `ASSET_MIME`）、`src/render.test.ts`（新增「正文本地资源链接改写」7 例）。
- 2026-10-12 验证：`npx tsc --noEmit` 通过；`npm test` 86/86；隔离实例（`MD_PORT=3011`，仅挂 `learning-ad`）核对 `matrix-basics.md` 渲染链接、`/api/asset` 的 html/py 响应头与字节数、越界/非 root 404、图片改写回归、`/set/l` 兜底。
- 部署方式：本次仅改服务端 `src/`（容器已挂载 `./src`），**重启 md-server 容器**即生效，无需重建前端/镜像。
