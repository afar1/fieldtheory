import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LinkedDocumentsSection from '../LinkedDocumentsSection';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      border: '#ddd',
      text: '#111',
      textSecondary: '#666',
    },
  }),
}));

describe('LinkedDocumentsSection', () => {
  it('renders with the fade interaction class', () => {
    render(
      <LinkedDocumentsSection
        links={[
          {
            target: { kind: 'wiki', relPath: 'Notes/Example' },
            title: 'Example',
            excerpt: 'A linked note',
            direction: 'outbound',
          },
        ]}
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Linked').classList.contains('linked-documents-section')).toBe(true);
  });
});
