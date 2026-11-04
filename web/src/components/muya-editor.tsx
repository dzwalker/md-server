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

    void (async () => {
      // 编辑器本体与样式都按需加载
      const mod = (await import('@muyajs/core')) as unknown as { Muya: any };
      await import('@muyajs/core/lib/core.css');
      if (!alive) return;
      const muya = new mod.Muya(host, {
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
      muya.on('content-change', () => {
        try {
          cbRef.current(muya.getMarkdown());
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
      try {
        const m = muyaRef.current as unknown as { destroy?: () => void } | null;
        m?.destroy?.();
      } catch {
        /* ignore */
      }
      muyaRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="md-rich md-rich-muya" />;
});
