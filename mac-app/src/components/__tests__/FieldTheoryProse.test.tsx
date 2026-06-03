import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FieldTheoryProse, { localFileUrlToFieldTheoryUrl } from '../FieldTheoryProse';

const LOCAL_SCREENSHOT_URL = 'file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png';
const LOCAL_SCREENSHOT_RENDER_URL = 'ftlocalfile:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png';

describe('FieldTheoryProse', () => {
  afterEach(() => {
    delete window.fieldTheoryLocalImageAPI;
  });

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
    const taskCheckboxRule = proseCss.match(/\.ft-prose li\.task-list-item > input\[type='checkbox'\]\s*\{[^}]*\}/)?.[0] ?? '';

    expect(taskRule).toContain('display: grid;');
    expect(taskRule).toContain('grid-template-columns: max-content minmax(0, 1fr);');
    expect(taskRule).toContain('align-items: start;');
    expect(taskCheckboxRule).toContain('top: calc(((var(--ft-prose-line-height) * 1em) - 0.88em) / 2);');
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

  it('routes local screenshot images through the browser helper when available', () => {
    window.fieldTheoryLocalImageAPI = {
      localImageUrl: (url) => `/native/local-image?url=${encodeURIComponent(url)}`,
    };

    render(
      <FieldTheoryProse>
        {`![Figure A](<${LOCAL_SCREENSHOT_URL}>)`}
      </FieldTheoryProse>
    );

    const image = screen.getByRole('img', { name: 'Figure A' });
    expect(image.getAttribute('src')).toBe('/native/local-image?url=ftlocalfile%3A%2F%2F%2FUsers%2Fafar%2FLibrary%2FApplication%2520Support%2Ffieldtheory-mac%2Fusers%2Fu%2Ffigures%2FScreenshot%25201.png');
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

  it('renders fenced ft-html blocks as sandboxed inline previews', () => {
    const { container } = render(
      <FieldTheoryProse documentPath="/tmp/Field Theory/report.md">
        {'Prose above\n\n```ft-html\n<section>Widget</section>\n```\n\nProse below'}
      </FieldTheoryProse>
    );

    expect(screen.getByText('Prose above')).toBeTruthy();
    expect(screen.getByText('Prose below')).toBeTruthy();
    const iframe = container.querySelector('iframe[data-ft-inline-html-preview="true"]') as HTMLIFrameElement | null;
    expect(iframe?.getAttribute('sandbox')).toBe('');
    expect(iframe?.getAttribute('srcdoc')).toContain('<base href="file:///tmp/Field%20Theory/">');
    expect(iframe?.getAttribute('srcdoc')).toContain('<section>Widget</section>');
  });

  it('keeps raw markdown HTML escaped outside explicit ft-html fences', () => {
    const { container } = render(
      <FieldTheoryProse>
        {'<section>Raw HTML</section>'}
      </FieldTheoryProse>
    );

    expect(container.querySelector('section')).toBeNull();
    expect(screen.getByText('<section>Raw HTML</section>')).toBeTruthy();
  });

  it('toggles inline HTML blocks between contained and expanded display', () => {
    const { container } = render(
      <FieldTheoryProse>
        {'```ft-html\n<section>Widget</section>\n```'}
      </FieldTheoryProse>
    );

    const block = container.querySelector('[data-ft-inline-html-block="true"]');
    fireEvent.click(screen.getByRole('button', { name: 'Expand HTML block' }));
    expect(block?.classList.contains('ft-inline-html-block-expanded')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse HTML block' }));
    expect(block?.classList.contains('ft-inline-html-block-expanded')).toBe(false);
  });
});
