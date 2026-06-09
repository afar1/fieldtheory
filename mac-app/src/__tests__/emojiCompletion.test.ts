import { describe, expect, it } from 'vitest';
import {
  getActiveMarkdownEmojiCompletion,
  getMarkdownEmojiCompletionReplacement,
  rankMarkdownEmojiSuggestions,
} from '../utils/emojiCompletion';

describe('getActiveMarkdownEmojiCompletion', () => {
  it('detects a colon query before the caret', () => {
    expect(getActiveMarkdownEmojiCompletion('Ship it :roc', 12, 12)).toEqual({
      triggerStart: 8,
      queryStart: 9,
      queryEnd: 12,
      query: 'roc',
    });
  });

  it('requires a word boundary before the colon', () => {
    expect(getActiveMarkdownEmojiCompletion('http://x.test:3000', 18, 18)).toBeNull();
  });

  it('ignores selections', () => {
    expect(getActiveMarkdownEmojiCompletion('Ship :rocket', 5, 12)).toBeNull();
  });
});

describe('rankMarkdownEmojiSuggestions', () => {
  it('ranks exact and prefix matches first', () => {
    expect(rankMarkdownEmojiSuggestions('roc').map(item => item.emoji)).toEqual(['🚀']);
    expect(rankMarkdownEmojiSuggestions('done').map(item => item.emoji)[0]).toBe('✅');
  });

  it('returns several hand emoji for hands queries', () => {
    expect(rankMarkdownEmojiSuggestions('hands').map(item => item.emoji)).toEqual(
      expect.arrayContaining(['🙌', '👏', '🤝', '✋']),
    );
    expect(rankMarkdownEmojiSuggestions('hands').length).toBeGreaterThanOrEqual(4);
  });
});

describe('getMarkdownEmojiCompletionReplacement', () => {
  it('replaces the typed token with the selected emoji', () => {
    const markdown = 'Ship :rocket today';
    const completion = getActiveMarkdownEmojiCompletion(markdown, 12, 12);
    expect(getMarkdownEmojiCompletionReplacement(markdown, completion, {
      emoji: '🚀',
      name: 'rocket',
      aliases: [],
    })).toEqual({
      nextValue: 'Ship 🚀 today',
      selectionStart: 7,
      selectionEnd: 7,
    });
  });
});
