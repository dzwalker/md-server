/**
 * 文档里的相对资源路径 → `/api/asset/*`（与 `src/render.ts` 的改写口径一致）。
 *
 * 阅读态由服务端改写；编辑态（CodeMirror / Crepe）要靠这个函数，否则
 * `![](images/x.png)` 会按当前地址栏（`/set/xxx`）解析成 404。
 */
/** 以「文档所在目录」为基准改写相对路径（编辑器里通常只有目录，没有完整文档路径）。 */
export function assetUrlForDir(dir: string, src: string): string {
  if (!src) return src;
  if (/^(https?:|data:|blob:|#|\/\/)/i.test(src) || src.startsWith('/')) return src;
  const cut = src.search(/[?#]/);
  const pathPart = cut >= 0 ? src.slice(0, cut) : src;
  const suffix = cut >= 0 ? src.slice(cut) : '';
  const parts = ((dir || '') + '/' + pathPart).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return '/api/asset/' + out.join('/') + suffix;
}

/** 以「文档 urlPath」为基准改写（`/a/b.md` → 目录 `/a`）。 */
export function assetUrlForDoc(docUrlPath: string, src: string): string {
  const dir = docUrlPath.includes('/') ? docUrlPath.slice(0, docUrlPath.lastIndexOf('/')) : '';
  return assetUrlForDir(dir, src);
}
