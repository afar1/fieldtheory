export function isFieldTheoryCommandTargetBundleId(bundleId: string | null | undefined): boolean {
  if (!bundleId) return false;
  const lower = bundleId.toLowerCase();
  return lower.includes('fieldtheory') || lower === 'com.github.electron';
}

export function isDockCommandTargetBundleId(bundleId: string | null | undefined): boolean {
  return bundleId?.toLowerCase() === 'com.apple.dock';
}

export function isExternalCommandTargetBundleId(bundleId: string | null | undefined): boolean {
  return Boolean(bundleId) &&
    !isFieldTheoryCommandTargetBundleId(bundleId) &&
    !isDockCommandTargetBundleId(bundleId);
}
