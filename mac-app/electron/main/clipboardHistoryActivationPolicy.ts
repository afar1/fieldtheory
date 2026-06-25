export type ClipboardHistoryActivationPreflightSkipReason =
  | 'app-quitting'
  | 'onboarding-incomplete'
  | 'command-launcher-external-invocation'
  | 'command-launcher-visible';

export function getClipboardHistoryActivationPreflightSkipReason(input: {
  appQuitInProgress?: boolean;
  onboardingComplete: boolean;
  commandLauncherExternalInvocationSuppressed: boolean;
  commandLauncherShowingOrVisible: boolean;
}): ClipboardHistoryActivationPreflightSkipReason | null {
  if (input.appQuitInProgress) return 'app-quitting';
  if (!input.onboardingComplete) return 'onboarding-incomplete';
  if (input.commandLauncherExternalInvocationSuppressed) return 'command-launcher-external-invocation';
  if (input.commandLauncherShowingOrVisible) return 'command-launcher-visible';
  return null;
}
