import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarkdownPreviewCard from '../MarkdownPreviewCard';

describe('MarkdownPreviewCard', () => {
  it('renders markdown preview metadata and content', () => {
    render(
      <MarkdownPreviewCard
        title="refactor.md"
        filePath="/Users/afar/.fieldtheory/commands/refactor.md"
        content={'# Refactor\n\nPreview **before** pasting.'}
      />
    );

    expect(screen.getByText('refactor.md')).toBeTruthy();
    expect(screen.getByText('/Users/afar/.fieldtheory/commands/refactor.md')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Refactor' })).toBeTruthy();
    expect(screen.getByText('before')).toBeTruthy();
  });
});
