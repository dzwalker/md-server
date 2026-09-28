/**
 * 正文整篇替换时的滚动位置保持。
 *
 * 为什么需要：正文是「服务端渲染好的 HTML 整篇注入」（`doc-view.tsx` 的
 * `dangerouslySetInnerHTML`），保存笔记、外部改动刷新都会触发整篇替换。而
 * `.md-content > *` 开着 `content-visibility: auto`（`contain-intrinsic-size: auto 28px`）
 * 来跳过屏外块的布局与绘制——整篇替换会丢掉浏览器「记住的真实尺寸」，屏外块退回
 * 28px 估值，于是同一段内容在新 DOM 里的位置整体偏移（实测长文档漂移 100px+，
 * 而滚动容器的 scrollTop 没变）——用户看到的就是「保存完笔记页面跳一下」。
 *
 * 做法：替换前记下视口内第一个块的**行号**与它相对滚动容器顶部的位置，
 * 替换后把同一个逻辑块钉回原来的位置（行号位移由调用方按 op 补偿）。
 */

export interface ScrollAnchor {
  /** 块首行行号（来自服务端渲染的 data-line-start） */
  line: number;
  /** 块顶部相对滚动容器顶部的位置（px，可为负） */
  top: number;
}

function topBlocks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-line-start]'));
}

/** 视口内第一个块（锚点）；容器为空或还没注入正文时返回 null。 */
export function captureScrollAnchor(container: HTMLElement, scroller: HTMLElement): ScrollAnchor | null {
  const scrollerTop = scroller.getBoundingClientRect().top;
  for (const el of topBlocks(container)) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom - scrollerTop > 0) {
      return { line: Number(el.dataset.lineStart), top: rect.top - scrollerTop };
    }
  }
  return null;
}

/** 按行号找块：优先精确命中；行号被插入/删除改了就用它后面第一个块；兜底最后一个块。 */
export function findBlockByLine(container: HTMLElement, line: number): HTMLElement | null {
  const blocks = topBlocks(container);
  if (!blocks.length) return null;
  const exact = blocks.find((b) => Number(b.dataset.lineStart) === line);
  if (exact) return exact;
  const after = blocks.find((b) => Number(b.dataset.lineStart) > line);
  return after ?? blocks[blocks.length - 1];
}

/** 把锚点块钉回替换前的位置。返回是否执行了校正。 */
export function restoreScrollAnchor(
  container: HTMLElement,
  scroller: HTMLElement,
  anchor: ScrollAnchor,
): boolean {
  const block = findBlockByLine(container, anchor.line);
  if (!block) return false;
  const top = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const delta = top - anchor.top;
  if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
  return true;
}

/** 笔记写入导致的行号位移：插在 afterLine 之后 → 其下方的块行号 +1；删掉 line → -1。 */
export function shiftAnchorLine(
  line: number,
  op: { op: 'insert' | 'update' | 'delete'; afterLine?: number; line?: number },
): number {
  if (op.op === 'insert' && typeof op.afterLine === 'number' && line > op.afterLine) return line + 1;
  if (op.op === 'delete' && typeof op.line === 'number' && line > op.line) return line - 1;
  return line;
}
