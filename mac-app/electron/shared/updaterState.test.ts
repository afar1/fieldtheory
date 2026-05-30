import { describe, expect, it } from 'vitest';
import { isUpdateStatusSticky, resolveUpdaterStatusTransition } from './updaterState';

describe('updater state transitions', () => {
  it('keeps a downloaded update ready across later background checks', () => {
    expect(resolveUpdaterStatusTransition('ready', 'checking')).toBe('ready');
    expect(resolveUpdaterStatusTransition('ready', 'uptodate')).toBe('ready');
    expect(resolveUpdaterStatusTransition('ready', 'idle')).toBe('ready');
  });

  it('keeps a downloaded update ready across background errors', () => {
    expect(resolveUpdaterStatusTransition('ready', 'error')).toBe('ready');
  });

  it('allows a downloaded update to move into installing', () => {
    expect(resolveUpdaterStatusTransition('ready', 'installing')).toBe('installing');
  });

  it('keeps installing sticky until explicitly forced or failed', () => {
    expect(resolveUpdaterStatusTransition('installing', 'ready')).toBe('installing');
    expect(resolveUpdaterStatusTransition('installing', 'idle')).toBe('installing');
    expect(resolveUpdaterStatusTransition('installing', 'error')).toBe('error');
    expect(resolveUpdaterStatusTransition('installing', 'idle', { force: true })).toBe('idle');
  });

  it('allows ordinary pre-download transitions', () => {
    expect(resolveUpdaterStatusTransition('idle', 'checking')).toBe('checking');
    expect(resolveUpdaterStatusTransition('checking', 'available')).toBe('available');
    expect(resolveUpdaterStatusTransition('available', 'downloading')).toBe('downloading');
    expect(resolveUpdaterStatusTransition('downloading', 'ready')).toBe('ready');
  });

  it('identifies sticky update states', () => {
    expect(isUpdateStatusSticky('ready')).toBe(true);
    expect(isUpdateStatusSticky('installing')).toBe(true);
    expect(isUpdateStatusSticky('downloading')).toBe(false);
  });
});
