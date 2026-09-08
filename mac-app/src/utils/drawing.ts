import { toSvg, esc } from '../vendor/drawesome/engine/serialize';
import type { Stroke, Board } from '../vendor/drawesome/engine/types';
export const SKETCH_EXPORT_PADDING = 48;
export const DRAWING_DRAFT_KEY = 'pendingSketch.drawesome.v1';
export type DrawingImage = { dataUrl: string; width: number; height: number };
export type PlacedImage = DrawingImage & { x: number; y: number };
export type DrawingDraft = { version: 1; engine: 'drawesome'; strokes: Stroke[]; board: Board; paper: string; image?: DrawingImage; timestamp: number };
export function readDrawingDraft(): DrawingDraft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAWING_DRAFT_KEY) || 'null');
    if (draft?.version === 1 && draft.engine === 'drawesome' && Array.isArray(draft.strokes) && draft.board?.w > 0 && draft.board?.h > 0) return draft;
  } catch { /* Never delete an unreadable draft. */ }
  return null;
}
export function placeImage(image: DrawingImage, board: Board): PlacedImage {
  const scale = Math.min(board.w * .5 / image.width, board.h * .5 / image.height, 1);
  const width = image.width * scale, height = image.height * scale;
  return { ...image, width, height, x: (board.w - width) / 2, y: (board.h - height) / 2 };
}
async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Cannot load drawing image')); image.src = url; });
  return image;
}
/** Place the image outside ink masks, but inside the SVG so highlighter blending matches the canvas. */
export async function exportDrawing(strokes: Stroke[], board: Board, paper: string, image: PlacedImage | null, scale: number) {
  let svg = toSvg(strokes, board.w, board.h, null);
  if (image) {
    await loadImage(image.dataUrl);
    const underlay = `<image href="${esc(image.dataUrl)}" x="${image.x}" y="${image.y}" width="${image.width}" height="${image.height}"/>`;
    svg = svg.replace('>', `>${underlay}`);
  }
  const ink = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const layer = document.createElement('canvas');
  layer.width = Math.ceil(board.w * scale); layer.height = Math.ceil(board.h * scale);
  const ctx = layer.getContext('2d');
  if (!ctx) throw new Error('Cannot create drawing canvas');
  ctx.drawImage(ink, 0, 0, layer.width, layer.height);
  // Alpha bounds reflect actual erasing, pressure outlines and transparent images.
  const pixels = ctx.getImageData(0, 0, layer.width, layer.height).data;
  let left = layer.width, top = layer.height, right = -1, bottom = -1;
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
    if (pixels[(y * layer.width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (right < 0) throw new Error('The drawing is empty');
  const padding = Math.round(SKETCH_EXPORT_PADDING * scale);
  const out = document.createElement('canvas');
  out.width = right - left + 1 + padding * 2; out.height = bottom - top + 1 + padding * 2;
  const output = out.getContext('2d');
  if (!output) throw new Error('Cannot create export canvas');
  output.fillStyle = paper; output.fillRect(0, 0, out.width, out.height);
  output.drawImage(layer, padding - left, padding - top);
  return { dataUrl: out.toDataURL('image/png'), width: out.width, height: out.height };
}
