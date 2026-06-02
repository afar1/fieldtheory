export const FOCUS_CHROME_GROUP_REVEAL_DISTANCE_PX = 220;
export const FOCUS_CHROME_TOP_FULL_OPACITY_DISTANCE_PX = 160;
export const FOCUS_CHROME_EDGE_FULL_OPACITY_DISTANCE_PX = 128;

export type ClientBounds = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

export function isClientPointOutsideBounds(clientX: number, clientY: number, bounds: ClientBounds): boolean {
  return clientX < bounds.left
    || clientX > bounds.right
    || clientY < bounds.top
    || clientY > bounds.bottom;
}

export function shouldRevealFocusChrome(
  cursorClientY: number,
  paneClientTop: number,
  revealDistancePx = 96,
): boolean {
  if (!Number.isFinite(cursorClientY) || !Number.isFinite(paneClientTop)) return false;
  return cursorClientY >= paneClientTop && cursorClientY <= paneClientTop + Math.max(0, revealDistancePx);
}

export function shouldRevealGroupedFocusChrome(input: {
  cursorClientY: number;
  paneClientTop: number;
  viewportHeight: number;
  revealDistancePx?: number;
}): boolean {
  return getGroupedFocusChromeProximityOpacity(input) > 0;
}

export function getGroupedFocusChromeProximityOpacity(input: {
  cursorClientY: number;
  paneClientTop: number;
  viewportHeight: number;
  revealDistancePx?: number;
  fullOpacityDistancePx?: number;
  topFullOpacityDistancePx?: number;
  bottomFullOpacityDistancePx?: number;
}): number {
  const revealDistancePx = Math.max(0, input.revealDistancePx ?? 128);
  const fullOpacityDistancePx = Math.max(0, Math.min(revealDistancePx, input.fullOpacityDistancePx ?? 28));
  const topFullOpacityDistancePx = Math.max(
    0,
    Math.min(revealDistancePx, input.topFullOpacityDistancePx ?? fullOpacityDistancePx),
  );
  const bottomFullOpacityDistancePx = Math.max(
    0,
    Math.min(revealDistancePx, input.bottomFullOpacityDistancePx ?? fullOpacityDistancePx),
  );
  if (
    !Number.isFinite(input.cursorClientY) ||
    !Number.isFinite(input.paneClientTop) ||
    !Number.isFinite(input.viewportHeight) ||
    input.viewportHeight <= 0 ||
    revealDistancePx <= 0
  ) {
    return 0;
  }

  const topDistance = input.cursorClientY - input.paneClientTop;
  const bottomDistance = input.viewportHeight - input.cursorClientY;
  const opacityForDistance = (distance: number, fullDistance: number) => {
    if (distance < 0 || distance > revealDistancePx) return 0;
    if (distance <= fullDistance) return 1;
    const fadeDistance = Math.max(1, revealDistancePx - fullDistance);
    return 1 - ((distance - fullDistance) / fadeDistance);
  };

  return Math.max(
    0,
    Math.min(1, Number(Math.max(
      opacityForDistance(topDistance, topFullOpacityDistancePx),
      opacityForDistance(bottomDistance, bottomFullOpacityDistancePx),
    ).toFixed(3))),
  );
}

export function getFocusChromeSurfaceOpacity(input: {
  isFocusChromeSurface: boolean;
  focusChromeActive: boolean;
}): number {
  if (!input.isFocusChromeSurface || !input.focusChromeActive) return 1;
  return 0;
}

export function getFocusChromeScopedItemOpacity(input: {
  focusChromeActive: boolean;
  visualOpacity: number;
}): number {
  if (!input.focusChromeActive) return 1;
  return Math.max(0, Math.min(1, input.visualOpacity));
}
