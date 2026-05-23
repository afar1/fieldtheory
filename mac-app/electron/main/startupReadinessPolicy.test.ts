import { describe, expect, it } from 'vitest';
import { resolveStartupReadiness } from './startupReadinessPolicy';

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
