export interface NormalizedSquaresConfig {
  enabled: boolean;
  showInCommandLauncher: boolean;
  focusHeightPercent: number;
  focusKeepHeight: boolean;
  focusWidthPercent: number;
  horizontalHeightPercent: number;
  horizontalKeepHeight: boolean;
  horizontalHideOthers: boolean;
}

export type PartialSquaresConfig = Partial<NormalizedSquaresConfig> | null | undefined;

export const DEFAULT_RENDERER_SQUARES_CONFIG: NormalizedSquaresConfig = {
  enabled: true,
  showInCommandLauncher: true,
  focusHeightPercent: 80,
  focusKeepHeight: false,
  focusWidthPercent: 60,
  horizontalHeightPercent: 80,
  horizontalKeepHeight: true,
  horizontalHideOthers: true,
};

export function normalizeSquaresConfig(config: PartialSquaresConfig): NormalizedSquaresConfig {
  return {
    ...DEFAULT_RENDERER_SQUARES_CONFIG,
    ...(config ?? {}),
  };
}
