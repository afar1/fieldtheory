import { describe, expect, it } from 'vitest';
import { MODEL_INBOXES } from './agentMailTransport';

describe('agentMailTransport', () => {
  it('defines the launch model inbox identities', () => {
    expect(MODEL_INBOXES.codex.username).toBe('codex');
    expect(MODEL_INBOXES.opus.username).toBe('opus');
    expect(MODEL_INBOXES.council.username).toBe('council');
  });
});
