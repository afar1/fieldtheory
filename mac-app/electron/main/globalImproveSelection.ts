export interface GlobalImproveTargetApp {
  bundleId: string;
  name: string;
}

export interface GlobalImproveActiveContext {
  selectionText?: string;
}

function normalizeClipboardPath(value: string): string {
  return value.trim().replace(/\\/g, '/');
}

export function resolveFieldTheorySelectionText(input: {
  targetApp: GlobalImproveTargetApp | null;
  activeContext: GlobalImproveActiveContext | null | undefined;
  isFieldTheoryTarget: (bundleId: string | null | undefined) => boolean;
}): string | null {
  if (!input.targetApp || !input.isFieldTheoryTarget(input.targetApp.bundleId)) return null;
  // Empty string is intentional: Field Theory is frontmost, but no text is selected.
  // Callers should not synthesize Cmd+C because Librarian falls back to copying the file path.
  return input.activeContext?.selectionText?.trim() ?? '';
}

export function shouldRejectFieldTheoryPathFallback(input: {
  copiedText: string;
  targetApp: GlobalImproveTargetApp | null;
  activeFilePath: string | null | undefined;
  isFieldTheoryTarget: (bundleId: string | null | undefined) => boolean;
}): boolean {
  if (!input.targetApp || !input.isFieldTheoryTarget(input.targetApp.bundleId)) return false;
  if (!input.activeFilePath) return false;
  return normalizeClipboardPath(input.copiedText) === normalizeClipboardPath(input.activeFilePath);
}
