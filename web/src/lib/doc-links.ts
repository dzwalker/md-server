// 正文链接解析：markdown 链接 [text](url) 与 [[双链]] 的目标定位 + 锚点查找。

export interface ResolvedLink {
  // 解析出的 urlPath（含 .md）；纯 #锚点 时 path 为 null
  path: string | null;
  // 去掉 # 并 decodeURIComponent 后的锚点
  anchor: string;
}

// 把 markdown 链接的 href 解析成「urlPath + 锚点」。
// activeDoc 是当前文档的 urlPath（如 /investment/dir/当前.md），用于解析相对路径。
export function resolveMarkdownLink(href: string, activeDoc: string | null): ResolvedLink {
  const hashIdx = href.indexOf('#');
  const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  let anchor = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
  try {
    anchor = decodeURIComponent(anchor);
  } catch {
    /* ignore */
  }

  if (!pathPart) return { path: null, anchor };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const base = activeDoc ? origin + activeDoc : origin + '/';
  let resolved: string;
  try {
    resolved = new URL(pathPart, base).pathname;
    resolved = decodeURIComponent(resolved);
  } catch {
    return { path: null, anchor: '' };
  }

  const withMd = /\.(md|markdown)$/i.test(resolved) ? resolved : resolved + '.md';
  return { path: withMd, anchor };
}

// 把 [[目标]] 里的「目标」定位到真实 urlPath（先精确/partial path，再 basename 匹配）。
export function resolveWikilink(
  target: string,
  fileIndex: Map<string, string>,
): { path: string; title: string } | null {
  const clean = target.trim();
  if (!clean) return null;

  const withMd = /\.(md|markdown)$/i.test(clean) ? clean : clean + '.md';
  for (const c of ['/' + withMd, withMd, '/' + clean, clean]) {
    if (fileIndex.has(c)) {
      return { path: c, title: fileIndex.get(c) || clean };
    }
  }

  const name = (clean.split('/').pop() || '').replace(/\.(md|markdown)$/i, '');
  if (!name) return null;
  const matches: string[] = [];
  for (const p of fileIndex.keys()) {
    const base = (p.split('/').pop() || '').replace(/\.(md|markdown)$/i, '');
    if (base === name) matches.push(p);
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.length - b.length);
  const path = matches[0];
  return { path, title: fileIndex.get(path) || name };
}

// 在已渲染的正文容器里按 id 找锚点（精确 → 忽略大小写兜底，因 slugify 会小写化）。
export function findAnchor(root: HTMLElement, anchor: string): HTMLElement | null {
  if (!anchor) return null;
  try {
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`);
    if (el) return el;
  } catch {
    /* ignore */
  }
  const lower = anchor.toLowerCase();
  const headings = Array.from(
    root.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'),
  );
  return headings.find((h) => h.id.toLowerCase() === lower) || null;
}
