// 全屏 mermaid 查看器：缩放 + 平移 + 重置 + 背景切换。
// 实现对齐 ~/workspace/knowledge-base-reader-ds/src/preview/webviewContent.ts 的 lightbox。

interface MermaidLike {
  render: (id: string, code: string) => Promise<{ svg: string; bindFunctions?: (el: HTMLElement) => void }>;
}

function mermaid(): MermaidLike | undefined {
  return (window as unknown as { mermaid?: MermaidLike }).mermaid;
}

const ROOT_ID = 'mermaid-lightbox';
const STAGE_ID = 'mermaid-lightbox-stage';
const CLOSE_ID = 'mermaid-lightbox-close';
const BG_ID = 'mermaid-lightbox-bg-toggle';
const HINT_ID = 'mermaid-lightbox-hint';

interface LightboxState {
  root: HTMLElement;
  stage: HTMLElement;
  scale: number;
  x: number;
  y: number;
  dragging: boolean;
  startX: number;
  startY: number;
  pointers: Map<number, { x: number; y: number }>;
  pinchDist: number;
  pinchScale: number;
  downX: number;
  downY: number;
  downOnBackdrop: boolean;
  moved: boolean;
}

let lb: LightboxState | null = null;
let openSeq = 0;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function apply(s: LightboxState) {
  s.stage.style.transform =
    'translate(-50%, -50%) translate(' + s.x + 'px, ' + s.y + 'px) scale(' + s.scale + ')';
}

function reset(s: LightboxState) {
  s.scale = 1;
  s.x = 0;
  s.y = 0;
  apply(s);
}

function build(): LightboxState {
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const close = document.createElement('button');
  close.id = CLOSE_ID;
  close.type = 'button';
  close.innerHTML = '&times;';
  close.title = '关闭 (Esc)';

  const stage = document.createElement('div');
  stage.id = STAGE_ID;

  const bg = document.createElement('button');
  bg.id = BG_ID;
  bg.type = 'button';
  bg.innerHTML = '&#9680; 背景';
  bg.title = '切换背景';

  const hint = document.createElement('div');
  hint.id = HINT_ID;
  hint.textContent = '滚轮 / 双指缩放 · 拖拽平移 · 双击重置';

  root.append(close, stage, bg, hint);
  document.body.appendChild(root);

  const s: LightboxState = {
    root,
    stage,
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    pointers: new Map(),
    pinchDist: 0,
    pinchScale: 1,
    downX: 0,
    downY: 0,
    downOnBackdrop: false,
    moved: false,
  };

  close.addEventListener('click', closeMermaidLightbox);
  bg.addEventListener('click', (e) => {
    e.stopPropagation();
    root.classList.toggle('bg-light');
  });

  // 滚轮缩放
  root.addEventListener(
    'wheel',
    (e) => {
      if (!root.classList.contains('open')) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      s.scale = clamp(s.scale * factor, 0.2, 20);
      apply(s);
    },
    { passive: false },
  );

  // 拖拽平移 + 双指缩放（pointer 事件同时覆盖鼠标与触屏）。
  // 注意：不使用 setPointerCapture，否则 click 会被重定向到遮罩根节点，
  // 导致点 SVG 也会触发「点遮罩关闭」。
  root.addEventListener('pointerdown', (e) => {
    if (!root.classList.contains('open')) return;
    if ((e.target as HTMLElement).closest('button')) return;
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pointers.size === 1) {
      s.dragging = true;
      s.startX = e.clientX - s.x;
      s.startY = e.clientY - s.y;
      s.downX = e.clientX;
      s.downY = e.clientY;
      s.downOnBackdrop = e.target === root;
      s.moved = false;
      root.classList.add('dragging');
    } else if (s.pointers.size === 2) {
      const [a, b] = [...s.pointers.values()];
      s.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      s.pinchScale = s.scale;
      s.dragging = false;
      s.moved = true; // 双指捏合不是单击，松手不关闭
      root.classList.remove('dragging');
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!root.classList.contains('open')) return;
    if (!s.pointers.has(e.pointerId)) return;
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pointers.size === 1 && s.dragging) {
      s.x = e.clientX - s.startX;
      s.y = e.clientY - s.startY;
      if (!s.moved && Math.abs(e.clientX - s.downX) + Math.abs(e.clientY - s.downY) > 4) {
        s.moved = true;
      }
      apply(s);
    } else if (s.pointers.size === 2 && s.pinchDist > 0) {
      const [a, b] = [...s.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      s.scale = clamp(s.pinchScale * (d / s.pinchDist), 0.2, 20);
      apply(s);
    }
  });

  const finishDrag = (closeOnRelease: boolean) => (e: PointerEvent) => {
    s.pointers.delete(e.pointerId);
    if (s.pointers.size === 0) {
      // 仅在「按在遮罩空白处、且没有拖动」时关闭；点图或拖动松手都不关。
      if (closeOnRelease && !s.moved && s.downOnBackdrop) closeMermaidLightbox();
      s.dragging = false;
      root.classList.remove('dragging');
    }
    if (s.pointers.size < 2) s.pinchDist = 0;
  };
  window.addEventListener('pointerup', finishDrag(true));
  window.addEventListener('pointercancel', finishDrag(false));

  // 双击重置
  stage.addEventListener('dblclick', () => {
    if (!root.classList.contains('open')) return;
    reset(s);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('open')) closeMermaidLightbox();
  });

  return s;
}

export async function openMermaidLightbox(source: string) {
  if (!lb) lb = build();
  const s = lb;
  const token = ++openSeq;

  s.stage.innerHTML = '';
  reset(s);
  // 遮罩默认压暗；卡片底色跟随明暗主题（见 CSS .dark #mermaid-lightbox-stage），
  // 点右下角「背景」按钮可切换遮罩为浅色。
  s.root.classList.remove('bg-light');
  s.root.classList.add('open');

  const id = 'mermaid-lb-' + Math.random().toString(36).slice(2, 10);
  const m = mermaid();
  if (!m) return;

  try {
    const { svg, bindFunctions } = await m.render(id, source);
    if (token !== openSeq) return; // 已被更新的打开覆盖
    s.stage.innerHTML = svg;
    bindFunctions?.(s.stage);
    // mermaid 给 svg 加了内联 max-width，会把图锁在原始小尺寸，这里覆盖以放大到接近视口宽度
    const svgEl = s.stage.querySelector('svg');
    if (svgEl) {
      const targetW = Math.round(Math.min(window.innerWidth * 0.9, window.innerWidth - 48));
      svgEl.style.maxWidth = 'none';
      svgEl.style.width = targetW + 'px';
      svgEl.style.height = 'auto';
    }
  } catch (e) {
    const err = document.createElement('div');
    err.className = 'mermaid-error';
    const strong = document.createElement('strong');
    strong.textContent = 'Mermaid 渲染失败';
    const pre = document.createElement('pre');
    pre.textContent = e instanceof Error ? e.message : String(e);
    err.append(strong, pre);
    s.stage.innerHTML = '';
    s.stage.append(err);
  }
}

export function closeMermaidLightbox() {
  if (!lb) return;
  lb.root.classList.remove('open');
  lb.stage.innerHTML = '';
  lb.pointers.clear();
  lb.dragging = false;
  lb.root.classList.remove('dragging');
}
