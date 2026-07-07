export type FieldTheorySyncStatus = {
  localEnabled: boolean;
  authenticated: boolean;
  serverEnforced: boolean;
  enabled: boolean;
  reason: 'enabled' | 'local_disabled' | 'not_authenticated';
};

export function isFieldTheoryInternalSyncEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.FIELD_THEORY_INTERNAL_SYNC_ENABLED ?? env.FIELD_THEORY_INTERNAL_SYNC;
  return raw === '1' || raw?.toLowerCase() === 'true';
}

export function resolveFieldTheorySyncStatus(options: {
  localEnabled: boolean;
  authenticated: boolean;
}): FieldTheorySyncStatus {
  if (!options.localEnabled) {
    return {
      localEnabled: false,
      authenticated: options.authenticated,
      serverEnforced: false,
      enabled: false,
      reason: 'local_disabled',
    };
  }

  if (!options.authenticated) {
    return {
      localEnabled: true,
      authenticated: false,
      serverEnforced: false,
      enabled: false,
      reason: 'not_authenticated',
    };
  }

  return {
    localEnabled: true,
    authenticated: true,
    serverEnforced: false,
    enabled: true,
    reason: 'enabled',
  };
}
