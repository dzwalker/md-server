import { renderExtras } from './markdown-extras';

/**
 * 笔记保存后的**局部 DOM 替换**。
 *
 * 背景：正文是整篇 HTML 注入的，保存笔记若走「重新拉整篇 + 整篇 innerHTML 替换」，
 * 就会把全部节点重建一遍——公式退回未渲染的占位（页面上是原始 TeX）、mermaid 重画、
 * 图片重解码，肉眼看到「闪一下」（实测 242 个公式全部重渲染、替换后约 195ms 才补完）。
 *
 * 这里只做一件事：把**目标那一条笔记**的卡片换掉，其余 DOM 一个都不动。
 * 结构不符时返回 false，由调用方回退整篇重注入（并复用滚动锚点补偿）。
 */

export interface NotePatchOp {
  op: 'insert' | 'update' | 'delete';
  /** insert / update：这条笔记在**新**文件里的行号；delete：被删掉的旧行号 */
  line: number;
  /** insert：插在这一行之后（旧编号），用于给下方块重编号 */
  afterLine?: number;
}

/** 从服务端最新渲染的 HTML 里取出某条笔记卡片（脱离文档，可直接换进正文）。 */
export function extractNoteCard(html: string, line: number): HTMLElement | null {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.querySelector<HTMLElement>(`.md-note[data-note-line="${line}"]`);
}

/**
 * 行号位移：插入点之后的块 +1、删除点之后的块 -1。
 * 只写属性、不改布局，所以不会引起重排/闪烁；不重编号的话，下一次笔记操作会按错行号去写文件。
 */
function shiftLines(container: HTMLElement, afterLine: number, delta: number): void {
  const attrs: [string, string][] = [
    ['data-line-start', 'lineStart'],
    ['data-line-end', 'lineEnd'],
    ['data-note-line', 'noteLine'],
  ];
  container.querySelectorAll<HTMLElement>('[data-line-start], [data-line-end], [data-note-line]').forEach((el) => {
    for (const [attr, key] of attrs) {
      const raw = (el.dataset as Record<string, string | undefined>)[key];
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= afterLine) continue;
      el.setAttribute(attr, String(n + delta));
    }
  });
}

function findBlockByEndLine(container: HTMLElement, line?: number): HTMLElement | null {
  if (typeof line !== 'number') return null;
  return container.querySelector<HTMLElement>(`:scope > [data-line-end="${line}"]`);
}

/**
 * 把这一次笔记操作的改动落到 DOM 上（只动目标节点）。
 *
 * @param tempEl insert 场景下就地编辑器的临时卡片——它就在「锚点块之后」的同一位置，
 *               直接替换它最稳（找不到时才按 afterLine 找锚点块兜底）。
 * @returns 是否完成局部替换；false = 调用方应回退整篇重注入
 */
export async function patchNoteCard(
  container: HTMLElement,
  freshHtml: string,
  op: NotePatchOp,
  tempEl?: HTMLElement | null,
): Promise<boolean> {
  if (op.op === 'delete') {
    const live = container.querySelector<HTMLElement>(`.md-note[data-note-line="${op.line}"]`);
    if (!live) return false;
    live.remove();
    shiftLines(container, op.line, -1);
    return true;
  }

  const card = extractNoteCard(freshHtml, op.line);
  if (!card) return false;
  // 脱离文档先把卡片里的公式/图表算好，换进去即是最终形态（不会先露一下原始 TeX）。
  try {
    await renderExtras(card);
  } catch {
    /* 渲染失败也让节点换进去，正文至少是对的 */
  }

  if (op.op === 'update') {
    const live = container.querySelector<HTMLElement>(`.md-note[data-note-line="${op.line}"]`);
    if (!live) return false;
    live.replaceWith(card);
    return true;
  }

  const target = tempEl ?? findBlockByEndLine(container, op.afterLine);
  if (!target) return false;
  shiftLines(container, op.afterLine ?? 0, 1);
  target.replaceWith(card);
  return true;
}
