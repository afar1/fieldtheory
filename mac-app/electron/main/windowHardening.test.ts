import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hardenWindow, isAllowedWindowNavigation } from './windowHardening';

describe('window hardening', () => {
  beforeEach(() => {
    delete process.env.ELECTRON_START_URL;
  });

  it('denies renderer-created popup windows', () => {
    const setWindowOpenHandler = vi.fn();
    const window = {
      webContents: {
        setWindowOpenHandler,
        on: vi.fn(),
      },
    };

    hardenWindow(window as any);

    expect(setWindowOpenHandler).toHaveBeenCalledTimes(1);
    expect(setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
  });

  it('blocks top-level navigation outside app-owned origins', () => {
    const listeners = new Map<string, Function>();
    const window = {
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((event: string, callback: Function) => listeners.set(event, callback)),
      },
    };
    const preventDefault = vi.fn();

    hardenWindow(window as any, { allowedOrigins: ['http://localhost:5173'] });
    listeners.get('will-navigate')?.({ preventDefault }, 'https://example.com/sign-in');

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('allows top-level navigation inside app-owned origins', () => {
    const listeners = new Map<string, Function>();
    const window = {
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((event: string, callback: Function) => listeners.set(event, callback)),
      },
    };
    const preventDefault = vi.fn();

    hardenWindow(window as any, { allowedOrigins: ['http://localhost:5173'] });
    listeners.get('will-navigate')?.({ preventDefault }, 'http://localhost:5173/library.html');

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('allows only the configured dev-server origin by default', () => {
    process.env.ELECTRON_START_URL = 'http://localhost:5173/';

    expect(isAllowedWindowNavigation('file:///Applications/Field%20Theory/index.html')).toBe(false);
    expect(isAllowedWindowNavigation('http://localhost:5173/command-launcher.html')).toBe(true);
    expect(isAllowedWindowNavigation('http://localhost:5174/command-launcher.html')).toBe(false);
  });
});
