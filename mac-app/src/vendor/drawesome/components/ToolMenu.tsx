import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarSlider } from "./BarSlider";
import css from "./ToolMenu.module.css";

/** The active tool's own settings, over the tool itself. */
export function ToolMenu({
  anchor,
  size,
  maxSize,
  opacity,
  color,
  showOpacity = true,
  theme = "light",
  closing = false,
  onSize,
  onOpacity,
  onClose,
}: {
  /** The tool button this hangs from. */
  anchor: HTMLElement | null;
  size: number;
  maxSize: number;
  opacity: number;
  color: string;
  showOpacity?: boolean;
  /** Carried through so the panel matches the bar it belongs to. */
  theme?: "light" | "dark" | "auto";
  /** On its way out: kept mounted just long enough to animate. */
  closing?: boolean;
  onSize: (n: number) => void;
  onOpacity: (n: number) => void;
  onClose: () => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number; beak: number } | null>(
    null,
  );
  const menu = useRef<HTMLDivElement>(null);

  // Placed after layout so the first paint is already in the right spot.
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = menu.current?.offsetWidth ?? 240;
      // Aimed at the drawn pen rather than at the button around it. The tools
      // are set a little off-centre in their buttons on purpose, to balance a
      // shape that leans one way, so pointing at the middle of the box lands
      // beside the nib — a small miss, but it's the one thing the beak is for.
      const art = anchor.querySelector("svg");
      const box = art ? art.getBoundingClientRect() : a;
      // Centred on the tool, then held inside the window: a tool at the end of
      // the row would otherwise hang its menu off the side of the screen.
      const half = w / 2;
      const centre = box.left + box.width / 2;
      const x = Math.min(
        Math.max(centre, half + 8),
        window.innerWidth - half - 8,
      );
      // Where the beak has to sit to still point at the tool. When the panel
      // has been held back off the edge of the window it is no longer centred
      // over the tool, and a beak fixed at the middle points at empty bar. Kept
      // clear of the corners, where it would come out of a rounded edge.
      const beak = Math.min(Math.max(centre - (x - half), 22), w - 22);
      setAt({ x, y: a.top - 12, beak });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // Anywhere else, or Escape, puts it away.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Captured, so a press that lands on the canvas closes the menu before it
    // starts a stroke underneath it.
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);

  if (!anchor || typeof document === "undefined") return null;

  return createPortal(
    /*
      Scoped, because this is portalled to <body> and the design tokens live
      on `.sd`. Without the class it inherits nothing: no surface colour, no
      typeface, just two sliders floating on the page.
    */
    <div
      ref={menu}
      className={`sd ${css.menu}`}
      data-theme={theme}
      data-closing={closing || undefined}
      style={
        at
          ? ({
              left: at.x,
              top: at.y,
              "--beak-x": `${at.beak}px`,
            } as React.CSSProperties)
          : { opacity: 0 }
      }
      role="dialog"
      aria-label="Tool settings"
    >
      <div className={css.rows}>
        <BarSlider
          label="Size"
          value={size}
          min={1}
          max={maxSize}
          curve={2}
          display={String(Math.round(size))}
          color={color}
          onChange={onSize}
        />
        {showOpacity && (
          <BarSlider
            label="Opacity"
            value={opacity}
            min={0.05}
            max={1}
            display={`${Math.round(opacity * 100)}%`}
            color={color}
            checker
            onChange={onOpacity}
          />
        )}
      </div>
      {/* Points back down at the tool it belongs to. */}
      <span className={css.beak} aria-hidden />
    </div>,
    document.body,
  );
}
