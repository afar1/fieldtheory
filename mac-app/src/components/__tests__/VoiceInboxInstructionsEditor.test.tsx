import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import VoiceInboxInstructionsEditor from '../VoiceInboxInstructionsEditor';
import { DEFAULT_VOICE_INBOX_INSTRUCTIONS } from '../../../electron/shared/voiceInboxInstructions';
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { text: '#111', textSecondary: '#666', border: '#ccc' } }) }));
afterEach(cleanup);
it('shows the verbatim default without saving, then saves exact edits and resets the persisted default', async () => {
  const save = vi.fn(async () => {});
  const view = render(<VoiceInboxInstructionsEditor disabled={false} onSave={save} />);
  expect((screen.getByLabelText('Voice inbox instructions') as HTMLTextAreaElement).value).toBe(DEFAULT_VOICE_INBOX_INSTRUCTIONS);
  expect(save).not.toHaveBeenCalled();
  const text = '  Route to my research project.\nDo not ask routine questions.  ';
  fireEvent.change(screen.getByLabelText('Voice inbox instructions'), { target: { value: text } });
  fireEvent.click(screen.getByText('Save changes'));
  await waitFor(() => expect(save).toHaveBeenCalledWith(text));
  await screen.findByText(/Saved. Applies/);
  view.rerender(<VoiceInboxInstructionsEditor saved={text} disabled={false} onSave={save} />);
  fireEvent.click(screen.getByText('Reset to defaults'));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(DEFAULT_VOICE_INBOX_INSTRUCTIONS));
});
it('keeps unsaved text when persistence fails', async () => {
  render(<VoiceInboxInstructionsEditor disabled={false} onSave={async () => { throw new Error('disk'); }} />);
  fireEvent.change(screen.getByLabelText('Voice inbox instructions'), { target: { value: 'My edits' } });
  fireEvent.click(screen.getByText('Save changes'));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Voice inbox instructions') as HTMLTextAreaElement).value).toBe('My edits');
});
