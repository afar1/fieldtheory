import { describe, expect, it, vi } from 'vitest';
import {
  devServerPageUrl,
  isDevServerConnectionRefused,
  isDevServerLoadAborted,
  loadDevServerURLWithRetry,
  shouldRetryDevServerLoad,
} from './devServerLoadRetry';

describe('devServerPageUrl', () => {
  it('joins the dev server base URL and page once', () => {
    expect(devServerPageUrl('http://localhost:5173', 'clipboard-history.html')).toBe('http://localhost:5173/clipboard-history.html');
    expect(devServerPageUrl('http://localhost:5173/', 'dynamic-island.html?side=drawer')).toBe('http://localhost:5173/dynamic-island.html?side=drawer');
  });
});

describe('shouldRetryDevServerLoad', () => {
  const retryDelays = [500, 1000];
  const expectedURL = 'http://localhost:5173/clipboard-history.html';

  it('retries connection refused loads for the expected dev page', () => {
    expect(shouldRetryDevServerLoad({
      startUrl: 'http://localhost:5173',
      errorCode: -102,
      validatedURL: expectedURL,
      expectedURL,
      retryIndex: 0,
      retryDelays,
    })).toBe(true);
  });

  it('stops after retry attempts are exhausted', () => {
    expect(shouldRetryDevServerLoad({
      startUrl: 'http://localhost:5173',
      errorCode: -102,
      validatedURL: expectedURL,
      expectedURL,
      retryIndex: retryDelays.length,
      retryDelays,
    })).toBe(false);
  });

  it('does not retry production loads or unrelated failures', () => {
    expect(shouldRetryDevServerLoad({
      errorCode: -102,
      validatedURL: expectedURL,
      expectedURL,
      retryIndex: 0,
      retryDelays,
    })).toBe(false);
    expect(shouldRetryDevServerLoad({
      startUrl: 'http://localhost:5173',
      errorCode: -6,
      validatedURL: expectedURL,
      expectedURL,
      retryIndex: 0,
      retryDelays,
    })).toBe(false);
    expect(shouldRetryDevServerLoad({
      startUrl: 'http://localhost:5173',
      errorCode: -102,
      validatedURL: 'http://localhost:5173/other.html',
      expectedURL,
      retryIndex: 0,
      retryDelays,
    })).toBe(false);
  });
});

describe('isDevServerConnectionRefused', () => {
  it('recognizes Electron connection-refused load failures', () => {
    expect(isDevServerConnectionRefused(-102)).toBe(true);
    expect(isDevServerConnectionRefused(-6)).toBe(false);
  });
});

describe('isDevServerLoadAborted', () => {
  it('recognizes Electron request abort failures', () => {
    expect(isDevServerLoadAborted({ errno: -2 })).toBe(true);
    expect(isDevServerLoadAborted({ code: 'ERR_FAILED' })).toBe(true);
    expect(isDevServerLoadAborted({ errno: -102 })).toBe(false);
  });
});

describe('loadDevServerURLWithRetry', () => {
  it('does not log a failed request after the target window is destroyed', async () => {
    let destroyed = false;
    const win = {
      isDestroyed: () => destroyed,
      loadURL: vi.fn(() => Promise.reject(new Error('ERR_FAILED'))),
      webContents: {
        on: vi.fn(),
      },
      once: vi.fn(),
    };
    const logger = { warn: vi.fn() };

    loadDevServerURLWithRetry(win as any, 'http://localhost:5173', 'dynamic-island.html?side=unified', {
      label: 'DynamicIsland:test',
      logger,
    });
    destroyed = true;
    await Promise.resolve();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not log aborted dev-server page requests', async () => {
    const win = {
      isDestroyed: () => false,
      loadURL: vi.fn(() => Promise.reject({ errno: -2, code: 'ERR_FAILED' })),
      webContents: {
        on: vi.fn(),
      },
      once: vi.fn(),
    };
    const logger = { warn: vi.fn() };

    loadDevServerURLWithRetry(win as any, 'http://localhost:5173', 'dynamic-island.html?side=unified', {
      label: 'DynamicIsland:test',
      logger,
    });
    await Promise.resolve();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs non-abort dev-server page request failures', async () => {
    const win = {
      isDestroyed: () => false,
      loadURL: vi.fn(() => Promise.reject({ errno: -6, code: 'ERR_NAME_NOT_RESOLVED' })),
      webContents: {
        on: vi.fn(),
      },
      once: vi.fn(),
    };
    const logger = { warn: vi.fn() };

    loadDevServerURLWithRetry(win as any, 'http://localhost:5173', 'dynamic-island.html?side=unified', {
      label: 'DynamicIsland:test',
      logger,
    });
    await Promise.resolve();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
