import type { BrowserHelperServerAddress } from './browserHelperServer';

export type BrowserLibraryUrlTarget = Record<string, unknown> & {
  kind?: unknown;
  path?: unknown;
};

export function appendBrowserLibraryTargetParams(url: URL, target?: BrowserLibraryUrlTarget | null): void {
  if (!target || typeof target !== 'object') return;
  url.searchParams.set('target', JSON.stringify(target));
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
