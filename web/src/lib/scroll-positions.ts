/**
 * 每篇文档的阅读位置（切 tab / 刷新 / 切空间集回来时恢复）。
 *
 * 为什么需要：正文滚动容器（`doc-view.tsx` 的 `contentAreaRef`）是**所有文档共用**的一个，
 * 切 tab 时只换里面的 HTML，scrollTop 却留在上一刻的值上（上一篇文档里的位置，或被新文档
 * 的高度截断到 0）→ 用户看到的就是「切回来位置丢了」。
 *
 * 存哪儿：与「已打开文档」同构、同槽位地按空间 set 分槽（`md-scroll-pos-by-set`），
 * 这样切 set 再切回来，位置跟着该 set 的 tab 一起恢复；刷新后也还在。
 * 单独一个键是为了避免和 `md-open-tabs-by-set` 的写路径互相覆盖（那边是 reducer
 * 状态变化就整槽重写，这边是滚动过程中高频写）。
 *
 * 存什么：scrollTop 兜底 + 「视口内第一个块的行号与它相对容器顶部的位置」做精确锚点。
 * 为什么不能只存 scrollTop：正文块开着 `content-visibility: auto`（屏外块按 28px 估值），
 * 重新注入 / 重新挂载后同一段内容的总高会变，纯像素位置会漂（见 lib/scroll-anchor.ts）。
 */

import { captureScrollAnchor, findBlockByLine, restoreScrollAnchor } from '@/lib/scroll-anchor';

export interface DocScrollPos {
  /** 滚动容器的 scrollTop（px），锚点失效时的兜底 */
  top: number;
  /** 视口内第一个块的行号（服务端渲染的 data-line-start） */
  line?: number;
  /** 该块顶部相对滚动容器顶部的位置（px，可为负） */
  offset?: number;
}

const STORAGE_KEY = 'md-scroll-pos-by-set';
/** 每个 set 最多记多少篇（LRU 淘汰，避免 localStorage 无限长） */
const MAX_PER_SET = 300;
/** 滚动过程中落盘的去抖时长（与 tab/树展开状态的 300ms 量级一致） */
const WRITE_DEBOUNCE_MS = 300;

type PosMap = Record<string, Record<string, DocScrollPos>>;

let cache: PosMap | null = null;
let writeTimer: number | null = null;

function sanitizePos(raw: unknown): DocScrollPos | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<DocScrollPos>;
  if (typeof p.top !== 'number' || !Number.isFinite(p.top) || p.top < 0) return null;
  const pos: DocScrollPos = { top: Math.round(p.top) };
  if (typeof p.line === 'number' && Number.isFinite(p.line)) pos.line = p.line;
  if (typeof p.offset === 'number' && Number.isFinite(p.offset)) pos.offset = p.offset;
  return pos;
}

function load(): PosMap {
  if (cache) return cache;
  const out: PosMap = {};
  cache = out;
  if (typeof localStorage === 'undefined') return out;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [setId, slot] of Object.entries(parsed || {})) {
      if (!slot || typeof slot !== 'object') continue;
      const entries: Record<string, DocScrollPos> = {};
      for (const [path, pos] of Object.entries(slot as Record<string, unknown>)) {
        const clean = sanitizePos(pos);
        if (clean) entries[path] = clean;
      }
      if (Object.keys(entries).length > 0) out[setId] = entries;
    }
  } catch {
    /* 坏数据当空处理 */
  }
  return out;
}

/** 立刻把内存里的位置落盘（页面隐藏 / 卸载前调用，别等去抖计时器）。 */
export function flushScrollPositions() {
  if (writeTimer !== null) {
    window.clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!cache || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* 配额满等：不影响阅读 */
  }
}

function scheduleWrite() {
  if (typeof window === 'undefined') return;
  if (writeTimer !== null) return;
  writeTimer = window.setTimeout(() => {
    writeTimer = null;
    flushScrollPositions();
  }, WRITE_DEBOUNCE_MS);
}

/** 取某篇文档上次的阅读位置；没有记录返回 null。 */
export function getScrollPos(setId: string, path: string): DocScrollPos | null {
  if (!setId || !path) return null;
  return load()[setId]?.[path] ?? null;
}

/** 记下某篇文档的阅读位置（内存即时生效，localStorage 去抖落盘）。 */
export function setScrollPos(setId: string, path: string, pos: DocScrollPos) {
  if (!setId || !path) return;
  const clean = sanitizePos(pos);
  if (!clean) return;
  const map = load();
  const slot = map[setId] ?? (map[setId] = {});
  const prev = slot[path];
  if (prev && prev.top === clean.top && prev.line === clean.line && prev.offset === clean.offset) return;
  // 重新 set 一次维持「最近用过」的插入顺序（对象保持插入顺序，够做 LRU）
  delete slot[path];
  slot[path] = clean;
  const keys = Object.keys(slot);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PER_SET))) delete slot[k];
  scheduleWrite();
}

/** 关掉某篇文档的 tab 时丢掉它的位置（再打开就是从头读）。 */
export function forgetScrollPos(setId: string, path: string) {
  if (!setId || !path) return;
  const slot = load()[setId];
  if (!slot || !(path in slot)) return;
  delete slot[path];
  if (Object.keys(slot).length === 0) delete load()[setId];
  scheduleWrite();
}

/** 文档改名：位置跟着新路径走。 */
export function migrateScrollPos(setId: string, from: string, to: string) {
  if (!setId || !from || !to || from === to) return;
  const slot = load()[setId];
  const pos = slot?.[from];
  if (!slot || !pos) return;
  delete slot[from];
  slot[to] = pos;
  scheduleWrite();
}

/** 读当前滚动容器 + 正文容器的位置（滚动监听、切走前各调一次）。 */
export function readScrollPos(container: HTMLElement, scroller: HTMLElement): DocScrollPos {
  const anchor = captureScrollAnchor(container, scroller);
  return anchor
    ? { top: Math.round(scroller.scrollTop), line: anchor.line, offset: anchor.top }
    : { top: Math.round(scroller.scrollTop) };
}

/**
 * 把滚动容器恢复到记录的位置：行号锚点优先（抗 content-visibility 估值漂移），
 * scrollTop 兜底。返回是否用上了锚点。
 */
export function applyScrollPos(
  container: HTMLElement,
  scroller: HTMLElement,
  pos: DocScrollPos,
): boolean {
  if (typeof pos.line === 'number' && typeof pos.offset === 'number') {
    const ok = restoreScrollAnchor(container, scroller, { line: pos.line, top: pos.offset });
    if (ok) return true;
  }
  scroller.scrollTop = Math.max(0, pos.top);
  return false;
}

/**
 * 恢复位置 / 对齐某个元素到容器顶部时，**连续几帧校准到稳定**。
 *
 * 为什么不能只定一次：正文块开着 `content-visibility: auto`，刚注入时视口外的块还是
 * 估值高度；浏览器随后把真实高度补进来（scroll anchoring 还会顺手挪 scrollTop），
 * 一次定位落地后实测长文档仍会偏几百 px。这里每帧重新量一次目标位置差并补上，
 * 直到连续两帧 scrollTop 不再变化（一般几十帧内收敛），命中失败或用户开始滚动就收手。
 *
 * `isCurrent` 由调用方提供：切了文档 / 进了编辑态就该立刻停手，别把旧锚点套到新正文上。
 */
function runSettleLoop(
  scroller: HTMLElement,
  measureDelta: () => number | null,
  isCurrent: () => boolean,
  maxFrames = 45,
): void {
  let frames = 0;
  let stable = 0;
  let last = Number.NaN;
  let stopped = false;

  const onUserScroll = () => {
    stopped = true;
  };
  const stopListening = () => {
    scroller.removeEventListener('wheel', onUserScroll);
    scroller.removeEventListener('touchstart', onUserScroll);
    scroller.removeEventListener('pointerdown', onUserScroll);
    scroller.removeEventListener('keydown', onUserScroll);
  };
  scroller.addEventListener('wheel', onUserScroll, { passive: true });
  scroller.addEventListener('touchstart', onUserScroll, { passive: true });
  scroller.addEventListener('pointerdown', onUserScroll, { passive: true });
  scroller.addEventListener('keydown', onUserScroll);

  const tick = () => {
    if (stopped || !isCurrent() || !scroller.isConnected) {
      stopListening();
      return;
    }
    const delta = measureDelta();
    if (delta !== null && Math.abs(delta) >= 1) scroller.scrollTop += delta;
    const top = scroller.scrollTop;
    stable = Math.abs(top - last) <= 1 ? stable + 1 : 0;
    last = top;
    frames += 1;
    // 连续两帧稳定（≈33ms）就认为收敛；上限 45 帧（≈0.75s）兜底，不长时间跟用户抢滚动。
    if (stable < 2 && frames < maxFrames) {
      requestAnimationFrame(tick);
    } else {
      stopListening();
    }
  };
  requestAnimationFrame(tick);
}

/** 恢复某篇文档的阅读位置（粗定位 + 逐帧校准到稳定）。 */
export function settleScrollPos(
  container: HTMLElement,
  scroller: HTMLElement,
  pos: DocScrollPos,
  isCurrent: () => boolean,
): void {
  // 粗定位：就算没有锚点，也先到大致位置，避免从旧文档的位置开始找。
  scroller.scrollTop = Math.max(0, pos.top);
  if (typeof pos.line !== 'number' || typeof pos.offset !== 'number') return;
  const target = { line: pos.line, top: pos.offset };
  runSettleLoop(
    scroller,
    () => {
      const block = findBlockByLine(container, target.line);
      if (!block) return null;
      return block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - target.top;
    },
    isCurrent,
  );
}

/**
 * 把某个元素钉在滚动容器顶部（带锚点跳转双链 / 目录 / 笔记时用）。
 * 与位置恢复同样的问题：跳一次之后屏外块的估值高度补齐会把落点顶偏，所以也要校准到稳定。
 */
export function settleElementTop(
  target: HTMLElement,
  scroller: HTMLElement,
  isCurrent: () => boolean,
): void {
  runSettleLoop(
    scroller,
    () => target.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    isCurrent,
  );
}
