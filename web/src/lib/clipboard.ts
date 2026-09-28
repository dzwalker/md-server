// 复制文本到剪贴板。
// 优先用异步 Clipboard API（https 或 localhost 这类安全上下文）；
// 若不可用——例如用局域网 IP 以 http 打开——降级到 execCommand，避免右键「复制」直接失效。

/** 复制成功返回 true；失败返回 false（调用方据此给用户提示）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到降级分支 */
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
