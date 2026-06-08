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

export interface AuthMonitorInput {
  authenticated: boolean;
  hasEverAuthenticated: boolean;
  canUseLocalAccount: boolean;
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

export function shouldForceAccountOnboarding(input: AuthMonitorInput): boolean {
  return !input.authenticated && !input.hasEverAuthenticated && !input.canUseLocalAccount;
}
