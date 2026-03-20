import { afterEach, describe, expect, it } from 'vitest';
import {
  checkForReplies,
  extractMessageBody,
  MODEL_INBOXES,
  resetClient,
  setClientForTesting,
} from './agentMailTransport';

describe('agentMailTransport', () => {
  afterEach(() => {
    resetClient();
  });

  it('defines the launch model inbox identities', () => {
    expect(MODEL_INBOXES.codex.username).toBe('codex');
    expect(MODEL_INBOXES.opus.username).toBe('opus');
    expect(MODEL_INBOXES.council.username).toBe('council');
  });

  it('extracts the richest available body content', () => {
    expect(extractMessageBody({ extractedText: 'new text', text: 'full text', preview: 'preview' })).toBe('new text');
    expect(extractMessageBody({ text: 'full text', preview: 'preview' })).toBe('full text');
    expect(extractMessageBody({ preview: 'preview only' })).toBe('preview only');
  });

  it('loads the full message payload after listing inbox messages', async () => {
    const get = async () => ({
      messageId: 'provider-msg-1',
      threadId: 'thread-1',
      from: 'Andrew <andrew@example.com>',
      to: ['codex@fieldtheory.dev'],
      cc: ['opus@fieldtheory.dev'],
      subject: 'Debate',
      text: 'Full body from get',
      headers: {
        'message-id': '<msg-1@example.com>',
        'x-gm-original-to': 'codex@fieldtheory.dev',
      },
      createdAt: '2026-03-19T15:00:00.000Z',
    });

    setClientForTesting({
      inboxes: {
        create: async () => ({ inboxId: 'unused' }),
        list: async () => [],
        messages: {
          get,
          send: async () => ({ messageId: 'unused', threadId: 'unused' }),
          reply: async () => ({ messageId: 'unused', threadId: 'unused' }),
          list: async () => ({
            messages: [
              {
                messageId: 'provider-msg-1',
                threadId: 'thread-1',
                preview: 'Preview only',
                headers: { 'message-id': '<msg-1@example.com>' },
              },
            ],
          }),
        },
        threads: {
          list: async () => [],
        },
      },
    });

    const messages = await checkForReplies(
      {
        apiKey: 'am_test',
        domain: 'agentmail.to',
        inboxIds: { council: 'debateintake@agentmail.to' },
      },
      'council',
      new Set<string>(),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toBe('Full body from get');
    expect(messages[0]?.to).toContain('codex@fieldtheory.dev');
    expect(messages[0]?.cc).toContain('opus@fieldtheory.dev');
  });
});
