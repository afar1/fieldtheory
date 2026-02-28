import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { FeedbackManager } from './feedbackManager';

describe('FeedbackManager message mapping', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('includes sender and recipient callsigns in mapped feedback messages', async () => {
    const manager = new FeedbackManager({} as any, {} as any);

    (manager as any).getProfile = vi.fn()
      .mockResolvedValueOnce({
        id: 'user-a',
        email: 'alpha@example.com',
        callsign: 'alpha',
        firstName: null,
        lastName: null,
        isAdmin: false,
      })
      .mockResolvedValueOnce({
        id: 'user-b',
        email: 'bravo@example.com',
        callsign: 'bravo',
        firstName: null,
        lastName: null,
        isAdmin: true,
      });

    const message = await (manager as any).rowToMessage({
      id: 'm1',
      type: 'feedback',
      sender_user_id: 'user-a',
      recipient_user_id: 'user-b',
      content_type: 'text',
      content_text: 'hello',
      image_path: null,
      read_at: null,
      feedback_status: 'open',
      parent_message_id: null,
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    });

    expect(message.senderCallsign).toBe('alpha');
    expect(message.recipientCallsign).toBe('bravo');
  });
});
