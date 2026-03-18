import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ThreadStore } from './threadStore';
import type { EmailThread, EmailThreadMessage } from './types';

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeThread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: 'test-thread-1',
    rootMessageId: '<council-test-thread-1-root@fieldtheory.app>',
    subject: '[Council] Test debate',
    topic: 'Should we use tabs or spaces?',
    matchup: 'opus-vs-codex',
    repoPath: null,
    status: 'active',
    providerThreadId: null,
    participants: ['user@example.com'],
    owner: 'council@example.com',
    messages: [],
    modelTurnCount: 0,
    maxTurns: 6,
    extensionTurns: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    transcriptPath: null,
    consensusPath: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<EmailThreadMessage> = {}): EmailThreadMessage {
  return {
    messageId: '<test-msg@fieldtheory.app>',
    inReplyTo: null,
    references: [],
    from: 'speaker@example.com',
    fromName: 'Opus',
    to: ['user@example.com'],
    subject: 'Re: [Council] Test debate',
    body: 'This is my argument.',
    sentAt: new Date().toISOString(),
    author: 'Opus',
    turnNumber: 1,
    ...overrides,
  };
}

describe('ThreadStore', () => {
  let store: ThreadStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'threadstore-test-'));
    store = new ThreadStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads a thread', () => {
    const thread = makeThread();
    store.save(thread);

    const loaded = store.load('test-thread-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('test-thread-1');
    expect(loaded?.topic).toBe('Should we use tabs or spaces?');
  });

  it('returns null for a non-existent thread', () => {
    expect(store.load('missing-thread')).toBeNull();
  });

  it('lists threads sorted by updatedAt descending', () => {
    store.save(makeThread({ id: 'older', updatedAt: '2025-01-01T00:00:00Z' }));
    store.save(makeThread({ id: 'newer', updatedAt: '2025-06-01T00:00:00Z' }));

    const threads = store.list();
    expect(threads).toHaveLength(2);
    expect(threads[0]?.id).toBe('newer');
    expect(threads[1]?.id).toBe('older');
  });

  it('lists only active threads from listActive', () => {
    store.save(makeThread({ id: 'a', status: 'active' }));
    store.save(makeThread({ id: 'b', status: 'closed' }));
    store.save(makeThread({ id: 'c', status: 'concluded' }));

    const threads = store.listActive();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.id).toBe('a');
  });

  it('adds a message and tracks participants', () => {
    store.save(makeThread());

    const updated = store.addMessage(
      'test-thread-1',
      makeMessage({ from: 'newperson@example.com' })
    );

    expect(updated).not.toBeNull();
    expect(updated?.messages).toHaveLength(1);
    expect(updated?.participants).toContain('newperson@example.com');
  });

  it('updates the model turn count from model messages', () => {
    store.save(makeThread());
    store.addMessage('test-thread-1', makeMessage({ turnNumber: 3 }));

    const loaded = store.load('test-thread-1');
    expect(loaded?.modelTurnCount).toBe(3);
  });

  it('updates thread status', () => {
    store.save(makeThread({ status: 'active' }));
    store.setStatus('test-thread-1', 'closed');

    const loaded = store.load('test-thread-1');
    expect(loaded?.status).toBe('closed');
  });

  it('persists transcript and consensus paths', () => {
    store.save(makeThread());
    store.setTranscriptPath('test-thread-1', '/path/to/transcript.md');
    store.setConsensusPath('test-thread-1', '/path/to/consensus.md');

    const loaded = store.load('test-thread-1');
    expect(loaded?.transcriptPath).toBe('/path/to/transcript.md');
    expect(loaded?.consensusPath).toBe('/path/to/consensus.md');
  });

  it('returns known message ids only for active threads', () => {
    store.save(
      makeThread({
        id: 't1',
        status: 'active',
        messages: [
          makeMessage({ messageId: '<msg1@ft>' }),
          makeMessage({ messageId: '<msg2@ft>' }),
        ],
      })
    );
    store.save(
      makeThread({
        id: 't2',
        status: 'concluded',
        messages: [makeMessage({ messageId: '<msg3@ft>' })],
      })
    );
    store.save(
      makeThread({
        id: 't3',
        status: 'closed',
        messages: [makeMessage({ messageId: '<msg4@ft>' })],
      })
    );

    const ids = store.getAllKnownMessageIds();
    expect(ids.has('<msg1@ft>')).toBe(true);
    expect(ids.has('<msg2@ft>')).toBe(true);
    expect(ids.has('<msg3@ft>')).toBe(true);
    expect(ids.has('<msg4@ft>')).toBe(false);
  });

  it('returns root ids for replyable threads', () => {
    store.save(makeThread({ id: 't1', status: 'active', rootMessageId: '<root1@ft>' }));
    store.save(makeThread({ id: 't2', status: 'concluded', rootMessageId: '<root2@ft>' }));
    store.save(makeThread({ id: 't3', status: 'closed', rootMessageId: '<root3@ft>' }));

    const roots = store.getReplyableRootMessageIds();
    expect(roots).toContain('<root1@ft>');
    expect(roots).toContain('<root2@ft>');
    expect(roots).not.toContain('<root3@ft>');
  });

  it('finds a thread by root reference', () => {
    store.save(makeThread({ id: 't1', rootMessageId: '<root@ft>' }));

    const found = store.findThreadByReference(['<root@ft>']);
    expect(found).not.toBeNull();
    expect(found?.id).toBe('t1');
  });

  it('finds a thread by any message reference', () => {
    store.save(
      makeThread({
        id: 't1',
        rootMessageId: '<root@ft>',
        messages: [makeMessage({ messageId: '<turn-5@ft>' })],
      })
    );

    const found = store.findThreadByReference(['<turn-5@ft>']);
    expect(found).not.toBeNull();
    expect(found?.id).toBe('t1');
  });

  it('returns null for unknown references', () => {
    store.save(makeThread());
    expect(store.findThreadByReference(['<unknown@ft>'])).toBeNull();
  });

  it('persists and finds provider thread ids', () => {
    store.save(makeThread({ id: 't1' }));
    store.setProviderThreadId('t1', 'provider-thread-123');

    const loaded = store.load('t1');
    expect(loaded?.providerThreadId).toBe('provider-thread-123');
    expect(store.findThreadByProviderThreadId('provider-thread-123')?.id).toBe('t1');
  });
});
