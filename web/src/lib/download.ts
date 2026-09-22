// 浏览器端文件下载：把内存里的内容存成本地文件。
// mermaid 图导出（SVG/PNG/JPG）与「下载 md 原文件」都走这里。

/**
 * 文件名清洗：去掉路径分隔符与 Windows 非法字符，避免浏览器把名字截断或存不下来。
 * 不做大小写/空格等美化，尽量保留原文件名。
 */
export function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || 'download';
}

/** 触发一次浏览器下载。 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
