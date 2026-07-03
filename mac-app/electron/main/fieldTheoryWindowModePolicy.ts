import type { FieldTheoryWindowMode } from './preferences';

type RecordingIndicatorMode = 'auto' | 'notch' | 'floating';

export function shouldHideFieldTheoryWindowsForAlfred(
  fieldTheoryWindowMode: FieldTheoryWindowMode | null | undefined
): boolean {
  return fieldTheoryWindowMode !== 'app';
}

export function shouldToggleCloseFieldTheoryFromDynamicIsland(
  fieldTheoryWindowMode: FieldTheoryWindowMode | null | undefined
): boolean {
  return fieldTheoryWindowMode !== 'app';
}

export function shouldRestoreFieldTheoryFocusAfterFloatingRecording(
  fieldTheoryWindowMode: FieldTheoryWindowMode | null | undefined,
  resolvedRecordingIndicatorMode: RecordingIndicatorMode | null | undefined,
  transcriptionStatus: string | null | undefined,
  clipboardVisible: boolean,
  clipboardFocused: boolean,
): boolean {
  return fieldTheoryWindowMode === 'app'
    && resolvedRecordingIndicatorMode === 'floating'
    && transcriptionStatus === 'recording'
    && clipboardVisible
    && clipboardFocused;
}

export function shouldShowClipboardWindowOnStartup(
  onboardingComplete: boolean | null | undefined,
  openedAsLoginItem: boolean
): boolean {
  return onboardingComplete === true && !openedAsLoginItem;
}
