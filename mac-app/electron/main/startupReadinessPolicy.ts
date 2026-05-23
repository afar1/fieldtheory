export interface StartupReadinessInput {
  onboardingComplete: boolean;
  hasAllPermissions: boolean;
  modelReady: boolean;
  canUseLocalAccount: boolean;
}

export interface StartupReadinessDecision {
  showApp: boolean;
  fullyReady: boolean;
  returningLocalUser: boolean;
}

export function resolveStartupReadiness(input: StartupReadinessInput): StartupReadinessDecision {
  const fullyReady = input.hasAllPermissions && input.modelReady && input.canUseLocalAccount;
  const returningLocalUser = input.onboardingComplete && input.canUseLocalAccount;

  return {
    showApp: fullyReady || returningLocalUser,
    fullyReady,
    returningLocalUser,
  };
}
