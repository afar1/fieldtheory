import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { VoiceInboxPresentation } from '../../electron/shared/voiceInboxPresentation';
import { useVoiceInboxPresentation } from './useVoiceInboxPresentation';

afterEach(() => { cleanup(); delete window.voiceWorkAPI; delete window.authAPI; vi.useRealTimers(); });

const presentation: VoiceInboxPresentation = { folderPath: '/library/Inbox', truncated: false, notes: [{
  notePath: '/library/Inbox/recording.md', transcriptId: 'recording', createdAtMs: 1000,
  title: 'Can you investigate this', wordCount: 4, threadId: 'confirmed-task',
}] };

it('loads on activation and coalesced change events without polling', async () => {
  vi.useFakeTimers();
  let changed!: () => void;
  const getInboxPresentation = vi.fn(async () => presentation);
  const unsubscribe = vi.fn();
  window.voiceWorkAPI = {
    getInboxPresentation, onInboxChanged: (callback: () => void) => { changed = callback; return unsubscribe; },
    onStateChanged: () => () => {},
  } as unknown as NonNullable<Window['voiceWorkAPI']>;
  const { result, unmount } = renderHook(() => useVoiceInboxPresentation(true));
  await act(async () => {});
  expect(result.current).toEqual(presentation);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(getInboxPresentation).toHaveBeenCalledTimes(1);
  await act(async () => { changed(); changed(); changed(); await vi.advanceTimersByTimeAsync(80); });
  expect(getInboxPresentation).toHaveBeenCalledTimes(2);
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('clears account data and rejects an older in-flight response after session change', async () => {
  vi.useFakeTimers();
  let sessionChanged!: () => void;
  let inboxChanged!: () => void;
  let finishOld!: (value: VoiceInboxPresentation) => void;
  const empty: VoiceInboxPresentation = { folderPath: null, notes: [], truncated: false };
  const getInboxPresentation = vi.fn().mockResolvedValueOnce(presentation)
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValue(empty);
  window.authAPI = { onSessionChanged: (callback: () => void) => { sessionChanged = callback; return () => {}; } } as NonNullable<Window['authAPI']>;
  window.voiceWorkAPI = { getInboxPresentation,
    onInboxChanged: (callback: () => void) => { inboxChanged = callback; return () => {}; },
    onStateChanged: () => () => {},
  } as unknown as NonNullable<Window['voiceWorkAPI']>;
  const { result } = renderHook(() => useVoiceInboxPresentation(true));
  await act(async () => {});
  expect(result.current).toEqual(presentation);
  await act(async () => { inboxChanged(); await vi.advanceTimersByTimeAsync(80); });
  act(() => { sessionChanged(); });
  expect(result.current).toBeNull();
  await act(async () => { finishOld(presentation); });
  expect(result.current).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(80); });
  expect(result.current).toEqual(empty);
});
