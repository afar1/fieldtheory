import { describe, expect, it } from 'vitest';
import { resolveStartupReadiness, shouldForceAccountOnboarding } from './startupReadinessPolicy';

describe('startup readiness policy', () => {
  it('shows the app for a fully ready user', () => {
    expect(resolveStartupReadiness({
      onboardingComplete: false,
      hasAllPermissions: true,
      modelReady: true,
      canUseLocalAccount: true,
    })).toEqual({
      showApp: true,
      fullyReady: true,
      returningLocalUser: false,
    });
  });

  it('shows the app for a returning local user even when permissions are missing', () => {
    expect(resolveStartupReadiness({
      onboardingComplete: true,
      hasAllPermissions: false,
      modelReady: true,
      canUseLocalAccount: true,
    })).toMatchObject({
      showApp: true,
      fullyReady: false,
      returningLocalUser: true,
    });
  });

  it('keeps a new incomplete user in onboarding', () => {
    expect(resolveStartupReadiness({
      onboardingComplete: false,
      hasAllPermissions: false,
      modelReady: true,
      canUseLocalAccount: true,
    })).toMatchObject({
      showApp: false,
      fullyReady: false,
      returningLocalUser: false,
    });
  });

  it('keeps users without a local account in onboarding', () => {
    expect(resolveStartupReadiness({
      onboardingComplete: true,
      hasAllPermissions: true,
      modelReady: true,
      canUseLocalAccount: false,
    })).toMatchObject({
      showApp: false,
      fullyReady: false,
      returningLocalUser: false,
    });
  });
});

describe('account onboarding monitor policy', () => {
  it('does not force onboarding for a restored local user without active auth', () => {
    expect(shouldForceAccountOnboarding({
      authenticated: false,
      hasEverAuthenticated: false,
      canUseLocalAccount: true,
    })).toBe(false);
  });

  it('forces account onboarding for a new user without auth or local account state', () => {
    expect(shouldForceAccountOnboarding({
      authenticated: false,
      hasEverAuthenticated: false,
      canUseLocalAccount: false,
    })).toBe(true);
  });
});
