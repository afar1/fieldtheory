import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PillSlot } from '../PillSlot';

describe('PillSlot', () => {
  it('applies di-slot--visible when visible=true', () => {
    const { container } = render(
      <PillSlot visible={true}>
        <span>icon</span>
      </PillSlot>
    );
    const slot = container.querySelector('.di-slot');
    expect(slot?.className).toContain('di-slot--visible');
    expect(slot?.className).not.toContain('di-slot--hidden');
  });

  it('applies di-slot--hidden when visible=false', () => {
    const { container } = render(
      <PillSlot visible={false}>
        <span>icon</span>
      </PillSlot>
    );
    const slot = container.querySelector('.di-slot');
    expect(slot?.className).toContain('di-slot--hidden');
    expect(slot?.className).not.toContain('di-slot--visible');
  });

  it('sets --di-slot-w and --di-slot-m CSS variables from width and marginRight', () => {
    const { container } = render(
      <PillSlot visible={true} width={32} marginRight={4}>
        <span>icon</span>
      </PillSlot>
    );
    const slot = container.querySelector('.di-slot') as HTMLElement;
    expect(slot?.style.getPropertyValue('--di-slot-w')).toBe('32px');
    expect(slot?.style.getPropertyValue('--di-slot-m')).toBe('4px');
  });

  it('defaults width=22 and marginRight=8', () => {
    const { container } = render(
      <PillSlot visible={true}>
        <span>icon</span>
      </PillSlot>
    );
    const slot = container.querySelector('.di-slot') as HTMLElement;
    expect(slot?.style.getPropertyValue('--di-slot-w')).toBe('22px');
    expect(slot?.style.getPropertyValue('--di-slot-m')).toBe('8px');
  });

  it('renders children inside .di-slot__content', () => {
    const { container } = render(
      <PillSlot visible={true}>
        <span data-testid="glyph">✶</span>
      </PillSlot>
    );
    const content = container.querySelector('.di-slot__content');
    expect(content).not.toBeNull();
    expect(content?.querySelector('[data-testid="glyph"]')?.textContent).toBe('✶');
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    const { container } = render(
      <PillSlot visible={true} onClick={onClick}>
        <span>icon</span>
      </PillSlot>
    );
    fireEvent.click(container.querySelector('.di-slot')!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('sets cursor: pointer only when onClick is provided', () => {
    const { container: clickable } = render(
      <PillSlot visible={true} onClick={() => {}}>
        <span>icon</span>
      </PillSlot>
    );
    const { container: staticSlot } = render(
      <PillSlot visible={true}>
        <span>icon</span>
      </PillSlot>
    );
    expect((clickable.querySelector('.di-slot') as HTMLElement).style.cursor).toBe('pointer');
    expect((staticSlot.querySelector('.di-slot') as HTMLElement).style.cursor).toBe('');
  });

  it('exposes the title attribute for tooltips', () => {
    const { container } = render(
      <PillSlot visible={true} title="cancel session">
        <span>icon</span>
      </PillSlot>
    );
    expect(container.querySelector('.di-slot')?.getAttribute('title')).toBe('cancel session');
  });
});
