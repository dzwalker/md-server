/**
 * 「分块」模式的渲染结果缓存（键 = 文档路径 + mtime）。
 *
 * `POST /api/render-block` 要把整篇正文重新渲染一遍（大文档实测 ~97ms），
 * 而它只在「分块」模式用得到。缓存之后：同一 mtime 下反复进出编辑态 / 切换模式，
 * 都不再重复请求与渲染。
 */
const MAX_ENTRIES = 40;
const cache = new Map<string, string>();

function key(path: string, mtimeMs?: number): string {
  return `${path}\u0000${mtimeMs ?? 0}`;
}

export function getBlockHtml(path: string, mtimeMs?: number): string | undefined {
  return cache.get(key(path, mtimeMs));
}

export function setBlockHtml(path: string, mtimeMs: number | undefined, html: string): void {
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key(path, mtimeMs), html);
}
