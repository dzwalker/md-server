import { useEffect, useRef } from 'react';

interface BlockSourceEditorProps {
  /** 初始源码。之后由 CodeMirror 自己持有（受控回写会打断输入法与撤销栈）。 */
  value: string;
  /** 文档 urlPath，用于把相对图片路径改写成 /api/asset/*。 */
  docPath: string;
  autoFocus?: boolean;
  /** 点进这一块时的鼠标位置：据此放置光标。 */
  caretAt?: { x: number; y: number };
  onChange: (value: string) => void;
  /** Esc / 失焦：收起这一块的草稿（回到渲染态）。 */
  onFinish: () => void;
  onSave?: () => void;
}

function baseDirOf(urlPath: string): string {
  const i = urlPath.lastIndexOf('/');
  return i > 0 ? urlPath.slice(0, i) : '';
}

/**
 * 单块的 Markdown 源码编辑器（CodeMirror 6，按需动态加载）。
 *
 * - 组件的生命周期 = 「这一块处于编辑态」：挂载即创建编辑器，卸载即销毁；
 *   编辑过程中父组件仍会把最新源码写进 `value`，但这里**只取初始值**，否则每次按键
 *   都会重建文档、清掉撤销栈与输入法组字状态。
 * - 回调走 ref 转发，避免父组件重渲染导致编辑器被重建。
 */
export function BlockSourceEditor({
  value,
  docPath,
  autoFocus,
  caretAt,
  onChange,
  onFinish,
  onSave,
}: BlockSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onChange, onFinish, onSave });
  cbRef.current = { onChange, onFinish, onSave };
  const initialRef = useRef(value);
  const optsRef = useRef({ autoFocus, caretAt });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let destroy: (() => void) | null = null;

    void (async () => {
      // 只有进入编辑态才会加载这个 chunk（阅读路径零成本）
      const mod = await import('@/lib/md-codemirror');
      if (disposed) return;
      const mounted = mod.mountMarkdownBlock({
        parent: host,
        value: initialRef.current,
        baseDir: baseDirOf(docPath),
        autoFocus: optsRef.current.autoFocus,
        caretAt: optsRef.current.caretAt,
        onChange: (v) => cbRef.current.onChange(v),
        onFinish: () => cbRef.current.onFinish(),
        onSave: () => cbRef.current.onSave?.(),
      });
      destroy = () => mounted.destroy();
    })();

    return () => {
      disposed = true;
      destroy?.();
    };
  }, [docPath]);

  return <div ref={hostRef} className="md-block-cm" />;
}
