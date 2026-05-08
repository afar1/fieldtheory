export function isFieldTheoryCommandTargetBundleId(bundleId: string | null | undefined): boolean {
  if (!bundleId) return false;
  const lower = bundleId.toLowerCase();
  return lower.includes('fieldtheory') || lower === 'com.github.electron';
}
