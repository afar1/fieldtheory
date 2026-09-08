import { useCallback, useRef, useState } from "react";
import css from "./BarSlider.module.css";

/** A horizontal slider sized to live inside the bar. */
export function BarSlider({
  label,
  value,
  min,
  max,
  curve = 1,
  display,
  color,
  checker,
  vertical = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** >1 gives finer control at the low end, where small strokes live. */
  curve?: number;
  display: string;
  color: string;
  /** Show a chequerboard behind the fill, so low opacity reads as see-through. */
  checker?: boolean;
  /** Track runs bottom-to-top, for the vertical rails. */
  vertical?: boolean;
  onChange: (n: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  /** The drag flag has to be a ref as well as state. */
  const draggingNow = useRef(false);
  // A press animates the knob across to where you tapped; only once the
  // pointer actually moves does it start tracking instantly. Killing the
  // transition on press made every click a hard jump.
  const [tracking, setTracking] = useState(false);
  // Where the press landed, so a click with a pixel of hand-shake still counts
  // as a click and glides, rather than snapping like a drag.
  const pressedAt = useRef(0);

  const valueAt = useCallback(
    (clientX: number, clientY: number) => {
      const r = track.current!.getBoundingClientRect();
      const KNOB = 16;
      // Vertical runs bottom-to-top, which is the direction people expect
      // "more" to be — so the axis is inverted, not merely swapped.
      const usable = Math.max(1, (vertical ? r.height : r.width) - KNOB);
      const along = vertical
        ? r.bottom - clientY - KNOB / 2
        : clientX - r.left - KNOB / 2;
      const t = Math.min(1, Math.max(0, along / usable));
      return min + (max - min) * Math.pow(t, curve);
    },
    [min, max, curve, vertical],
  );

  const pct = Math.pow((value - min) / (max - min), 1 / curve);
  const step = (max - min) / 50;
  // The knob travels between its own half-widths rather than 0–100%, so at
  // either extreme it still sits fully on the track instead of hanging off
  // the end or being clipped by it.
  const KNOB = 16;
  const at = `calc(${KNOB / 2}px + ${pct} * (100% - ${KNOB}px))`;
  const axis = vertical ? { bottom: at } : { left: at };
  const fillSize = vertical ? { height: at } : { width: at };

  return (
    <div className={`${css.field} ${vertical ? css.fieldVertical : ""}`}>
      <div className={css.head}>
        <span className={css.label}>{label}</span>
        <span className={css.value}>{display}</span>
      </div>
      <div
        ref={track}
        className={`${css.track} ${vertical ? css.trackVertical : ""}`}
        data-dragging={tracking || undefined}
        onPointerDown={(e) => {
          e.preventDefault();
          // Capture is best-effort: it throws for pointer ids the element never
          // saw, and losing the drag is far worse than losing the capture.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* not capturable */
          }
          draggingNow.current = true;
          setTracking(false);
          pressedAt.current = e.clientX;
          setTracking(false);
          onChange(valueAt(e.clientX, e.clientY));
        }}
        onPointerMove={(e) => {
          if (!draggingNow.current) return;
          // 4px of travel means you meant to drag.
          const at = vertical ? e.clientY : e.clientX;
          if (Math.abs(at - pressedAt.current) > 4) setTracking(true);
          onChange(valueAt(e.clientX, e.clientY));
        }}
        onPointerUp={() => {
          draggingNow.current = false;
          setTracking(false);
        }}
        onPointerCancel={() => {
          draggingNow.current = false;
          setTracking(false);
        }}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={display}
        tabIndex={0}
        onKeyDown={(e) => {
          const up = vertical ? "ArrowUp" : "ArrowRight";
          const down = vertical ? "ArrowDown" : "ArrowLeft";
          if (e.key === up) onChange(Math.min(max, value + step));
          if (e.key === down) onChange(Math.max(min, value - step));
        }}
      >
        <span className={css.groove}>
          {checker && <span className={css.checker} />}
          <span
            className={css.fill}
            style={{ ...fillSize, background: color }}
          />
        </span>
        <span className={css.knob} style={axis} />
      </div>
    </div>
  );
}
