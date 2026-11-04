/** 富文本编辑器（Muya / Milkdown）统一句柄：保存前同步取一次最新 markdown。 */
export interface RichEditorHandle {
  /** 同步读取当前 markdown（绕过防抖，保存时用）。 */
  flush: () => string;
  focus: () => void;
}

export type EditorMode = 'blocks' | 'source' | 'muya' | 'milkdown';

/** 编辑器切换按钮的顺序与文案（文档头用）。 */
export const EDITOR_MODES: { id: EditorMode; label: string; title: string }[] = [
  { id: 'blocks', label: '分块', title: '分块编辑：空闲块显示渲染结果，点进去按源码编辑（CodeMirror）' },
  { id: 'source', label: '源码', title: '整篇源码：一个文本框，无格式装饰' },
  { id: 'muya', label: 'Muya', title: 'Muya（MarkText 内核）：块级富文本，Markdown 会经 turndown 反序列化' },
  { id: 'milkdown', label: 'Milkdown', title: 'Milkdown（ProseMirror）：WYSIWYG，Markdown 会经 remark 序列化' },
];
