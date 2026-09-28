/**
 * 正文里的笔记交互：右键定位 + 就地（inline）编辑。
 *
 * 为什么是命令式 DOM 而不是 React 组件：正文是服务端渲染好的 HTML，经
 * `dangerouslySetInnerHTML` 一次性注入（`doc-view.tsx`），无法在里面挂 React 组件树。
 * 所以这里沿用项目既有的命令式风格（见 `markdown-extras.ts` / `mermaid-lightbox.ts`）：
 * 在正文 DOM 里就地插入编辑器，保存后由 `api.render` 重新注入整篇正文，编辑器自然消失。
 *
 * 服务端渲染出的两个关键锚点（见 `src/render.ts`）：
 *   - `.md-note[data-note-line][data-note-raw]`：一条已存在的笔记（行号 + 原始 markdown）
 *   - `[data-line-start][data-line-end]`：任意顶层块的首末行号，「插在它之后的一行」
 */

export interface NoteMenuTarget {
  kind: 'note';
  /** 笔记所在行号（1-based） */
  line: number;
  /** 笔记正文的原始 markdown（编辑器初值） */
  raw: string;
  el: HTMLElement;
  x: number;
  y: number;
}

export interface InsertMenuTarget {
  kind: 'insert';
  /** 插在这一行之后（1-based） */
  afterLine: number;
  /** 定位到的顶层块（用于把新笔记插在它后面）；null = 正文末尾 */
  anchor: HTMLElement | null;
  x: number;
  y: number;
}

export type NoteContextTarget = NoteMenuTarget | InsertMenuTarget;

/** 正文里最后一个块的行号：兜底插入位置（例如右键落在没有行号锚点的数学块上）。 */
export function lastBlockEnd(container: HTMLElement): number {
  let max = 0;
  container.querySelectorAll<HTMLElement>('[data-line-end]').forEach((el) => {
    const n = Number(el.dataset.lineEnd || 0);
    if (n > max) max = n;
  });
  return max;
}

/** 把一次右键事件解析成「编辑已有笔记」或「插入新笔记」的目标。 */
export function resolveNoteContext(container: HTMLElement, event: MouseEvent): NoteContextTarget {
  const x = event.clientX;
  const y = event.clientY;
  const target = event.target as HTMLElement | null;
  const noteEl = target?.closest?.('.md-note') as HTMLElement | null;
  if (noteEl) {
    const line = Number(noteEl.dataset.noteLine || 0);
    // 正在编辑中的临时卡片没有行号 → 当作普通块，走插入分支
    if (line > 0) {
      return { kind: 'note', line, raw: noteEl.dataset.noteRaw ?? '', el: noteEl, x, y };
    }
  }
  const block = (target?.closest?.('[data-line-end]') as HTMLElement | null) ?? null;
  const afterLine = block ? Number(block.dataset.lineEnd || 0) : 0;
  return { kind: 'insert', afterLine: afterLine || lastBlockEnd(container), anchor: block, x, y };
}

interface MountOptions {
  /** 编辑器初值（已有笔记的原文 / 新笔记为空） */
  text: string;
  onSave: (text: string) => Promise<void>;
  /** 取消或保存完成后的 DOM 复原动作 */
  restore: () => void;
}

/** 同一时刻只允许一个就地编辑器；打开新的会自动取消旧的（并复原它的 DOM）。 */
let activeCancel: (() => void) | null = null;

export function closeActiveNoteEditor(): void {
  const cancel = activeCancel;
  activeCancel = null;
  cancel?.();
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg || '保存失败';
}

function mountEditor(host: HTMLElement, opts: MountOptions): void {
  closeActiveNoteEditor();

  const wrap = document.createElement('div');
  wrap.className = 'md-note-editor';
  wrap.innerHTML =
    '<textarea class="md-note-input" rows="1" spellcheck="false"></textarea>' +
    '<div class="md-note-actions">' +
    '<span class="md-note-error"></span>' +
    '<button type="button" class="md-note-btn md-note-btn-primary" data-act="save">保存</button>' +
    '<button type="button" class="md-note-btn" data-act="cancel">取消</button>' +
    '</div>';

  const ta = wrap.querySelector('textarea') as HTMLTextAreaElement;
  const errEl = wrap.querySelector('.md-note-error') as HTMLElement;
  const saveBtn = wrap.querySelector('[data-act="save"]') as HTMLButtonElement;
  const cancelBtn = wrap.querySelector('[data-act="cancel"]') as HTMLButtonElement;

  let closed = false;
  let saving = false;

  const autosize = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  };

  function teardown() {
    if (closed) return;
    closed = true;
    if (activeCancel === cancel) activeCancel = null;
    wrap.remove();
    opts.restore();
  }

  function cancel() {
    teardown();
  }

  async function save() {
    if (saving || closed) return;
    const text = ta.value.trim();
    if (!text) {
      errEl.textContent = '笔记内容不能为空';
      ta.focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    errEl.textContent = '';
    try {
      await opts.onSave(text);
      teardown();
    } catch (e) {
      saving = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = '保存';
      errEl.textContent = errorText(e);
      ta.focus();
    }
  }

  ta.value = opts.text;
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => {
    // 中文输入法组字过程中的 Enter/Esc 不算提交/取消
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  });
  saveBtn.addEventListener('click', () => void save());
  cancelBtn.addEventListener('click', cancel);

  host.appendChild(wrap);
  autosize();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  activeCancel = cancel;
}

/**
 * 插入一条新笔记：先在锚点块之后就地位放一张临时卡片（此时**不写文件**），
 * 保存才落盘；取消直接丢弃。
 */
export function startInsertEditor(
  container: HTMLElement,
  anchor: HTMLElement | null,
  onSave: (text: string) => Promise<void>,
): void {
  const block = document.createElement('div');
  block.className = 'md-note md-note-editing';
  const label = document.createElement('div');
  label.className = 'md-note-label';
  label.textContent = '笔记';
  block.appendChild(label);

  const restore = () => block.remove();
  if (anchor && anchor.parentElement) anchor.insertAdjacentElement('afterend', block);
  else container.appendChild(block);

  mountEditor(block, { text: '', onSave, restore });
}

/** 编辑一条已有笔记：就地隐藏原正文、换成编辑器。 */
export function startNoteEditor(
  noteEl: HTMLElement,
  raw: string,
  onSave: (text: string) => Promise<void>,
): void {
  const body = noteEl.querySelector('.md-note-body') as HTMLElement | null;
  if (body) body.style.display = 'none';
  noteEl.classList.add('md-note-editing');
  mountEditor(noteEl, {
    text: raw,
    onSave,
    restore: () => {
      if (body) body.style.display = '';
      noteEl.classList.remove('md-note-editing');
    },
  });
}
