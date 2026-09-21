import { openMermaidLightbox } from './mermaid-lightbox';
import { exportMermaidSvg, exportMermaidRaster, type RasterFormat } from './mermaid-export';
import { AUTO_MERMAID_THEME, getStoredMermaidTheme } from './mermaid-themes';

interface KatexLike {
  render: (src: string, el: HTMLElement, opts?: Record<string, unknown>) => void;
}

interface MermaidLike {
  initialize: (opts: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string; bindFunctions?: (el: HTMLElement) => void }>;
}

function katex(): KatexLike | undefined {
  return (window as unknown as { katex?: KatexLike }).katex;
}

function mermaid(): MermaidLike | undefined {
  return (window as unknown as { mermaid?: MermaidLike }).mermaid;
}

// ---------- 按需加载第三方库 ----------
// katex(273KB) / mermaid(3.3MB) 不再随首屏加载：只有正文里真的出现公式/图表时才注入。
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const found = document.querySelector<HTMLScriptElement>(`script[data-md-src="${src}"]`);
    if (found) {
      if (found.dataset.mdLoaded === '1') return resolve();
      found.addEventListener('load', () => resolve());
      found.addEventListener('error', () => reject(new Error('load failed: ' + src)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.mdSrc = src;
    s.addEventListener('load', () => { s.dataset.mdLoaded = '1'; resolve(); });
    s.addEventListener('error', () => reject(new Error('load failed: ' + src)));
    document.head.appendChild(s);
  });
}

let katexPromise: Promise<KatexLike | undefined> | null = null;
let mermaidPromise: Promise<MermaidLike | undefined> | null = null;

export function ensureKatex(): Promise<KatexLike | undefined> {
  const now = katex();
  if (now) return Promise.resolve(now);
  if (!katexPromise) katexPromise = loadScript('/media/katex.min.js').then(() => katex()).catch(() => undefined);
  return katexPromise;
}

export function ensureMermaid(): Promise<MermaidLike | undefined> {
  const now = mermaid();
  if (now) return Promise.resolve(now);
  if (!mermaidPromise) mermaidPromise = loadScript('/media/mermaid.min.js').then(() => mermaid()).catch(() => undefined);
  return mermaidPromise;
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

/** 依据设置项解析实际 mermaid 主题：「跟随明暗」时按当前明暗返回 default/dark。 */
function resolveMermaidTheme(): string {
  const t = getStoredMermaidTheme();
  return t === AUTO_MERMAID_THEME ? (isDark() ? 'dark' : 'default') : t;
}

/** 位图导出按钮（PNG / JPG）：渲染期间禁用，失败时在按钮上短暂提示。 */
function rasterButton(source: string, name: string, format: RasterFormat): HTMLButtonElement {
  const label = format.toUpperCase();
  const baseTitle = '导出 ' + label + ' 图片（2 倍分辨率）';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.title = baseTitle;
  const flash = (hint: string) => {
    btn.textContent = '×';
    btn.title = baseTitle + '：' + hint;
    setTimeout(() => {
      btn.textContent = label;
      btn.title = baseTitle;
    }, 2000);
  };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    try {
      const ok = await exportMermaidRaster(source, name, format);
      if (!ok) flash('该图自带 htmlLabels 配置，位图导出不可用，请改用 SVG');
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

/** 对服务端渲染出的占位符做客户端二次渲染（KaTeX 数学、mermaid 图表）。 */
export async function renderExtras(container: HTMLElement) {
  // 数学：只有正文里真的出现公式才加载 katex。
  if (container.querySelector('.katex-math, .katex-block')) {
    const k = await ensureKatex();
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
  }

  // 图表：只有真有占位符才加载 mermaid（3.3MB）。
  const sources = Array.from(container.querySelectorAll<HTMLElement>('.mermaid-src'));
  if (!sources.length) return;
  const mermaidLib = await ensureMermaid();
  if (!mermaidLib) return;
  const m: MermaidLike = mermaidLib;
  m.initialize({ startOnLoad: false, securityLevel: 'loose', theme: resolveMermaidTheme() });

  let mermaidId = 0;

  async function renderOne(el: HTMLElement) {
    const code = el.textContent || '';
    const id = 'mmd-' + mermaidId++;
    try {
      const { svg, bindFunctions } = await m.render(id, code);

      const wrap = document.createElement('div');
      wrap.className = 'mermaid-wrap';
      const box = document.createElement('div');
      box.className = 'mermaid';
      box.innerHTML = svg;
      // 点击图打开全屏查看（保留 mermaid 内部 <a> 链接的默认行为）
      box.addEventListener('click', (e) => {
        const t = e.target as HTMLElement | null;
        if (t && t.closest('a')) return;
        void openMermaidLightbox(code);
      });

      const toolbar = document.createElement('div');
      toolbar.className = 'mermaid-toolbar';
      const zoomBtn = document.createElement('button');
      zoomBtn.type = 'button';
      zoomBtn.textContent = '放大';
      zoomBtn.title = '全屏查看';
      zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void openMermaidLightbox(code);
      });
      const svgBtn = document.createElement('button');
      svgBtn.type = 'button';
      svgBtn.textContent = 'SVG';
      svgBtn.title = '导出 SVG 文件（矢量）';
      svgBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exportMermaidSvg(box, id);
      });
      toolbar.append(zoomBtn, svgBtn, rasterButton(code, id, 'png'), rasterButton(code, id, 'jpg'));

      wrap.append(toolbar, box);
      el.replaceWith(wrap);
      bindFunctions?.(box);
    } catch (e) {
      const err = document.createElement('div');
      err.className = 'mermaid-error';
      const strong = document.createElement('strong');
      strong.textContent = 'Mermaid 渲染失败';
      const pre = document.createElement('pre');
      pre.textContent = (e instanceof Error ? e.message : String(e)) + '\n\n' + code;
      err.append(strong, pre);
      el.replaceWith(err);
    }
  }

  // 首屏先渲染前几张；其余等滚动到附近再渲染，避免「19 张图文档」把主线程占满几秒。
  const EAGER = 3;
  const eager = sources.slice(0, EAGER);
  const lazy = sources.slice(EAGER);
  for (const el of eager) await renderOne(el);
  if (!lazy.length) return;

  if (typeof IntersectionObserver === 'undefined') {
    for (const el of lazy) await renderOne(el);
    return;
  }
  await new Promise<void>((resolve) => {
    let pending = lazy.length;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          io.unobserve(el);
          void renderOne(el).finally(() => {
            pending -= 1;
            if (pending <= 0) { io.disconnect(); resolve(); }
          });
        }
      },
      { rootMargin: '600px 0px' },
    );
    for (const el of lazy) io.observe(el);
  });
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
