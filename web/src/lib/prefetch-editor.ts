/**
 * 预热编辑器 chunk（Milkdown/Crepe + 主题 CSS）。
 *
 * 为什么需要：编辑器是按需动态加载的（crepe chunk 未压缩约 1MB / gzip 300KB，
 * 外加主题 CSS 与 KaTeX 字体）。如果等用户点了「编辑」再开始下载，就是
 * 「raw md 请求 → 分块渲染 → 才开始下载编辑器」的串行瀑布，体感上是长时间空白。
 *
 * 所以在页面空闲（或鼠标悬停「编辑」按钮）时先把它拉下来并执行一次，
 * 真正进编辑态时直接从 HTTP 缓存里取。
 */
let started = false;

export function prefetchEditorChunk(): void {
  if (started) return;
  started = true;
  void (async () => {
    try {
      await import('@milkdown/crepe');
      await import('@milkdown/crepe/theme/common/style.css');
      if (document.documentElement.classList.contains('dark')) {
        await import('@milkdown/crepe/theme/nord-dark.css');
      } else {
        await import('@milkdown/crepe/theme/nord.css');
      }
    } catch {
      // 预热失败就把标记复位，下次点击还能正常加载
      started = false;
    }
  })();
}
