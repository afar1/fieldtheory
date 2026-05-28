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

export type CommandLauncherInvocationTarget =
  | { kind: 'field-theory-terminal' }
  | { kind: 'field-theory-markdown' }
  | { kind: 'external-app' }
  | { kind: 'none' };

export function resolveCommandLauncherInvocationTarget(input: {
  fieldTheoryActive: boolean;
  hasFocusedFieldTheoryTerminal: boolean;
  hasActiveFieldTheoryMarkdown: boolean;
  hasExternalTargetApp: boolean;
}): CommandLauncherInvocationTarget {
  if (input.fieldTheoryActive) {
    if (input.hasFocusedFieldTheoryTerminal) return { kind: 'field-theory-terminal' };
    if (input.hasActiveFieldTheoryMarkdown) return { kind: 'field-theory-markdown' };
    return { kind: 'none' };
  }
  return input.hasExternalTargetApp ? { kind: 'external-app' } : { kind: 'none' };
}
