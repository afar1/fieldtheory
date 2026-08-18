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

export type ExternalCommandTargetApp = {
  bundleId: string;
  name: string;
  windowBounds?: { x: number; y: number; width: number; height: number } | null;
};

type ExternalCommandTargetCandidate = {
  bundleId?: string | null;
  name?: string | null;
  windowBounds?: { x: number; y: number; width: number; height: number } | null;
};

export function findExternalCommandTargetForBundleId(
  bundleId: string,
  candidates: Array<ExternalCommandTargetCandidate | null | undefined>,
): ExternalCommandTargetApp | null {
  const lowerBundleId = bundleId.toLowerCase();
  const matchingCandidates = candidates.filter((item): item is ExternalCommandTargetApp => Boolean(
    item?.bundleId &&
    item.name &&
    item.bundleId.toLowerCase() === lowerBundleId &&
    isExternalCommandTargetBundleId(item.bundleId)
  ));
  const candidate = matchingCandidates.find(item => item.windowBounds) ?? matchingCandidates[0];
  if (candidate) return candidate;
  return isExternalCommandTargetBundleId(bundleId) ? { bundleId, name: bundleId } : null;
}

export type CommandLauncherInvocationTarget =
  | { kind: 'field-theory-terminal'; sessionId: string | null }
  | { kind: 'field-theory-markdown' }
  | { kind: 'external-app' }
  | { kind: 'none' };

export type CommandLauncherFieldTheoryLaunchSurface =
  | { kind: 'terminal'; sessionId: string }
  | { kind: 'markdown' }
  | { kind: 'none' };

export type CommandLauncherLaunchOrigin =
  | { kind: 'field-theory'; surface: CommandLauncherFieldTheoryLaunchSurface }
  | { kind: 'external-app'; app: { bundleId: string; name: string; windowBounds?: { x: number; y: number; width: number; height: number } | null } }
  | { kind: 'none' };

export function resolveCommandLauncherInvocationTarget(input: {
  launchOrigin?: CommandLauncherLaunchOrigin | null;
  fieldTheoryActive: boolean;
  hasFocusedFieldTheoryTerminal: boolean;
  focusedFieldTheoryTerminalSessionId?: string | null;
  hasActiveFieldTheoryMarkdown: boolean;
  hasExternalTargetApp: boolean;
}): CommandLauncherInvocationTarget {
  if (input.launchOrigin?.kind === 'external-app') {
    return input.hasExternalTargetApp ? { kind: 'external-app' } : { kind: 'none' };
  }
  if (input.launchOrigin?.kind === 'field-theory') {
    if (input.launchOrigin.surface.kind === 'terminal') {
      return { kind: 'field-theory-terminal', sessionId: input.launchOrigin.surface.sessionId };
    }
    if (input.launchOrigin.surface.kind === 'markdown') return { kind: 'field-theory-markdown' };
    return { kind: 'none' };
  }
  if (input.launchOrigin?.kind === 'none') return { kind: 'none' };

  if (input.fieldTheoryActive) {
    if (input.hasFocusedFieldTheoryTerminal) {
      return { kind: 'field-theory-terminal', sessionId: input.focusedFieldTheoryTerminalSessionId ?? null };
    }
    if (input.hasActiveFieldTheoryMarkdown) return { kind: 'field-theory-markdown' };
    return { kind: 'none' };
  }
  return input.hasExternalTargetApp ? { kind: 'external-app' } : { kind: 'none' };
}
