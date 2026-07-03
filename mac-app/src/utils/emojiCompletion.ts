export type MarkdownEmojiCompletion = {
  triggerStart: number;
  queryStart: number;
  queryEnd: number;
  query: string;
};

export type MarkdownEmojiSuggestion = {
  emoji: string;
  name: string;
  aliases: string[];
};

export type MarkdownEmojiCompletionEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

export const MARKDOWN_EMOJI_SUGGESTIONS: MarkdownEmojiSuggestion[] = [
  { emoji: '😀', name: 'grinning', aliases: ['smile', 'happy'] },
  { emoji: '😄', name: 'smile', aliases: ['happy', 'grin'] },
  { emoji: '😂', name: 'joy', aliases: ['laugh', 'tears'] },
  { emoji: '🤣', name: 'rofl', aliases: ['laugh', 'rolling'] },
  { emoji: '😍', name: 'heart eyes', aliases: ['love'] },
  { emoji: '🥰', name: 'smiling hearts', aliases: ['love', 'affection'] },
  { emoji: '🤔', name: 'thinking', aliases: ['think'] },
  { emoji: '🙌', name: 'raised hands', aliases: ['hands', 'celebrate', 'hooray'] },
  { emoji: '👏', name: 'clap', aliases: ['hands', 'applause'] },
  { emoji: '👋', name: 'wave', aliases: ['hands', 'hello'] },
  { emoji: '🤝', name: 'handshake', aliases: ['hands', 'agreement'] },
  { emoji: '✋', name: 'raised hand', aliases: ['hands', 'stop'] },
  { emoji: '🤚', name: 'back of hand', aliases: ['hands', 'raised'] },
  { emoji: '👌', name: 'ok hand', aliases: ['hands', 'ok'] },
  { emoji: '🤌', name: 'pinched fingers', aliases: ['hands', 'chef kiss'] },
  { emoji: '🤲', name: 'palms up together', aliases: ['hands', 'please'] },
  { emoji: '👍', name: 'thumbs up', aliases: ['yes', 'like'] },
  { emoji: '👎', name: 'thumbs down', aliases: ['no', 'dislike'] },
  { emoji: '💪', name: 'muscle', aliases: ['strong', 'flex'] },
  { emoji: '🙏', name: 'pray', aliases: ['thanks', 'please'] },
  { emoji: '🎉', name: 'party popper', aliases: ['celebrate', 'ship'] },
  { emoji: '🔥', name: 'fire', aliases: ['hot'] },
  { emoji: '✨', name: 'sparkles', aliases: ['sparkle', 'magic'] },
  { emoji: '✅', name: 'check', aliases: ['done', 'fixed'] },
  { emoji: '❌', name: 'cross', aliases: ['x', 'no'] },
  { emoji: '⚠️', name: 'warning', aliases: ['warn'] },
  { emoji: '🚨', name: 'rotating light', aliases: ['alert', 'urgent'] },
  { emoji: '💡', name: 'bulb', aliases: ['idea', 'light'] },
  { emoji: '🚀', name: 'rocket', aliases: ['ship', 'launch'] },
  { emoji: '🛠️', name: 'tools', aliases: ['fix', 'build'] },
  { emoji: '🔧', name: 'wrench', aliases: ['fix', 'tool'] },
  { emoji: '🐛', name: 'bug', aliases: ['debug', 'issue'] },
  { emoji: '📌', name: 'pin', aliases: ['pinned'] },
  { emoji: '📎', name: 'paperclip', aliases: ['attach'] },
  { emoji: '📚', name: 'books', aliases: ['library', 'docs'] },
  { emoji: '🔍', name: 'magnifying glass', aliases: ['search', 'find'] },
  { emoji: '🧠', name: 'brain', aliases: ['mind'] },
  { emoji: '👀', name: 'eyes', aliases: ['look'] },
  { emoji: '❤️', name: 'heart', aliases: ['love'] },
  { emoji: '⭐', name: 'star', aliases: ['favorite'] },
  { emoji: '📝', name: 'memo', aliases: ['note', 'write'] },
  { emoji: '📄', name: 'page', aliases: ['doc', 'file'] },
  { emoji: '🧭', name: 'compass', aliases: ['navigate', 'direction'] },
];

function isEmojiBoundary(char: string): boolean {
  return !char || /\s|[\([{'"`]/.test(char);
}

export function getActiveMarkdownEmojiCompletion(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEmojiCompletion | null {
  if (selectionStart !== selectionEnd) return null;
  const caret = Math.max(0, Math.min(selectionStart, markdown.length));
  const beforeCaret = markdown.slice(0, caret);
  const match = beforeCaret.match(/:([a-zA-Z0-9_+-]{1,32})$/);
  if (!match || match.index === undefined) return null;
  const triggerStart = match.index;
  if (!isEmojiBoundary(markdown[triggerStart - 1] ?? '')) return null;
  return {
    triggerStart,
    queryStart: triggerStart + 1,
    queryEnd: caret,
    query: match[1],
  };
}

export function rankMarkdownEmojiSuggestions(
  query: string,
  items: MarkdownEmojiSuggestion[] = MARKDOWN_EMOJI_SUGGESTIONS,
  limit = 8,
): MarkdownEmojiSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  return items
    .map((item) => {
      const labels = [item.name, ...item.aliases].map(label => label.toLowerCase());
      const exact = labels.some(label => label === normalizedQuery);
      const prefix = labels.some(label => label.startsWith(normalizedQuery));
      const includes = labels.some(label => label.includes(normalizedQuery));
      if (!exact && !prefix && !includes) return null;
      return { item, score: exact ? 0 : prefix ? 1 : 2 };
    })
    .filter((entry): entry is { item: MarkdownEmojiSuggestion; score: number } => !!entry)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map(entry => entry.item);
}

export function getMarkdownEmojiCompletionReplacement(
  markdown: string,
  completion: MarkdownEmojiCompletion | null,
  suggestion: MarkdownEmojiSuggestion,
): MarkdownEmojiCompletionEdit | null {
  if (!completion) return null;
  const nextValue = `${markdown.slice(0, completion.triggerStart)}${suggestion.emoji}${markdown.slice(completion.queryEnd)}`;
  const selection = completion.triggerStart + suggestion.emoji.length;
  return {
    nextValue,
    selectionStart: selection,
    selectionEnd: selection,
  };
}
