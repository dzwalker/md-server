import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { RichEditorHandle } from './rich-editor-types';

interface Props {
  /** 初始 markdown（只取一次；之后由 Muya 自己持有）。 */
  value: string;
  onChange: (markdown: string) => void;
}

/**
 * Muya 编辑器（MarkText 的编辑器内核，`@muyajs/core`）。
 *
 * **动态加载**：只有切到「Muya」模式才会拉这个 chunk（含 mermaid/vega/prism，体积很大）。
 * 注意：Muya 的保存路径是 `turndown`（HTML → Markdown），会重排列表符号、强调符、空行与转义，
 * 因此这个模式是「试用/对照」用，保存会改写原文（代价见 specs/doc-editing/plan.md）。
 */
export const MuyaEditor = forwardRef<RichEditorHandle, Props>(function MuyaEditor({ value, onChange }, ref) {
  // 注意：Muya 的构造函数会把传入的元素 **replaceWith 成它自己的 div**（见 muya 的 Sb()），
  // 所以绝不能把 React 直接管理的节点交给它——否则组件卸载时 React 会对一个"已经不在
  // DOM 里的旧节点"执行 removeChild，抛 NotFoundError。这里给一层 React 稳定的 wrapper，
  // 由 wrapper 内部自建挂载点交给 Muya，卸载时 React 只移除 wrapper。
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const muyaRef = useRef<{ getMarkdown: () => string; focus: () => void } | null>(null);
  const initialRef = useRef(value);

  useImperativeHandle(
    ref,
    () => ({
      flush: () => {
        try {
          return muyaRef.current?.getMarkdown() ?? initialRef.current;
        } catch {
          return initialRef.current;
        }
      },
      focus: () => muyaRef.current?.focus?.(),
    }),
    [],
  );

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;

    // Muya 会替换掉这个挂载点（replaceWith），它不属于 React 的节点树
    const mount = document.createElement('div');
    mount.className = 'md-muya-mount';
    host.appendChild(mount);

    void (async () => {
      // 编辑器本体与样式都按需加载
      const mod = (await import('@muyajs/core')) as unknown as { Muya: any };
      await import('@muyajs/core/lib/core.css');
      if (!alive) return;
      const muya = new mod.Muya(mount, {
        fontSize: 15,
        lineHeight: 1.7,
        frontMatter: true,
        footnote: true,
        math: true,
        autoPairBracket: true,
        autoPairMarkdownSyntax: true,
        autoPairQuote: true,
        spellcheckEnabled: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        preferLooseListItem: false,
        bulletListMarker: '-',
        orderListDelimiter: '.',
      });
      muya.init();
      muya.setContent(initialRef.current);
      // Muya 只在用户输入时发 content-change（setContent 不发）。这里与初始 markdown 比较：
      // 内容没变就不往上层报，避免「只是切了个编辑器」被标成未保存。
      muya.on('content-change', () => {
        try {
          const md = muya.getMarkdown();
          if (md === initialRef.current) return;
          cbRef.current(md);
        } catch {
          /* 读取失败不影响编辑 */
        }
      });
      muyaRef.current = muya;
    })().catch((e) => {
      console.error('Muya 初始化失败：', e);
    });

    return () => {
      alive = false;
      // 卸载前先把最新 markdown 交回上层：Muya/Crepe 的 content-change 是异步的，
      // 只靠事件会在「切走模式」时丢掉最后几次输入。
      try {
        const md = muyaRef.current?.getMarkdown?.();
        if (typeof md === 'string') cbRef.current(md);
      } catch {
        /* ignore */
      }
      try {
        const m = muyaRef.current as unknown as { destroy?: () => void } | null;
        m?.destroy?.();
      } catch {
        /* ignore：卸载期间 Muya 内部可能已在操作已被移除的节点 */
      }
      muyaRef.current = null;
      // 兜底：Muya 没清干净的残留节点自己收掉（wrapper 马上会被 React 移除）
      try {
        mount.remove();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return <div ref={hostRef} className="md-rich md-rich-muya" />;
});
