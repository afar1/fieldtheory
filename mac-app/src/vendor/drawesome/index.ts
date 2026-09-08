// Engine
export { PENS, PEN_BY_ID } from "./engine/pens";
export { getStroke } from "./engine/freehand";
export type { FreehandOptions } from "./engine/freehand";
export {
  dotRadius,
  eraseLayers,
  nextId,
  polylinePath,
  strokePath,
} from "./engine/geometry";
export { toPng, toSvg } from "./engine/serialize";
// The ceilings, so a host can check its own palette against them.
export {
  MAX_SWATCHES,
  MAX_SWATCHES_COMPACT,
  SWATCHES,
  SWATCHES_COMPACT,
} from "./palette";
export type {
  Board,
  Pen,
  PenId,
  Point,
  Stroke,
  StrokeShape,
  ToolId,
} from "./engine/types";

// Hooks
export { useDrawing } from "./hooks/use-drawing";
export type { DrawingController } from "./hooks/use-drawing";

// Components
export { Draw } from "./components/Draw";
export type {
  DrawControls,
  DrawHandle,
  DrawProps,
  InkMode,
  MotionOptions,
  MotionPreset,
} from "./components/Draw";
export type { TooltipOptions } from "./components/Tooltip";
export { DrawSurface } from "./components/DrawSurface";
/** The bar on its own, for hosts laying the pieces out themselves. */
export { Toolbar } from "./components/Toolbar";
/** The drawn tools, for the disc a standalone toolbar collapses into. */
export { ToolIcon } from "./components/ToolIcon";
export type { ToolIconId } from "./components/ToolIcon";
export type { ToolState } from "./components/Toolbar";
export type { DrawSurfaceProps, Tool } from "./components/DrawSurface";
