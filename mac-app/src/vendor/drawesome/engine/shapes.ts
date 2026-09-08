import type { Point, ShapeId, ToolId } from "./types";

export const SHAPES: { id: ShapeId; name: string; key: string }[] = [
  { id: "rectangle", name: "Rectangle", key: "r" },
  { id: "line", name: "Line", key: "l" },
  { id: "circle", name: "Circle", key: "o" },
];

export function isShape(id: ToolId): id is ShapeId {
  return id === "rectangle" || id === "line" || id === "circle";
}

export function shapeEndpoint(kind: ShapeId, start: Point, end: Point, constrain: boolean): Point {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  if (kind === "circle" || (kind === "rectangle" && constrain)) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return [start[0] + (dx < 0 ? -size : size), start[1] + (dy < 0 ? -size : size), .5];
  }
  if (kind === "line" && constrain) {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
    const length = Math.hypot(dx, dy);
    return [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length, .5];
  }
  return [end[0], end[1], .5];
}

export function shapePath(kind: ShapeId, points: Point[]): string {
  if (points.length < 2) return "";
  const [start, end] = points;
  const x = Math.min(start[0], end[0]), y = Math.min(start[1], end[1]);
  const w = Math.abs(end[0] - start[0]), h = Math.abs(end[1] - start[1]);
  if (kind === "line") return w || h ? `M${start[0]} ${start[1]}L${end[0]} ${end[1]}` : "";
  if (!w || !h) return "";
  if (kind === "rectangle") return `M${x} ${y}h${w}v${h}h${-w}Z`;
  const radius = Math.min(w, h) / 2, cy = y + h / 2, cx = x + w / 2;
  return `M${cx - radius} ${cy}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`;
}
