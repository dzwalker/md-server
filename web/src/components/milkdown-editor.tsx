import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { clearTextInCurrentBlockCommand, wrapInBlockquoteCommand } from '@milkdown/kit/preset/commonmark';
import { api } from '@/lib/api';
import { assetUrlForDoc } from '@/lib/asset-url';
import type { RichEditorHandle } from './rich-editor-types';

interface Props {
  /** 初始 markdown（只取一次；之后由 Crepe 自己持有）。 */
  value: string;
  /** 当前文档 urlPath：图片相对路径改写、上传落盘位置都靠它。 */
  docPath: string;
  onChange: (markdown: string) => void;
}

const ICON_LINK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l2.5-2.5a5 5 0 0 0-7-7L11.5 5"/><path d="M14 11a5 5 0 0 0-7.5-.5L4 13a5 5 0 0 0 7 7l1.5-1.5"/></svg>';
const ICON_NOTE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4h14v10l-6 6H5z"/><path d="M8 8h8M8 12h5"/></svg>';

/** 在光标处插入一段文本，并把光标放到指定偏移（默认末尾）。 */
function insertTextAtCursor(ctx: unknown, text: string, caretOffset?: number) {
  const view = (ctx as { get: (k: unknown) => any }).get(editorViewCtx);
  const { from, to } = view.state.selection;
  const tr = view.state.tr.insertText(text, from, to);
  const pos = from + (caretOffset ?? text.length);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos)).scrollIntoView());
  view.focus();
}

/** 清空当前块的文字（`/` 菜单触发时块里是 `/查询词`，要先清掉）。 */
function clearCurrentBlock(ctx: unknown) {
  try {
    (ctx as { get: (k: unknown) => any }).get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
  } catch {
    /* 空块时命令可能不适用，忽略 */
  }
}

/** 插入 `[[ ]]`：编辑态里它就是普通文本，保存后由服务端渲染成双链。 */
function insertWikilink(ctx: unknown, fromSlash = false) {
  if (fromSlash) clearCurrentBlock(ctx);
  insertTextAtCursor(ctx, '[[]]', 2);
}

/** 插入笔记行：先把当前块变成引用块，再写入 `note: ` 前缀（序列化后正好是 `> note: …`）。 */
function insertNoteLine(ctx: unknown, fromSlash = false) {
  if (fromSlash) clearCurrentBlock(ctx);
  const c = ctx as { get: (k: unknown) => any };
  try {
    c.get(commandsCtx).call(wrapInBlockquoteCommand.key);
  } catch {
    /* 已在引用块里就忽略 */
  }
  insertTextAtCursor(ctx, 'note: ');
}

/**
 * Milkdown **Crepe**（`@milkdown/crepe`）——官方封装好的「开箱即用」编辑器：
 * 悬浮工具栏、`/` 快捷插入、块拖拽手柄、表格、LaTeX、代码块、占位提示。
 *
 * 本文件在 Crepe 默认能力之上补了：
 * - **图片**：`proxyDomURL` 把 markdown 里的相对路径改写成 `/api/asset/*`（阅读态同一套规则），
 *   `onUpload` 走 `/api/asset/upload` 落盘到文档目录的 `assets/`，返回值是相对路径；
 * - **md-server 方言**：`/` 菜单与浮动工具栏里加了「双链 `[[ ]]`」「笔记行 `> note:`」两项；
 * - 主题：变量在 index.css 里映射到站内 `--md-*`（字体/字号/强调色/代码底色）。
 *
 * 动态加载：只有切到「Milkdown」模式才拉 chunk。保存路径是 remark 序列化，会规范化原文。
 */
export const MilkdownEditor = forwardRef<RichEditorHandle, Props>(function MilkdownEditor(
  { value, docPath, onChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const docPathRef = useRef(docPath);
  docPathRef.current = docPath;
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
        // AI 面板与顶栏先不要；其余默认特性全开
        features: {
          [CrepeFeature.AI]: false,
          [CrepeFeature.TopBar]: false,
        },
        featureConfigs: {
          // 注意：这里的 key 必须是 CrepeFeature 的枚举值（'placeholder'/'image-block'…），
          // 不是驼峰属性名，否则配置会被静默忽略。
          // 占位提示
          [CrepeFeature.Placeholder]: {
            text: '开始写…（输入 / 插入表格、公式、代码块、双链、笔记）',
            mode: 'doc',
          },
          // 数学：与阅读态一致，坏公式不抛错
          [CrepeFeature.Latex]: {
            katexOptions: { throwOnError: false, strict: 'ignore' },
          },
          // 图片：相对路径 → /api/asset；上传落到文档目录的 assets/
          [CrepeFeature.ImageBlock]: {
            proxyDomURL: (url: string) => assetUrlForDoc(docPathRef.current, url),
            onUpload: async (file: File) => {
              const r = await api.uploadImage(docPathRef.current, file);
              return r.relPath;
            },
            onImageLoadError: (event: Event) => {
              const img = event.target as HTMLImageElement | null;
              if (img) img.style.opacity = '0.35';
            },
            maxWidth: 1000,
          },
          // 代码块：按钮文案中文化（高亮配色已通过 --crepe-* 变量对齐站内主题）
          [CrepeFeature.CodeMirror]: {
            previewToggleText: (previewOnly: boolean) => (previewOnly ? '编辑' : '预览'),
          },
          // `/` 菜单：补 md-server 方言
          [CrepeFeature.BlockEdit]: {
            buildMenu: (builder: any) => {
              const group = builder.addGroup('mdserver', 'md-server');
              group.addItem('wikilink', {
                label: '双链 [[ ]]',
                icon: ICON_LINK,
                onRun: (ctx: unknown) => insertWikilink(ctx, true),
              });
              group.addItem('note', {
                label: '笔记行 > note:',
                icon: ICON_NOTE,
                onRun: (ctx: unknown) => insertNoteLine(ctx, true),
              });
            },
          },
          // 选中文字的浮动工具栏：补两个按钮
          [CrepeFeature.Toolbar]: {
            buildToolbar: (builder: any) => {
              const group = builder.getGroup('formatting');
              group?.addItem('wikilink', {
                label: '双链',
                icon: ICON_LINK,
                active: () => false,
                onRun: (ctx: unknown) => insertWikilink(ctx),
              });
              group?.addItem('note', {
                label: '笔记行',
                icon: ICON_NOTE,
                active: () => false,
                onRun: (ctx: unknown) => insertNoteLine(ctx),
              });
            },
          },
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
      // 卸载前先把最新 markdown 交回上层（content-change 是异步的）
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
