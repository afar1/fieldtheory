import { describe, it, expect } from 'vitest';
import { nextTopNavViewMode, shouldCycleTopNavWithControlTab } from '../types/clipboard';

describe('nextTopNavViewMode', () => {
  it('cycles forward through clipboard → librarian → commands → clipboard', () => {
    expect(nextTopNavViewMode('clipboard', 1, true)).toBe('librarian');
    expect(nextTopNavViewMode('librarian', 1, true)).toBe('commands');
    expect(nextTopNavViewMode('commands', 1, true)).toBe('clipboard');
  });

  it('cycles backward with Shift+Tab', () => {
    expect(nextTopNavViewMode('clipboard', -1, true)).toBe('commands');
    expect(nextTopNavViewMode('commands', -1, true)).toBe('librarian');
    expect(nextTopNavViewMode('librarian', -1, true)).toBe('clipboard');
  });

  it('keeps librarian in the nav cycle when librarian automation is disabled', () => {
    expect(nextTopNavViewMode('clipboard', 1, false)).toBe('librarian');
    expect(nextTopNavViewMode('librarian', 1, false)).toBe('commands');
    expect(nextTopNavViewMode('clipboard', -1, false)).toBe('commands');
  });

  it('falls back to the first tab when starting from a view outside the carousel', () => {
    // feedback/sketch/todo/settings aren't in the left-group carousel;
    // pressing Control+Tab from there should land on the first tab.
    expect(nextTopNavViewMode('feedback', 1, true)).toBe('clipboard');
    expect(nextTopNavViewMode('sketch', -1, true)).toBe('clipboard');
    expect(nextTopNavViewMode('todo', 1, false)).toBe('clipboard');
  });

  it('uses Control+Tab as the nav carousel shortcut from buttons, including the current tab', () => {
    expect(shouldCycleTopNavWithControlTab('BUTTON')).toBe(true);
    expect(shouldCycleTopNavWithControlTab('DIV')).toBe(true);
    expect(shouldCycleTopNavWithControlTab(null)).toBe(true);
  });

  it('lets text fields keep native Tab behavior', () => {
    expect(shouldCycleTopNavWithControlTab('INPUT')).toBe(false);
    expect(shouldCycleTopNavWithControlTab('TEXTAREA')).toBe(false);
  });
});
