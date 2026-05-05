import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('DynamicIsland floating pill', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    delete (window as any).dynamicIslandAPI;
    window.history.pushState({}, '', '/');
  });

  it('renders the floating waveform and stack slots from existing island events', async () => {
    vi.useFakeTimers();
    const callbacks: Record<string, Array<(value: any) => void>> = {
      state: [],
      audio: [],
      stack: [],
      hotmic: [],
      meter: [],
      resize: [],
    };

    const cancelSession = vi.fn();
    const openFieldTheory = vi.fn();
    (window as any).dynamicIslandAPI = {
      onStateChange: (cb: (state: string) => void) => callbacks.state.push(cb),
      onStandardAudioLevel: (cb: (level: number) => void) => callbacks.audio.push(cb),
      onStackChanged: (cb: (count: number) => void) => callbacks.stack.push(cb),
      onHotMicUpdate: (cb: (data: unknown) => void) => callbacks.hotmic.push(cb),
      onHotMicFilterMeter: (cb: (data: unknown) => void) => callbacks.meter.push(cb),
      onResize: (cb: (data: unknown) => void) => callbacks.resize.push(cb),
      cancelSession,
      openFieldTheory,
      removeAllListeners: vi.fn(),
    };
    window.history.pushState({}, '', '/dynamic-island.html?side=floating&rightWidth=30');
    vi.resetModules();

    const { default: DynamicIsland } = await import('../DynamicIsland');
    const { container } = render(<DynamicIsland />);

    const floatingSection = container.querySelector('.di-section--floating') as HTMLElement;
    expect(floatingSection).toBeTruthy();
    expect(floatingSection.style.width).toBe('30px');
    const shell = container.querySelector('.di-floating-shell') as HTMLElement;
    expect(shell).toBeTruthy();

    const cancelButton = container.querySelector('.di-floating-cancel') as HTMLButtonElement;
    expect(cancelButton).toBeTruthy();

    const openButton = container.querySelector('.di-floating-open') as HTMLButtonElement;
    expect(openButton).toBeTruthy();
    const openIcon = openButton.querySelector('svg');
    expect(openIcon?.getAttribute('width')).toBe('14');
    expect(openButton.style.color).toBe('rgba(255, 255, 255, 0.78)');
    expect(openButton.style.borderRadius).toBe('');
    expect(openButton.style.transition).toBe('opacity 140ms ease');
    expect(cancelButton.querySelector('svg')?.getAttribute('width')).toBe('10');
    expect(openButton.style.opacity).toBe('0');
    expect(cancelButton.style.opacity).toBe('0');
    expect(openButton.style.pointerEvents).toBe('none');
    expect(cancelButton.style.pointerEvents).toBe('none');

    fireEvent.mouseEnter(shell);
    expect(openButton.style.opacity).toBe('1');
    expect(cancelButton.style.opacity).toBe('1');
    expect(openButton.style.pointerEvents).toBe('auto');
    expect(cancelButton.style.pointerEvents).toBe('auto');
    expect(floatingSection.style.width).toBe('30px');
    fireEvent.click(openButton);
    expect(openFieldTheory).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(shell);
    expect(openButton.style.opacity).toBe('0');
    expect(cancelButton.style.opacity).toBe('0');
    expect(openButton.style.pointerEvents).toBe('none');
    expect(cancelButton.style.pointerEvents).toBe('none');

    await act(async () => {
      callbacks.state.forEach((cb) => cb('recording'));
      callbacks.audio.forEach((cb) => cb(0.12));
      callbacks.stack.forEach((cb) => cb(2));
    });

    const visibleSlots = container.querySelectorAll('.di-slot--visible');
    expect(visibleSlots.length).toBeGreaterThanOrEqual(3);
    expect((visibleSlots[0] as HTMLElement).style.getPropertyValue('--di-slot-w')).toBe('18px');
    expect((visibleSlots[1] as HTMLElement).style.getPropertyValue('--di-slot-w')).toBe('30px');
    expect((visibleSlots[2] as HTMLElement).style.getPropertyValue('--di-slot-w')).toBe('12px');
    await act(async () => {
      callbacks.resize.forEach((cb) => cb({ leftWidth: 130, rightWidth: 66 }));
    });
    expect(floatingSection.style.width).toBe('66px');

    fireEvent.click(cancelButton);
    expect(shell.style.opacity).toBe('0');
    expect(cancelButton.disabled).toBe(true);
    expect(cancelSession).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    expect(cancelSession).toHaveBeenCalledTimes(1);
  });

  it('shows a static completion baseline before fading the pill', async () => {
    vi.useFakeTimers();
    const callbacks: Record<string, Array<(value: any) => void>> = {
      state: [],
      audio: [],
      stack: [],
      hotmic: [],
      meter: [],
      resize: [],
    };

    (window as any).dynamicIslandAPI = {
      onStateChange: (cb: (state: string) => void) => callbacks.state.push(cb),
      onStandardAudioLevel: (cb: (level: number) => void) => callbacks.audio.push(cb),
      onStackChanged: (cb: (count: number) => void) => callbacks.stack.push(cb),
      onHotMicUpdate: (cb: (data: unknown) => void) => callbacks.hotmic.push(cb),
      onHotMicFilterMeter: (cb: (data: unknown) => void) => callbacks.meter.push(cb),
      onResize: (cb: (data: unknown) => void) => callbacks.resize.push(cb),
      removeAllListeners: vi.fn(),
    };
    window.history.pushState({}, '', '/dynamic-island.html?side=floating&rightWidth=30');
    vi.resetModules();

    const { default: DynamicIsland } = await import('../DynamicIsland');
    const { container } = render(<DynamicIsland />);
    const shell = container.querySelector('.di-floating-shell') as HTMLElement;

    await act(async () => {
      callbacks.state.forEach((cb) => cb('recording'));
      callbacks.audio.forEach((cb) => cb(0.2));
    });

    await act(async () => {
      callbacks.state.forEach((cb) => cb('completing'));
    });

    const waveformBars = Array.from(container.querySelectorAll('[data-waveform-bar="true"]')) as HTMLElement[];
    expect(waveformBars).toHaveLength(7);
    expect(waveformBars.every((bar) => bar.style.height === '2px')).toBe(true);
    expect(waveformBars.every((bar) => bar.style.backgroundColor === 'rgba(255, 255, 255, 0.92)')).toBe(true);
    expect(shell.style.opacity).toBe('1');

    await act(async () => {
      vi.advanceTimersByTime(60);
    });

    expect(shell.style.opacity).toBe('0');
  });
});
