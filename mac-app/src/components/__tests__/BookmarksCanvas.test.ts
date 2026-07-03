import { describe, expect, it } from 'vitest';
import {
  BOOKMARKS_CANVAS_EDGE_GUTTER_PX,
  getBookmarksCanvasColumnMetrics,
} from '../BookmarksCanvas';

describe('BookmarksCanvas layout metrics', () => {
  it('keeps a symmetric edge gutter around the masonry grid', () => {
    const metrics = getBookmarksCanvasColumnMetrics(917);

    expect(metrics.edgeGutter).toBe(BOOKMARKS_CANVAS_EDGE_GUTTER_PX);
    expect(metrics.edgeGutter).toBe(30);
    expect(metrics.totalWidth).toBeLessThanOrEqual(917);
    expect(metrics.totalWidth - metrics.edgeGutter).toBe(
      metrics.edgeGutter + metrics.itemWidth * metrics.cols + metrics.gap * (metrics.cols - 1),
    );
  });
});
