export type ClipboardHistoryActivationPreflightSkipReason =
  | 'onboarding-incomplete'
  | 'command-launcher-external-invocation'
  | 'command-launcher-visible';

export function getClipboardHistoryActivationPreflightSkipReason(input: {
  onboardingComplete: boolean;
  commandLauncherExternalInvocationSuppressed: boolean;
  commandLauncherShowingOrVisible: boolean;
}): ClipboardHistoryActivationPreflightSkipReason | null {
  if (!input.onboardingComplete) return 'onboarding-incomplete';
  if (input.commandLauncherExternalInvocationSuppressed) return 'command-launcher-external-invocation';
  if (input.commandLauncherShowingOrVisible) return 'command-launcher-visible';
  return null;
}
