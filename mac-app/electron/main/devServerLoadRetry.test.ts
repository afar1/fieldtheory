import { describe, expect, it } from 'vitest';
import { devServerPageUrl, isDevServerConnectionRefused, shouldRetryDevServerLoad } from './devServerLoadRetry';

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
