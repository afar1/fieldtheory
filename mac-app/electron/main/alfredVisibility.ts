export interface FrontmostAppLike {
  bundleId?: string | null;
  name?: string | null;
}

export function isAlfredApp(appInfo: FrontmostAppLike | null | undefined): boolean {
  const bundleId = (appInfo?.bundleId ?? '').toLowerCase();
  const name = (appInfo?.name ?? '').toLowerCase();

  return bundleId.includes('alfred') ||
    bundleId.includes('runningwithcrayons') ||
    /^alfred\b/.test(name);
}
