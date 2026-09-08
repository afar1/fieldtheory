import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenVoiceTaskButton } from '../OpenVoiceTaskButton';

vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: {
  border: '#ddd', text: '#111', error: '#c00',
} }) }));

afterEach(() => { cleanup(); delete window.voiceWorkAPI; });

it('opens the exact task once without selecting or renaming the surrounding row', async () => {
  let finish!: (result: { opened: boolean }) => void;
  const openTask = vi.fn(() => new Promise<{ opened: boolean }>((resolve) => { finish = resolve; }));
  window.voiceWorkAPI = { openTask } as unknown as NonNullable<Window['voiceWorkAPI']>;
  const rowClick = vi.fn();
  const rowMouseDown = vi.fn();
  const rowDoubleClick = vi.fn();
  render(<div onClick={rowClick} onMouseDown={rowMouseDown} onDoubleClick={rowDoubleClick}>
    <OpenVoiceTaskButton threadId="task-from-this-note" compact />
  </div>);
  const button = screen.getByRole('button', { name: 'Codex' });
  fireEvent.mouseDown(button);
  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.doubleClick(button);
  expect(openTask).toHaveBeenCalledExactlyOnceWith('task-from-this-note');
  expect(rowClick).not.toHaveBeenCalled();
  expect(rowMouseDown).not.toHaveBeenCalled();
  expect(rowDoubleClick).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Codex' })).toHaveProperty('disabled', true);
  await act(async () => { finish({ opened: true }); });
  expect(screen.getByRole('button', { name: 'Codex' })).toHaveProperty('disabled', false);
});

it('does not show a stale failure after switching to another transcript', async () => {
  let fail!: (result: { opened: boolean; error: string }) => void;
  window.voiceWorkAPI = { openTask: vi.fn(() => new Promise((resolve) => { fail = resolve; })) } as unknown as NonNullable<Window['voiceWorkAPI']>;
  const { rerender } = render(<OpenVoiceTaskButton threadId="first" />);
  fireEvent.click(screen.getByRole('button'));
  rerender(<OpenVoiceTaskButton threadId="second" />);
  await act(async () => { fail({ opened: false, error: 'Old task failed' }); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Codex' })).toHaveProperty('disabled', false);
});
