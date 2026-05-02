import { describe, expect, it } from 'vitest';
import { QuotaManager } from './quotaManager';

describe('QuotaManager local-first release access', () => {
  it('keeps free tier local tools allowed and unlimited', () => {
    const manager = new QuotaManager();
    manager.setInitialTier('free');

    expect(manager.isAllowed('portable_commands')).toBe(true);
    expect(manager.getFeatureStatus('portable_commands')).toMatchObject({
      limit: Infinity,
      remaining: Infinity,
      allowed: true,
      percentUsed: 0,
    });
    expect(manager.getLimits()).toMatchObject({
      text_improve_words: Infinity,
      priority_mic_seconds: Infinity,
      auto_stack_sessions: Infinity,
      portable_commands: Infinity,
    });
  });
});
