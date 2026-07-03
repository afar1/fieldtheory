import { EventEmitter } from 'events';
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
    vi.useRealTimers();
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

  it('does not open realtime or fallback polling immediately after auth', () => {
    vi.useFakeTimers();

    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
    const authManager = new EventEmitter() as any;
    authManager.isAuthenticated = vi.fn(() => true);
    authManager.getSession = vi.fn(() => ({ user: { id: 'recipient-user', email: 'recipient@example.com' } }));
    authManager.getSupabaseClient = vi.fn(() => supabase);
    const manager = new FeedbackManager(authManager, {} as any);

    expect(supabase.channel).not.toHaveBeenCalled();
    expect((manager as any).pollingInterval).toBeNull();

    manager.destroy();
  });

  it('emits incoming feedback from the realtime subscription', async () => {
    vi.useFakeTimers();

    let realtimeHandler: ((payload: { new: unknown }) => Promise<void>) | null = null;
    let subscribeHandler: ((status: string, err?: Error) => void) | null = null;
    const channel = {
      on: vi.fn((_event, _config, handler) => {
        realtimeHandler = handler;
        return channel;
      }),
      subscribe: vi.fn((handler) => {
        subscribeHandler = handler;
        return channel;
      }),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
    const authManager = new EventEmitter() as any;
    authManager.isAuthenticated = vi.fn(() => true);
    authManager.getSession = vi.fn(() => ({ user: { id: 'recipient-user', email: 'recipient@example.com' } }));
    authManager.getSupabaseClient = vi.fn(() => supabase);
    const manager = new FeedbackManager(authManager, {} as any);
    (manager as any).rowToMessage = vi.fn(async (row) => ({ id: row.id, type: 'feedback' }));
    manager.setFeedbackRealtimeActive(true);

    const received = vi.fn();
    manager.on('messageReceived', received);
    expect(subscribeHandler).toBeTruthy();
    expect(realtimeHandler).toBeTruthy();
    (subscribeHandler as unknown as (status: string, err?: Error) => void)('SUBSCRIBED');
    await (realtimeHandler as unknown as (payload: { new: unknown }) => Promise<void>)({
      new: {
        id: 'm1',
        type: 'feedback',
        sender_user_id: 'sender-user',
        recipient_user_id: 'recipient-user',
        content_type: 'text',
        content_text: 'hello',
        image_path: null,
        read_at: null,
        feedback_status: 'open',
        parent_message_id: null,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      },
    });

    expect(supabase.channel).toHaveBeenCalledWith('feedback-messages:recipient-user');
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: 'recipient_user_id=eq.recipient-user',
      }),
      expect.any(Function),
    );
    expect(received).toHaveBeenCalledWith({ id: 'm1', type: 'feedback' });

    manager.destroy();
  });

  it('tears realtime down when feedback is no longer active', () => {
    vi.useFakeTimers();

    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
    const authManager = new EventEmitter() as any;
    authManager.isAuthenticated = vi.fn(() => true);
    authManager.getSession = vi.fn(() => ({ user: { id: 'recipient-user', email: 'recipient@example.com' } }));
    authManager.getSupabaseClient = vi.fn(() => supabase);
    const manager = new FeedbackManager(authManager, {} as any);

    manager.setFeedbackRealtimeActive(true);
    expect(supabase.channel).toHaveBeenCalledWith('feedback-messages:recipient-user');

    manager.setFeedbackRealtimeActive(false);
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
    expect((manager as any).pollingInterval).toBeNull();

    manager.destroy();
  });

  it('does not crash if realtime teardown fails during connection startup', () => {
    vi.useFakeTimers();

    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(() => {
        throw new Error('WebSocket was closed before the connection was established');
      }),
    };
    const authManager = new EventEmitter() as any;
    authManager.isAuthenticated = vi.fn(() => true);
    authManager.getSession = vi.fn(() => ({ user: { id: 'recipient-user', email: 'recipient@example.com' } }));
    authManager.getSupabaseClient = vi.fn(() => supabase);
    const manager = new FeedbackManager(authManager, {} as any);

    manager.setFeedbackRealtimeActive(true);

    expect(() => manager.setFeedbackRealtimeActive(false)).not.toThrow();
    expect((manager as any).realtimeChannel).toBeNull();
    expect((manager as any).realtimeConnected).toBe(false);

    manager.destroy();
  });

  it('does not leave unhandled failures if realtime teardown rejects', async () => {
    vi.useFakeTimers();

    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(() => Promise.reject(new Error('Realtime remove failed'))),
    };
    const authManager = new EventEmitter() as any;
    authManager.isAuthenticated = vi.fn(() => true);
    authManager.getSession = vi.fn(() => ({ user: { id: 'recipient-user', email: 'recipient@example.com' } }));
    authManager.getSupabaseClient = vi.fn(() => supabase);
    const manager = new FeedbackManager(authManager, {} as any);

    manager.setFeedbackRealtimeActive(true);

    expect(() => manager.setFeedbackRealtimeActive(false)).not.toThrow();
    await Promise.resolve();
    expect((manager as any).realtimeChannel).toBeNull();
    expect((manager as any).realtimeConnected).toBe(false);

    manager.destroy();
  });

  it('polls for missed feedback messages when realtime is unavailable', async () => {
    const rows = [
      {
        id: 'm2',
        type: 'feedback',
        sender_user_id: 'sender-user',
        recipient_user_id: 'recipient-user',
        content_type: 'text',
        content_text: 'missed',
        image_path: null,
        read_at: null,
        feedback_status: 'open',
        parent_message_id: null,
        created_at: '2026-02-01T00:00:01.000Z',
        updated_at: '2026-02-01T00:00:01.000Z',
      },
    ];
    const order = vi.fn(async () => ({ data: rows, error: null }));
    const gt = vi.fn(() => ({ order }));
    const eqType = vi.fn(() => ({ gt }));
    const eqRecipient = vi.fn(() => ({ eq: eqType }));
    const select = vi.fn(() => ({ eq: eqRecipient }));
    const from = vi.fn(() => ({ select }));
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      from,
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
    const authManager = new EventEmitter() as any;
    authManager.isAuthenticated = vi.fn(() => true);
    authManager.getSession = vi.fn(() => ({ user: { id: 'recipient-user', email: 'recipient@example.com' } }));
    authManager.getSupabaseClient = vi.fn(() => supabase);
    const manager = new FeedbackManager(authManager, {} as any);
    (manager as any).lastPolledAt = '2026-02-01T00:00:00.000Z';
    (manager as any).prefetchProfiles = vi.fn(async () => undefined);
    (manager as any).rowToMessage = vi.fn(async (row) => ({ id: row.id, type: 'feedback' }));

    const received = vi.fn();
    manager.on('messageReceived', received);
    await (manager as any).pollForNewMessages();

    expect(from).toHaveBeenCalledWith('messages');
    expect(eqRecipient).toHaveBeenCalledWith('recipient_user_id', 'recipient-user');
    expect(eqType).toHaveBeenCalledWith('type', 'feedback');
    expect(gt).toHaveBeenCalledWith('created_at', '2026-02-01T00:00:00.000Z');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(received).toHaveBeenCalledWith({ id: 'm2', type: 'feedback' });

    manager.destroy();
  });

  it('keeps the polling cursor when fallback restarts', () => {
    vi.useFakeTimers();

    const authManager = new EventEmitter() as any;
    authManager.isAuthenticated = vi.fn(() => false);
    authManager.getSession = vi.fn(() => null);
    authManager.getSupabaseClient = vi.fn(() => null);
    const manager = new FeedbackManager(authManager, {} as any);

    (manager as any).lastPolledAt = '2026-02-01T00:00:00.000Z';
    (manager as any).startPollingFallback();

    expect((manager as any).lastPolledAt).toBe('2026-02-01T00:00:00.000Z');

    manager.destroy();
  });

  it('keeps realtime active briefly after a confirmed feedback write', async () => {
    vi.useFakeTimers();

    const single = vi.fn(async () => ({
      data: {
        id: 'sent-feedback',
        type: 'feedback',
        sender_user_id: 'sender-user',
        recipient_user_id: 'admin-user',
        content_type: 'text',
        content_text: 'hello',
        image_path: null,
        read_at: null,
        feedback_status: 'open',
        parent_message_id: null,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      error: null,
    }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      from,
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
    const authManager = new EventEmitter() as any;
    authManager.isAuthenticated = vi.fn(() => true);
    authManager.getSession = vi.fn(() => ({ user: { id: 'sender-user', email: 'sender@example.com' } }));
    authManager.getSupabaseClient = vi.fn(() => supabase);
    const manager = new FeedbackManager(authManager, {} as any);
    (manager as any).getAdminUserId = vi.fn(async () => 'admin-user');
    (manager as any).logActivity = vi.fn(async () => undefined);
    (manager as any).rowToMessage = vi.fn(async (row) => ({ id: row.id, type: 'feedback' }));

    const result = await manager.submitTextFeedback('hello');

    expect(result).toEqual({ id: 'sent-feedback', type: 'feedback' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'feedback',
      content_text: 'hello',
      recipient_user_id: 'admin-user',
    }));
    expect(supabase.channel).toHaveBeenCalledWith('feedback-messages:sender-user');
    expect((manager as any).pollingInterval).not.toBeNull();

    manager.destroy();
  });
});
