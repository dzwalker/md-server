import { renderExtras } from './markdown-extras';
import type { GlossaryPayload, GlossaryTermInfo } from './types';

/**
 * 术语浮层（见 specs/glossary/）。
 *
 * 正文里命中的术语由服务端渲染成
 * `<span class="glossary-term" data-glossary="规范化名字">`，定义放在
 * `/api/render` 响应里（`glossary.terms`）。这里只负责：
 * - 事件委托：鼠标悬浮（以及触屏点击）打开浮层，移出/滚动/Esc/点空白关闭；
 * - 浮层定位：优先在词下方，空间不够翻到上方，左右夹在视口内；
 * - 内容渲染：名字 + 前 N 条定义 + 来源文件名。
 *
 * 正文是命令式注入/局部替换的（doc-view.tsx），所以监听绑在常驻的 `.md-content` 容器上，
 * 不随正文替换重新绑定。
 */

const HIDE_DELAY_MS = 140;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

let tipEl: HTMLElement | null = null;
let hideTimer: number | null = null;

function ensureTip(): HTMLElement {
  if (tipEl) return tipEl;
  const el = document.createElement('div');
  el.className = 'glossary-tip';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '术语解释');
  el.addEventListener('mouseenter', () => cancelHide());
  el.addEventListener('mouseleave', () => scheduleHide());
  document.body.appendChild(el);
  tipEl = el;
  return el;
}

function cancelHide(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(): void {
  cancelHide();
  hideTimer = window.setTimeout(() => hideGlossaryTip(), HIDE_DELAY_MS);
}

/** 关掉浮层（切文档、点空白等场景也公开给调用方）。 */
export function hideGlossaryTip(): void {
  cancelHide();
  if (!tipEl) return;
  tipEl.classList.remove('is-open');
  tipEl.replaceChildren();
}

function renderTip(info: GlossaryTermInfo): void {
  const tip = ensureTip();
  tip.replaceChildren();

  const head = document.createElement('div');
  head.className = 'glossary-tip-names';
  head.textContent = info.names.join(' · ');
  tip.appendChild(head);

  info.defs.forEach((def, index) => {
    if (index > 0) {
      const sep = document.createElement('div');
      sep.className = 'glossary-tip-sep';
      tip.appendChild(sep);
    }
    const body = document.createElement('div');
    body.className = 'glossary-tip-md';
    // 定义由服务端用同一套 markdown-it 渲染，与正文同信任级别。
    body.innerHTML = def.html;
    tip.appendChild(body);
    // 定义里可能有公式：复用正文的二次渲染（没有公式时会立即返回）。
    if (body.querySelector('.katex-math, .katex-block')) void renderExtras(body);

    const source = document.createElement('div');
    source.className = 'glossary-tip-source';
    source.textContent = `— ${def.source}`;
    tip.appendChild(source);
  });

  if (info.total > info.defs.length) {
    const more = document.createElement('div');
    more.className = 'glossary-tip-more';
    more.textContent = `共 ${info.total} 条定义，仅显示前 ${info.defs.length} 条`;
    tip.appendChild(more);
  }
}

/** 把浮层放在词附近：下方优先，不够翻到上方；左右不越出视口。 */
function positionTip(anchor: HTMLElement): void {
  const tip = ensureTip();
  tip.classList.add('is-open');
  tip.style.visibility = 'hidden';

  const rect = anchor.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  let top = rect.bottom + GAP;
  if (top + box.height > window.innerHeight - VIEWPORT_MARGIN) {
    top = Math.max(VIEWPORT_MARGIN, rect.top - box.height - GAP);
  }
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - box.width - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), maxLeft);

  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.visibility = 'visible';
}

function showTip(anchor: HTMLElement, payload: GlossaryPayload | null | undefined): void {
  const key = anchor.dataset.glossary || '';
  const info = key ? payload?.terms?.[key] : undefined;
  if (!info || !info.defs.length) return;
  cancelHide();
  renderTip(info);
  positionTip(anchor);
}

/**
 * 在正文容器上绑定术语浮层（事件委托）。
 *
 * @param container 常驻的 `.md-content` 元素
 * @param getPayload 返回当前渲染响应的 glossary（正文重渲染后自动是新值）
 */
export function bindGlossaryTooltip(
  container: HTMLElement,
  getPayload: () => GlossaryPayload | null | undefined,
): () => void {
  const termOf = (node: EventTarget | null): HTMLElement | null => {
    const el = node as HTMLElement | null;
    const term = el?.closest?.('.glossary-term') as HTMLElement | null;
    return term && container.contains(term) ? term : null;
  };

  const onOver = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const term = termOf(target);
    if (term) {
      showTip(term, getPayload());
      return;
    }
    if (target && tipEl?.contains(target)) return; // 移到浮层上：保持
    scheduleHide();
  };

  const onClick = (event: MouseEvent) => {
    // 触屏没有 hover：点术语也能打开浮层。
    const term = termOf(event.target);
    if (term) {
      showTip(term, getPayload());
      return;
    }
    if (event.target && tipEl?.contains(event.target as Node)) return;
    hideGlossaryTip();
  };

  const onLeave = () => scheduleHide();

  const onScroll = (event: Event) => {
    const target = event.target as Node | null;
    if (target && tipEl?.contains(target)) return; // 浮层内部滚动不关
    hideGlossaryTip();
  };

  const onResize = () => hideGlossaryTip();
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hideGlossaryTip();
  };

  container.addEventListener('mouseover', onOver);
  container.addEventListener('click', onClick);
  container.addEventListener('mouseleave', onLeave);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);

  return () => {
    container.removeEventListener('mouseover', onOver);
    container.removeEventListener('click', onClick);
    container.removeEventListener('mouseleave', onLeave);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    hideGlossaryTip();
  };
}
