import { useCallback, useEffect, useRef, useState } from "react";
import { PENS } from "../engine/pens";
import type { Pen, PenId, ToolId } from "../engine/types";
import { resolveSwatches } from "../palette";
import { MorphBar } from "./MorphBar";
import { BarSlider } from "./BarSlider";
import {
  BackIcon,
  CollapseIcon,
  DropperIcon,
  RedoIcon,
  UndoIcon,
} from "./icons";
import { HexField, pickFromScreen, supportsEyeDropper } from "./HexField";
import { ToolIcon } from "./ToolIcon";
import { ToolMenu } from "./ToolMenu";
import { useTooltips, type TooltipOptions } from "./Tooltip";
import { TrashIcon } from "./TrashIcon";
import css from "./Toolbar.module.css";
import morph from "./MorphBar.module.css";

export type ToolState = {
  active: ToolId;
  color: string;
  size: number;
  opacity: number;
  eraserSize: number;
};

type Mode = "tools" | "ink" | "brush" | "spectrum";

/** Rough perceptual lightness, to pick a legible tick colour on a swatch. */
function isLight(hex: string) {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (
    (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) /
      255 >
    0.62
  );
}

/** Everything lives in this one bar. */
export function Toolbar({
  tool,
  inkFor,
  tooltips = true,
  pens = PENS,
  eraser = true,
  controls,
  settings = "bar",
  theme,
  look = "classic",
  gauge = false,
  shortcuts = true,
  swatches,
  onSelect,
  onChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  hasStrokes,
  placement = "bottom",
  collapsed = false,
  onCollapse,
  onExpand,
  shift = 0,
  onMeasure,
  icon,
}: {
  tool: ToolState;
  /** The ink a given pen will draw with, so the tray can show it. */
  inkFor: (id: PenId) => string;
  /** Hover labels: `false` for none, or an object to narrow or restyle them. */
  tooltips?: boolean | TooltipOptions;
  /** The pens to offer, in tray order. */
  pens?: Pen[];
  /** Whether the eraser is offered. */
  eraser?: boolean;
  /** Where size and opacity live. */
  settings?: "bar" | "tool";
  theme?: "light" | "dark" | "auto";
  /** How the tools are drawn. */
  look?: "classic" | "studio";
  /** Print the current size on the barrel of the pen in hand. */
  gauge?: boolean;
  /** Whether to advertise keyboard shortcuts in the labels. */
  shortcuts?: boolean;
  /** The colours to offer, in place of the built-in palette. */
  swatches?: string[];
  /** Which built-in controls to show. */
  controls?: {
    color?: boolean;
    size?: boolean;
    opacity?: boolean;
    undo?: boolean;
    clear?: boolean;
    custom?: boolean;
    minimize?: boolean;
  };
  onSelect: (id: ToolId) => void;
  onChange: (patch: Partial<ToolState>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  hasStrokes: boolean;
  placement?: "bottom" | "left" | "right";
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  shift?: number;
  onMeasure?: (w: number, h: number) => void;
  /** Shown in the disc while minimised — the tool you're holding. */
  icon?: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("tools");
  /** Whether the screen can be sampled — settled after mount. */
  const [canPick, setCanPick] = useState(false);
  useEffect(() => setCanPick(supportsEyeDropper()), []);
  const isEraser = tool.active === "eraser";
  const vertical = placement !== "bottom";
  const size = isEraser ? tool.eraserSize : tool.size;
  const maxSize = isEraser ? 120 : 80;
  const tip = useTooltips(tooltips, placement);
  /** The tool whose settings are open, if any. */
  const [openTool, setOpenTool] = useState<HTMLElement | null>(null);
  /** Kept mounted while the menu plays its way out. */
  const [closingTool, setClosingTool] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** What the menu was showing when it started to leave. */
  const live = {
    size,
    maxSize,
    opacity: tool.opacity,
    color: isEraser ? "#c9c7c2" : tool.color,
    // An eraser takes away; there is nothing to be partly opaque about.
    showOpacity: !isEraser,
  };
  const latest = useRef(live);
  latest.current = live;
  const [frozen, setFrozen] = useState<typeof live | null>(null);
  const menu = frozen ?? live;

  const closeMenu = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setFrozen(latest.current);
    setClosingTool(true);
    closeTimer.current = setTimeout(() => {
      setOpenTool(null);
      setClosingTool(false);
      setFrozen(null);
    }, 150);
  }, []);

  const showMenu = useCallback((el: HTMLElement) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setFrozen(null);
    setClosingTool(false);
    setOpenTool(el);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const show = {
    color: controls?.color ?? true,
    size: controls?.size ?? true,
    opacity: controls?.opacity ?? true,
    custom: controls?.custom ?? true,
    undo: controls?.undo ?? true,
    clear: controls?.clear ?? true,
    minimize: controls?.minimize ?? true,
  };

  /* What the size control is called, given what it actually opens. */
  const sizeLabel =
    show.size && show.opacity && !isEraser
      ? "Size & opacity"
      : show.size
        ? "Size"
        : "Opacity";

  const back = (
    <button
      type="button"
      className={css.round}
      onClick={() => setMode("tools")}
      aria-label="Back to tools"
      {...tip.bindControl("Back")}
    >
      <BackIcon />
    </button>
  );

  return (
    <>
      <MorphBar
        active={mode}
        className={
          placement === "bottom"
            ? undefined
            : `${css.vertical} ${placement === "left" ? css.left : css.right}`
        }
        vertical={placement !== "bottom"}
        side={placement === "bottom" ? undefined : placement}
        collapsed={collapsed}
        onExpand={onExpand}
        shift={shift}
        onMeasure={onMeasure}
        collapsedContent={<span className={css.peek}>{icon}</span>}
        panels={[
          {
            id: "tools",
            content: (
              <>
                {show.undo && (
                  <>
                    <span className={css.seated}>
                      <button
                        type="button"
                        className={css.round}
                        disabled={!canUndo}
                        onClick={onUndo}
                        aria-label="Undo"
                        {...tip.bindControl(
                          "Undo",
                          shortcuts ? "⌘Z" : undefined,
                        )}
                      >
                        <UndoIcon />
                      </button>
                    </span>
                    <span className={css.seated}>
                      <button
                        type="button"
                        className={css.round}
                        disabled={!canRedo}
                        onClick={onRedo}
                        aria-label="Redo"
                        {...tip.bindControl(
                          "Redo",
                          shortcuts ? "⇧⌘Z" : undefined,
                        )}
                      >
                        <RedoIcon />
                      </button>
                    </span>
                  </>
                )}

                {show.clear && (
                  <span className={css.seated}>
                    <button
                      type="button"
                      className={css.round}
                      data-tone="danger"
                      disabled={!hasStrokes}
                      onClick={onClear}
                      aria-label="Clear"
                      {...tip.bindControl("Clear all")}
                    >
                      <TrashIcon />
                    </button>
                  </span>
                )}

                {(show.undo || show.clear) && <span className={css.divider} />}

                {pens.map((pen) => (
                  <button
                    key={pen.id}
                    type="button"
                    className={css.tool}
                    data-active={tool.active === pen.id || undefined}
                    onClick={(e) => {
                      // Selecting is the first click. A second click on the
                      // tool you're already holding opens its settings, which
                      // keeps one tap between you and the tray at all times.
                      if (settings === "tool" && tool.active === pen.id) {
                        if (openTool && !closingTool) closeMenu();
                        else showMenu(e.currentTarget);
                        return;
                      }
                      if (openTool) closeMenu();
                      onSelect(pen.id);
                    }}
                    aria-label={pen.name}
                    aria-pressed={tool.active === pen.id}
                    aria-expanded={
                      settings === "tool" && tool.active === pen.id
                        ? openTool !== null
                        : undefined
                    }
                    {...tip.bind(pen.name, shortcuts ? pen.key : undefined)}
                  >
                    <ToolIcon
                      id={pen.id}
                      color={inkFor(pen.id)}
                      look={look}
                      badge={gauge && tool.active === pen.id ? size : undefined}
                    />
                  </button>
                ))}

                {eraser && (
                  <button
                    type="button"
                    className={css.tool}
                    data-active={isEraser || undefined}
                    onClick={() => onSelect("eraser")}
                    aria-label="Eraser"
                    aria-pressed={isEraser}
                    {...tip.bind("Eraser", shortcuts ? "E" : undefined)}
                  >
                    <ToolIcon id="eraser" color={tool.color} look={look} />
                  </button>
                )}

                {((show.size && settings === "bar") || show.color) && (
                  <span className={css.divider} />
                )}

                {/* Brush size, shown as a dot at its actual relative weight. */}
                {(show.size || show.opacity) && settings === "bar" && (
                  <span className={css.seated}>
                    {/* The eraser has no opacity to set, and the panel this
                        opens shows it one slider — so promising two is wrong,
                        in the label and to a screen reader alike. */}
                    <button
                      type="button"
                      className={css.round}
                      onClick={() => setMode("brush")}
                      aria-label={sizeLabel}
                      {...tip.bindControl(sizeLabel)}
                    >
                      <span
                        className={css.brushDot}
                        style={{
                          width: 6 + (size / maxSize) * 16,
                          height: 6 + (size / maxSize) * 16,
                          background: isEraser ? "#c9c7c2" : tool.color,
                          opacity: isEraser ? 1 : tool.opacity,
                        }}
                      />
                    </button>
                  </span>
                )}

                {show.color && (
                  <span className={css.seated}>
                    <button
                      type="button"
                      className={css.round}
                      onClick={() => setMode("ink")}
                      aria-label={`Ink colour — ${tool.color}`}
                      {...tip.bindControl("Colour")}
                    >
                      <span className={css.wheel}>
                        <span
                          className={css.wheelInk}
                          style={{ background: tool.color }}
                        />
                      </span>
                    </button>
                  </span>
                )}

                {show.minimize && <span className={css.divider} />}

                {show.minimize && (
                  <span className={css.seated}>
                    <button
                      type="button"
                      className={css.round}
                      onClick={onCollapse}
                      aria-label="Hide tools"
                      {...tip.bindControl("Hide tools")}
                    >
                      <CollapseIcon />
                    </button>
                  </span>
                )}
              </>
            ),
          },

          {
            id: "ink",
            content: (
              <div
                className={`${morph.centered} ${css.row} ${css.inkRow}`}
                data-open-end={!show.custom || undefined}
              >
                {back}
                <span className={css.divider} />
                <div className={css.swatches}>
                  {resolveSwatches(swatches, vertical).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={css.chip}
                      data-active={
                        tool.color.toLowerCase() === c.toLowerCase() ||
                        undefined
                      }
                      style={{ background: c }}
                      onClick={() => {
                        onChange({ color: c });
                        // Reaching for a colour means you want to draw with it.
                        if (isEraser) onSelect("pen");
                      }}
                      aria-label={c}
                      title={c}
                    >
                      {/* A tick reads as chosen at any swatch colour; a ring cut
                        into the swatch turns it into a donut and fights dark
                        colours. */}
                      <svg
                        className={css.tick}
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke={isLight(c) ? "#111" : "#fff"}
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3.6 8.4 6.7 11.5 12.4 5.2" />
                      </svg>
                    </button>
                  ))}
                </div>
                {show.custom && (
                  <>
                    <span className={css.divider} />
                    <button
                      type="button"
                      className={css.custom}
                      onClick={() => setMode("spectrum")}
                      aria-label="Pick any colour"
                      {...tip.bindControl("Any colour")}
                    >
                      <span />
                    </button>
                  </>
                )}
              </div>
            ),
          },

          {
            id: "spectrum",
            content: (
              <div className={`${morph.centered} ${css.row}`}>
                <button
                  type="button"
                  className={css.round}
                  onClick={() => setMode("ink")}
                  aria-label="Back to swatches"
                  {...tip.bindControl("Back")}
                >
                  <BackIcon />
                </button>
                <span className={css.divider} />
                <span
                  className={css.preview}
                  style={{ background: tool.color }}
                  aria-hidden
                />
                {/* Not on a rail. Six characters and a field to hold them needs
                  more width than 66px has, and every way of cramming it in
                  looked cramped. The eyedropper covers picking an exact colour;
                  typing one is a job for the wide bar. */}
                {!vertical && (
                  <HexField
                    value={tool.color}
                    onChange={(color) => {
                      onChange({ color });
                      if (isEraser) onSelect("pen");
                    }}
                  />
                )}
                {canPick && (
                  <button
                    type="button"
                    className={css.round}
                    aria-label="Pick a colour from the screen"
                    {...tip.bindControl("Pick from screen")}
                    onClick={async () => {
                      const picked = await pickFromScreen();
                      if (!picked) return;
                      onChange({ color: picked });
                      if (isEraser) onSelect("pen");
                    }}
                  >
                    <DropperIcon />
                  </button>
                )}
              </div>
            ),
          },

          {
            id: "brush",
            content: (
              <div className={`${morph.centered} ${css.row} ${css.tail}`}>
                {back}
                {show.size && (
                  <>
                    <span className={css.divider} />
                    <BarSlider
                      vertical={vertical}
                      label="Size"
                      value={size}
                      min={1}
                      max={maxSize}
                      curve={2}
                      display={String(Math.round(size))}
                      color={isEraser ? "#c9c7c2" : tool.color}
                      onChange={(n) =>
                        onChange(isEraser ? { eraserSize: n } : { size: n })
                      }
                    />
                  </>
                )}
                {show.opacity && !isEraser && (
                  <>
                    <span className={css.divider} />
                    <BarSlider
                      vertical={vertical}
                      label="Opacity"
                      value={tool.opacity}
                      min={0.05}
                      max={1}
                      display={`${Math.round(tool.opacity * 100)}%`}
                      color={tool.color}
                      checker
                      onChange={(opacity) => onChange({ opacity })}
                    />
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
      {tip.node}
      {settings === "tool" && openTool && (
        <ToolMenu
          anchor={openTool}
          size={menu.size}
          maxSize={menu.maxSize}
          opacity={menu.opacity}
          color={menu.color}
          showOpacity={menu.showOpacity}
          theme={theme}
          closing={closingTool}
          onSize={(n) => onChange(isEraser ? { eraserSize: n } : { size: n })}
          onOpacity={(opacity) => onChange({ opacity })}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
