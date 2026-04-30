import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FieldTheoryProse from '../FieldTheoryProse';

describe('FieldTheoryProse', () => {
  it('renders GFM tables, task lists, and line breaks', () => {
    render(
      <FieldTheoryProse remarkLineBreaks>
        {'first\nsecond\n\n- [x] done\n\n| A | B |\n| - | - |\n| 1 | 2 |'}
      </FieldTheoryProse>
    );

    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'first\nsecond')).toBeTruthy();
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('keeps caller link behavior overrideable', () => {
    const onClick = vi.fn();
    render(
      <FieldTheoryProse
        components={{
          a: ({ children, href }) => (
            <a href={href} onClick={onClick}>
              {children}
            </a>
          ),
        }}
      >
        {'[Field Theory](https://fieldtheory.ai)'}
      </FieldTheoryProse>
    );

    screen.getByRole('link', { name: 'Field Theory' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('can render with the Prose UI stylesheet class', () => {
    const { container } = render(
      <FieldTheoryProse renderer="prose-ui">
        {'# Heading'}
      </FieldTheoryProse>
    );

    expect(container.querySelector('.prose-ui')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy();
  });

  it('sets paragraph spacing as a prose CSS variable', () => {
    const { container } = render(
      <FieldTheoryProse paragraphSpacing="1.08em">
        {'One\n\nTwo'}
      </FieldTheoryProse>
    );

    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--ft-prose-paragraph-spacing')).toBe('1.08em');
  });
});
