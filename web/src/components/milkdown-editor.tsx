import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { RichEditorHandle } from './rich-editor-types';

interface Props {
  /** 初始 markdown（只取一次；之后由 Crepe 自己持有）。 */
  value: string;
  onChange: (markdown: string) => void;
}

/**
 * Milkdown **Crepe**（`@milkdown/crepe`）——Milkdown 官方封装好的「开箱即用」编辑器：
 * 自带悬浮工具栏、`/` 快捷插入、块拖拽手柄、表格操作、LaTeX、代码块、占位提示。
 *
 * 相比自己用 `@milkdown/kit` 拼装（commonmark + gfm + 主题），Crepe 几乎不用集成工作，
 * 更适合「先看富文本手感」；代价与所有 WYSIWYG 一样：保存路径是 remark 序列化，
 * 会把 markdown 规范化（强调符、列表符号、空行、转义），不适合逐字保真的笔记库。
 *
 * 动态加载：只有切到「Milkdown」模式才拉 chunk。
 */
export const MilkdownEditor = forwardRef<RichEditorHandle, Props>(function MilkdownEditor({ value, onChange }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const crepeRef = useRef<{ getMarkdown: () => string; destroy: () => Promise<unknown> } | null>(null);
  const initialRef = useRef(value);

  useImperativeHandle(
    ref,
    () => ({
      flush: () => {
        try {
          return crepeRef.current?.getMarkdown() ?? initialRef.current;
        } catch {
          return initialRef.current;
        }
      },
      focus: () => {
        hostRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      const { Crepe, CrepeFeature } = await import('@milkdown/crepe');
      await import('@milkdown/crepe/theme/common/style.css');
      if (document.documentElement.classList.contains('dark')) {
        await import('@milkdown/crepe/theme/nord-dark.css');
      } else {
        await import('@milkdown/crepe/theme/nord.css');
      }
      if (!alive) return;

      const crepe = new (Crepe as any)({
        root: host,
        defaultValue: initialRef.current,
        // AI 面板与顶栏先不要；其余默认特性（工具栏 / 块手柄 / 表格 / LaTeX / 代码块 / 占位）全开
        features: {
          [CrepeFeature.AI]: false,
          [CrepeFeature.TopBar]: false,
        },
      });
      // 与 Muya 同理：内容没变（还是初始 markdown）就不往上层报
      crepe.on((listener: any) => {
        listener.markdownUpdated((_ctx: unknown, markdown: string) => {
          if (markdown === initialRef.current) return;
          cbRef.current(markdown);
        });
      });
      await crepe.create();
      crepeRef.current = crepe as unknown as typeof crepeRef.current;
    })().catch((e) => {
      console.error('Milkdown(Crepe) 初始化失败：', e);
    });

    return () => {
      alive = false;
      // 卸载前先把最新 markdown 交回上层：Muya/Crepe 的 content-change 是异步的，
      // 只靠事件会在「切走模式」时丢掉最后几次输入。
      try {
        const md = crepeRef.current?.getMarkdown?.();
        if (typeof md === 'string') cbRef.current(md);
      } catch {
        /* ignore */
      }
      try {
        void crepeRef.current?.destroy();
      } catch {
        /* ignore */
      }
      crepeRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="md-rich md-rich-milkdown" />;
});
