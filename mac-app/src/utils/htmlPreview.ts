export function getLocalFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${prefixed.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function getHtmlPreviewSrcDoc(html: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const directoryPath = normalized.includes('/')
    ? normalized.slice(0, normalized.lastIndexOf('/') + 1)
    : '/';
  const baseTag = `<base href="${escapeHtmlAttribute(getLocalFileUrl(directoryPath))}">`;
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${baseTag}`);
  }
  return `${baseTag}${html}`;
}
