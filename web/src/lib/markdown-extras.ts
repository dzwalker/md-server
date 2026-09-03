interface KatexLike {
  render: (src: string, el: HTMLElement, opts?: Record<string, unknown>) => void;
}

interface MermaidLike {
  render: (id: string, code: string) => Promise<{ svg: string }>;
}

function katex(): KatexLike | undefined {
  return (window as unknown as { katex?: KatexLike }).katex;
}

function mermaid(): MermaidLike | undefined {
  return (window as unknown as { mermaid?: MermaidLike }).mermaid;
}

/** 对服务端渲染出的占位符做客户端二次渲染（KaTeX 数学、mermaid 图表）。 */
export async function renderExtras(container: HTMLElement) {
  const k = katex();
  const m = mermaid();
  let mermaidId = 0;

  container.querySelectorAll('.katex-math').forEach((el) => {
    try {
      k?.render(el.textContent || '', el as HTMLElement, { throwOnError: false });
    } catch {
      /* ignore */
    }
  });
  container.querySelectorAll('.katex-block').forEach((el) => {
    try {
      k?.render(el.textContent || '', el as HTMLElement, { displayMode: true, throwOnError: false });
    } catch {
      /* ignore */
    }
  });

  if (!m) return;
  for (const el of Array.from(container.querySelectorAll('.mermaid-src'))) {
    const code = el.textContent || '';
    try {
      const { svg } = await m.render('mmd-' + mermaidId++, code);
      const d = document.createElement('div');
      d.innerHTML = svg;
      el.replaceWith(d);
    } catch {
      /* ignore */
    }
  }
}

/** 高亮正文中命中的关键词（跳过代码块/公式/mermaid）。 */
export function highlightContent(container: HTMLElement, query: string | null) {
  if (!query) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let first: HTMLElement | null = null;
  const q = query.toLowerCase();
  for (const node of nodes) {
    const parent = node.parentElement;
    if (parent && parent.closest('pre,code,.katex-math,.katex-block,.mermaid-src')) continue;
    const text = node.textContent || '';
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) continue;

    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + query.length);
    const frag = document.createDocumentFragment();
    if (idx > 0) frag.appendChild(document.createTextNode(text.slice(0, idx)));
    frag.appendChild(mark);
    if (idx + query.length < text.length) frag.appendChild(document.createTextNode(text.slice(idx + query.length)));
    (node as ChildNode).replaceWith(frag);
    if (!first) first = mark;
  }
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
