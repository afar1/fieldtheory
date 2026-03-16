import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDERER_SQUARES_CONFIG,
  normalizeSquaresConfig,
} from '../utils/squaresConfig';

describe('normalizeSquaresConfig', () => {
  it('returns renderer defaults when config is missing', () => {
    expect(normalizeSquaresConfig(undefined)).toEqual(DEFAULT_RENDERER_SQUARES_CONFIG);
    expect(normalizeSquaresConfig(null)).toEqual(DEFAULT_RENDERER_SQUARES_CONFIG);
  });

  it('preserves provided values while filling missing fields from defaults', () => {
    expect(normalizeSquaresConfig({
      enabled: false,
      showInCommandLauncher: false,
      focusWidthPercent: 72,
    })).toEqual({
      ...DEFAULT_RENDERER_SQUARES_CONFIG,
      enabled: false,
      showInCommandLauncher: false,
      focusWidthPercent: 72,
    });
  });
});
