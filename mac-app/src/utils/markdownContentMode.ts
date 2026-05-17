export type MarkdownContentMode = 'rendered' | 'markdown' | 'typedown';

const MARKDOWN_CONTENT_MODES: readonly MarkdownContentMode[] = ['rendered', 'markdown', 'typedown'];

export function isMarkdownContentMode(value: unknown): value is MarkdownContentMode {
  return typeof value === 'string' && MARKDOWN_CONTENT_MODES.includes(value as MarkdownContentMode);
}

export function getAvailableMarkdownContentModes(input: {
  sourceOnly?: boolean;
  typedownEnabled?: boolean;
} = {}): MarkdownContentMode[] {
  if (input.sourceOnly) return ['markdown'];
  return input.typedownEnabled ? ['rendered', 'markdown', 'typedown'] : ['rendered', 'markdown'];
}

export function coerceMarkdownContentMode(
  mode: unknown,
  input: {
    fallback?: MarkdownContentMode;
    sourceOnly?: boolean;
    typedownEnabled?: boolean;
  } = {},
): MarkdownContentMode {
  const fallback = input.fallback ?? 'rendered';
  const available = getAvailableMarkdownContentModes(input);
  if (isMarkdownContentMode(mode) && available.includes(mode)) return mode;
  return available.includes(fallback) ? fallback : available[0];
}

export function getNextMarkdownContentMode(
  mode: MarkdownContentMode,
  input: {
    sourceOnly?: boolean;
    typedownEnabled?: boolean;
  } = {},
): MarkdownContentMode {
  const available = getAvailableMarkdownContentModes(input);
  const current = coerceMarkdownContentMode(mode, input);
  const index = available.indexOf(current);
  return available[(index + 1) % available.length];
}
