import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeSubstitutionChanges, substitutionChanges, WordSubstitutionSync } from './wordSubstitutionSync';
import type { AuthManager } from './authManager';
import type { PreferencesManager } from './preferences';

afterEach(() => vi.useRealTimers());

describe('word substitution sync', () => {
  const maine = { from: 'Maine', to: 'main' };
  const codex = { from: 'codec', to: 'Codex' };

  it('migrates local words and preserves independent remote additions', () => {
    expect(mergeSubstitutionChanges([codex], substitutionChanges([], [maine]))).toEqual([codex, maine]);
  });

  it('sends explicit deletions, including an empty list, without deleting unseen words', () => {
    expect(mergeSubstitutionChanges([maine, codex], substitutionChanges([maine], []))).toEqual([codex]);
  });

  it('distinguishes removal of a rule from replacement with empty text', () => {
    expect(substitutionChanges([maine], [{ from: 'Maine', to: '' }])).toEqual([{ from: 'Maine', to: '' }]);
  });

  it('retains ordering while editing a replacement', () => {
    expect(mergeSubstitutionChanges([maine, codex], [{ from: 'Maine', to: 'MAIN' }]))
      .toEqual([{ from: 'Maine', to: 'MAIN' }, codex]);
  });

  function fixture() {
    vi.useFakeTimers();
    let user = 'alice';
    let state = { wordSubstitutions: [maine], wordSubstitutionsSynced: [] as typeof maine[] };
    const rpc = vi.fn();
    const auth = {
      getSession: () => ({ user: { id: user } }),
      getSupabaseClient: () => ({ rpc }),
    } as unknown as AuthManager;
    const save = vi.fn(async (patch, guard = () => true) => { if (guard()) state = { ...state, ...patch }; });
    const preferences = {
      getPreference: (key: keyof typeof state) => state[key], save,
    } as unknown as PreferencesManager;
    return { service: new WordSubstitutionSync(auth, preferences), rpc, save,
      state: () => state, switchUser: () => { user = 'bob'; } };
  }

  it('keeps edits durable when offline and retries them', async () => {
    const f = fixture();
    f.rpc.mockResolvedValueOnce({ error: new Error('offline') });
    await f.service.sync();
    expect(f.state().wordSubstitutions).toEqual([maine]);
    expect(f.state().wordSubstitutionsSynced).toEqual([]);
    f.rpc.mockResolvedValueOnce({ data: [codex, maine] });
    await f.service.sync();
    expect(f.state().wordSubstitutionsSynced).toEqual([codex, maine]);
  });

  it('discards responses after an account switch', async () => {
    const f = fixture();
    let resolve!: (value: unknown) => void;
    f.rpc.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = f.service.sync();
    f.switchUser();
    resolve({ data: [codex] });
    await pending;
    expect(f.save).not.toHaveBeenCalled();
  });

  it('does not overwrite an edit made during a request', async () => {
    const f = fixture();
    let resolve!: (value: unknown) => void;
    f.rpc.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = f.service.sync();
    await f.service.set([codex]);
    resolve({ data: [maine] });
    await pending;
    expect(f.state().wordSubstitutions).toEqual([codex]);
  });
});
