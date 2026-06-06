import type { BrowserHelperServerAddress } from './browserHelperServer';

export type BrowserLibraryUrlTarget = Record<string, unknown> & {
  kind?: unknown;
  path?: unknown;
};

export function appendBrowserLibraryTargetParams(url: URL, target?: BrowserLibraryUrlTarget | null): void {
  if (!target || typeof target !== 'object') return;
  if (typeof target.kind === 'string') url.searchParams.set('kind', target.kind);
  if (typeof target.path === 'string') url.searchParams.set('path', target.path);
  if (
    target.contentMode === 'rendered'
    || target.contentMode === 'markdown'
    || target.contentMode === 'typedown'
  ) {
    url.searchParams.set('contentMode', target.contentMode);
  }
  if (typeof target.sidebarCollapsed === 'boolean') {
    url.searchParams.set('sidebarCollapsed', target.sidebarCollapsed ? '1' : '0');
  }
  if (typeof target.focusChrome === 'boolean') {
    url.searchParams.set('focusChrome', target.focusChrome ? '1' : '0');
  }
  if (typeof target.selectionStart === 'number' && Number.isFinite(target.selectionStart)) {
    url.searchParams.set('selectionStart', String(target.selectionStart));
  }
  if (typeof target.selectionEnd === 'number' && Number.isFinite(target.selectionEnd)) {
    url.searchParams.set('selectionEnd', String(target.selectionEnd));
  }
}

export function buildBrowserLibraryUrl(input: {
  address: BrowserHelperServerAddress;
  devServer?: string | null;
  target?: BrowserLibraryUrlTarget | null;
}): string {
  const apiUrl = `http://${input.address.host}:${input.address.port}`;
  const devServer = input.devServer?.replace(/\/$/, '');
  const url = devServer
    ? new URL('/browser-library.html', devServer)
    : new URL(input.address.url);

  url.searchParams.set('api', apiUrl);
  url.searchParams.set('token', input.address.token);
  appendBrowserLibraryTargetParams(url, input.target);
  return url.toString();
}

export function buildBrowserPanelRedirectUrl(address: BrowserHelperServerAddress): string {
  const url = new URL(`http://${address.host}:${address.port}/panel`);
  return url.toString();
}
