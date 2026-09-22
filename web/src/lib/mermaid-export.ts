// mermaid 图导出：SVG（矢量）/ PNG / JPG（位图）。
//
// 两个必须绕开的浏览器坑：
// 1) SVG 是 XML，必须用 XMLSerializer 序列化。outerHTML 走的是 HTML 序列化，
//    foreignObject 里的 <br> 等空元素不会自闭合（输出 <br> 而非 <br/>），
//    导出的 .svg 用 XML 解析器打开会直接报
//    "Opening and ending tag mismatch: br ... and p"。
// 2) mermaid 默认把标签渲染进 foreignObject 的 HTML 里；含 foreignObject 的 SVG
//    一旦画进 canvas，浏览器会污染画布，toBlob 抛 SecurityError。
//    所以位图导出要先用 htmlLabels:false 重新渲染一版纯 <text> 的图。

import { downloadBlob } from './download';

interface MermaidLike {
  render: (id: string, code: string) => Promise<{ svg: string; bindFunctions?: (el: HTMLElement) => void }>;
}

function mermaid(): MermaidLike | undefined {
  return (window as unknown as { mermaid?: MermaidLike }).mermaid;
}

/** 位图导出用的渲染指令：强制 mermaid 用原生 <text> 而非 foreignObject HTML 渲染标签。 */
const RASTER_DIRECTIVE = '%%{init: {"htmlLabels": false}}%%\n';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** 位图尺寸上限（像素），超过则降倍，避免触发浏览器 canvas 尺寸限制。 */
const MAX_RASTER_SIDE = 8000;

export type RasterFormat = 'png' | 'jpg';

function svgSize(svgEl: SVGSVGElement): { width: number; height: number } {
  const vb = (svgEl.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  const rect = svgEl.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

function serializeSvg(svgEl: SVGSVGElement, fixedSize: boolean): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', XLINK_NS);
  // mermaid 在根节点写了 max-width，把图锁在正文里的原始尺寸；导出文件没有正文容器
  // 约束，去掉它让 width="100%" + viewBox 自适应放大。
  clone.style.removeProperty('max-width');
  if (!clone.getAttribute('style')) clone.removeAttribute('style');
  if (fixedSize) {
    const { width, height } = svgSize(svgEl);
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

/** 位图底色：跟随当前明暗主题的页面背景，避免浅色文字落在透明底上看不清。 */
function resolveBackground(): string {
  const nodes: Element[] = [document.body, document.documentElement];
  for (const el of nodes) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(bg)) return bg;
  }
  return '#ffffff';
}

/** 导出矢量 SVG（与正文所见一致，标签仍是 foreignObject HTML）。 */
export function exportMermaidSvg(container: HTMLElement, name: string) {
  const svgEl = container.querySelector('svg');
  if (!svgEl) return;
  const data = serializeSvg(svgEl, false);
  downloadBlob(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }), name + '.svg');
}

/**
 * 导出位图。返回 false 表示该图无法光栅化（源码自带 directive 覆盖了 htmlLabels，
 * 仍会渲染出 foreignObject），调用方可据此提示用户改用 SVG。
 */
export async function exportMermaidRaster(source: string, name: string, format: RasterFormat): Promise<boolean> {
  const m = mermaid();
  if (!m) return false;

  const id = 'mermaid-raster-' + Math.random().toString(36).slice(2, 10);
  const { svg } = await m.render(id, RASTER_DIRECTIVE + source);
  if (svg.includes('foreignObject')) return false;

  const holder = document.createElement('div');
  holder.innerHTML = svg;
  const svgEl = holder.querySelector('svg');
  if (!svgEl) return false;

  const { width, height } = svgSize(svgEl);
  // 默认 2 倍（文字更锐），超大图自动降倍以避开 canvas 尺寸上限。
  const scale = Math.min(2, MAX_RASTER_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  // PNG / JPG 都铺底色：JPG 没有透明通道，PNG 也需要底色才能保证深色主题下的可读性。
  ctx.fillStyle = resolveBackground();
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const url = URL.createObjectURL(new Blob([serializeSvg(svgEl, true)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 载入失败'));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpg' ? 0.92 : undefined),
    );
    if (!blob) return false;
    downloadBlob(blob, name + '.' + format);
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}
