import type { AuthManager } from './authManager';
import type { PreferencesManager } from './preferences';

export type WordSubstitution = { from: string; to: string };
export type WordChange = { from: string; to: string | null };

export function substitutionChanges(base: WordSubstitution[], current: WordSubstitution[]): WordChange[] {
  const before = new Map(base.map(pair => [pair.from, pair.to]));
  const after = new Map(current.map(pair => [pair.from, pair.to]));
  return [
    ...base.filter(pair => !after.has(pair.from)).map(pair => ({ from: pair.from, to: null })),
    ...current.filter(pair => before.get(pair.from) !== pair.to),
  ];
}

export class WordSubstitutionSync {
  private generation = 0;
  private running = false;
  private paused = false;
  status = 'Waiting to sync';

  constructor(private auth: AuthManager, private preferences: PreferencesManager) {
    const timer = setInterval(() => { void this.sync(); }, 30_000);
    timer.unref();
  }

  invalidate(): void { this.generation++; }
  pause(): void { this.paused = true; this.invalidate(); }
  resume(): void { this.paused = false; }

  async set(pairs: WordSubstitution[], base?: WordSubstitution[]): Promise<void> {
    if (base) pairs = mergeSubstitutionChanges(this.preferences.getPreference('wordSubstitutions') ?? [], substitutionChanges(base, pairs));
    this.invalidate();
    const userId = this.auth.getSession()?.user.id;
    await this.preferences.save({ wordSubstitutions: pairs }, () => this.auth.getSession()?.user.id === userId);
    this.invalidate();
    void this.sync();
  }

  async sync(): Promise<void> {
    const userId = this.auth.getSession()?.user.id;
    const client = this.auth.getSupabaseClient();
    if (!userId || !client || this.running || this.paused) return;
    this.running = true;
    const generation = this.generation;
    const current = this.preferences.getPreference('wordSubstitutions') ?? [];
    const base = this.preferences.getPreference('wordSubstitutionsSynced') ?? [];
    try {
      const { data, error } = await client.rpc('sync_word_substitutions', {
        changes: substitutionChanges(base, current),
      });
      if (error) {
        this.status = 'Saved on this Mac. Sync unavailable; will retry.';
        return;
      }
      if (generation !== this.generation || this.auth.getSession()?.user.id !== userId) return;
      if (!Array.isArray(data) || !data.every(pair => typeof pair.from === 'string' && typeof pair.to === 'string')) return;
      await this.preferences.save({ wordSubstitutions: data, wordSubstitutionsSynced: data },
        () => generation === this.generation && this.auth.getSession()?.user.id === userId);
      if (generation === this.generation && this.auth.getSession()?.user.id === userId) {
        this.status = 'Synced with your account';
      }
    } catch {
      this.status = 'Saved on this Mac. Sync unavailable; will retry.';
    } finally {
      this.running = false;
    }
  }
}

export function mergeSubstitutionChanges(pairs: WordSubstitution[], changes: WordChange[]): WordSubstitution[] {
  const result = new Map(pairs.map(pair => [pair.from, pair.to]));
  for (const change of changes) {
    if (change.to === null) result.delete(change.from);
    else result.set(change.from, change.to);
  }
  return [...result].map(([from, to]) => ({ from, to }));
}
