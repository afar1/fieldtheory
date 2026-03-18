import { describe, expect, it } from 'vitest';
import {
  formatDebatePlainText,
  generateMessageId,
  generateRootMessageId,
  stripQuotedReply,
} from './transport';

describe('transport helpers', () => {
  describe('generateMessageId', () => {
    it('produces a valid Message-ID format', () => {
      const id = generateMessageId('abc123', 3);
      expect(id).toBe('<council-abc123-turn-3@fieldtheory.app>');
    });

    it('uses turn number in the ID', () => {
      const id1 = generateMessageId('thread1', 1);
      const id2 = generateMessageId('thread1', 2);
      expect(id1).not.toBe(id2);
      expect(id1).toContain('turn-1');
      expect(id2).toContain('turn-2');
    });
  });

  describe('generateRootMessageId', () => {
    it('produces a root Message-ID', () => {
      const id = generateRootMessageId('thread-xyz');
      expect(id).toBe('<council-thread-xyz-root@fieldtheory.app>');
    });
  });

  describe('stripQuotedReply', () => {
    it('removes common quoted reply sections', () => {
      const body = [
        'This is the new reply.',
        '',
        'On Tue, Mar 18, 2026 at 1:00 PM Codex wrote:',
        '> Prior quoted content',
      ].join('\n');

      expect(stripQuotedReply(body)).toBe('This is the new reply.');
    });
  });

  describe('formatDebatePlainText', () => {
    it('formats a simple plain-text debate email body', () => {
      const body = formatDebatePlainText('Point one.\n\nPoint two.', 'Codex (GPT-5.3)');
      expect(body).toContain('Codex (GPT-5.3)');
      expect(body).toContain('Point one.');
      expect(body).toContain('Reply to this email to join the debate.');
    });
  });
});
