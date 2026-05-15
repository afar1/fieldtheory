import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FieldTheoryProse, { localFileUrlToFieldTheoryUrl } from '../FieldTheoryProse';

const LOCAL_SCREENSHOT_URL = 'file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png';
const LOCAL_SCREENSHOT_RENDER_URL = 'ftlocalfile:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png';

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

  it('preserves internal rendered link hrefs for app navigation', () => {
    render(
      <FieldTheoryProse>
        {'[Launch Work](wiki://scratchpad/launch-work)\n\n[Artifact](artifact://%2Ftmp%2Fartifact.md)\n\n[Command](command://%2Ftmp%2Frefactor.md)'}
      </FieldTheoryProse>
    );

    expect(screen.getByRole('link', { name: 'Launch Work' }).getAttribute('href')).toBe('wiki://scratchpad/launch-work');
    expect(screen.getByRole('link', { name: 'Artifact' }).getAttribute('href')).toBe('artifact://%2Ftmp%2Fartifact.md');
    expect(screen.getByRole('link', { name: 'Command' }).getAttribute('href')).toBe('command://%2Ftmp%2Frefactor.md');
  });

  it('renders with the Field Theory prose class', () => {
    const { container } = render(
      <FieldTheoryProse>
        {'# Heading'}
      </FieldTheoryProse>
    );

    expect(container.querySelector('.ft-prose')).toBeTruthy();
    expect(container.querySelector('.prose-ui')).toBeNull();
    expect(container.querySelector('.ft-prose-ui')).toBeNull();
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

  it('renders markdown text without source offset annotations', () => {
    render(
      <FieldTheoryProse>
        {'Hello **world**'}
      </FieldTheoryProse>
    );

    expect(screen.getByText('world').closest('[data-ft-md-start]')).toBeNull();
  });

  it('wraps long fenced code block lines instead of clipping rendered markdown', () => {
    const proseCss = readFileSync('src/prose.css', 'utf-8');
    const preCodeRule = proseCss.match(/\.ft-prose pre code\s*\{[^}]*\}/)?.[0] ?? '';

    expect(preCodeRule).toContain('white-space: pre-wrap;');
    expect(preCodeRule).toContain('overflow-wrap: anywhere;');
  });

  it('uses a hanging layout for rendered task-list text', () => {
    const proseCss = readFileSync('src/prose.css', 'utf-8');
    const taskRule = proseCss.match(/\.ft-prose li\.task-list-item\s*\{[^}]*\}/)?.[0] ?? '';

    expect(taskRule).toContain('display: grid;');
    expect(taskRule).toContain('grid-template-columns: max-content minmax(0, 1fr);');
  });

  it('renders local screenshot image URLs inline', () => {
    render(
      <FieldTheoryProse>
        {`![Figure A](<${LOCAL_SCREENSHOT_URL}>)`}
      </FieldTheoryProse>
    );

    const image = screen.getByRole('img', { name: 'Figure A' });
    expect(image.getAttribute('src')).toBe(LOCAL_SCREENSHOT_RENDER_URL);
  });

  it('routes file image URLs through the Field Theory local-file protocol', () => {
    expect(localFileUrlToFieldTheoryUrl(LOCAL_SCREENSHOT_URL)).toBe(LOCAL_SCREENSHOT_RENDER_URL);
  });

  it('keeps unsafe image URLs stripped', () => {
    render(
      <FieldTheoryProse>
        {'![Unsafe](javascript:alert(1))'}
      </FieldTheoryProse>
    );

    expect(screen.getByRole('img', { name: 'Unsafe' }).getAttribute('src')).toBe('');
  });
});
