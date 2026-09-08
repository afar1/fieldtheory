import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import css from "./Tooltip.module.css";

type Face = { label: string; hint?: string };
type Placement = "top" | "right" | "left";
type Shown = Face & { x: number; y: number; at: Placement };

/** How long the outgoing label is kept alive to animate out. */
const SWAP = 260;
/** How long the pill itself takes to leave. */
const EXIT = 170;

/** Hover labels for the tray. */
/** How the hover labels behave. `true` is the default of all of these. */
export type TooltipOptions = {
  /** Which controls carry a label. */
  scope?: "all" | "tools";
  /** Milliseconds before the first label appears. Later ones are immediate. */
  delay?: number;
  /** Style overrides, spread onto the label. */
  style?: React.CSSProperties;
};

export function useTooltips(
  tooltips: boolean | TooltipOptions | undefined,
  /** Which edge the toolbar is on, so the label can step aside from it. */
  bar: "bottom" | "left" | "right" = "bottom",
) {
  const opts: TooltipOptions = typeof tooltips === "object" ? tooltips : {};
  const enabled = tooltips !== false;
  const style = opts.style;
  const wait = opts.delay ?? 400;
  const toolsOnly = opts.scope === "tools";
  const [shown, setShown] = useState<Shown | null>(null);
  /** The face on its way out, kept alive just long enough to animate. */
  const [leaving, setLeaving] = useState<Face | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [swap, setSwap] = useState(0);
  /** Kept mounted while it plays its way out. */
  const [closing, setClosing] = useState(false);

  const open = useRef(false);
  const face = useRef<HTMLDivElement>(null);

  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = (t: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (t.current) clearTimeout(t.current);
    t.current = null;
  };

  useEffect(
    () => () => {
      stop(delay);
      stop(leave);
      stop(settle);
      stop(exit);
    },
    [],
  );

  // The pill is sized to whatever is currently inside it, so it can grow and
  // shrink between labels of different lengths instead of snapping.
  useLayoutEffect(() => {
    if (face.current) setWidth(face.current.scrollWidth);
  }, [shown?.label, shown?.hint]);

  /** Leaving a tool doesn't take the label down at once. */
  const hide = useCallback((now = false) => {
    stop(delay);
    stop(leave);
    const go = () => {
      // Play it out rather than dropping it. Unmounting on the spot is the one
      // thing in the sequence that isn't animated, and it's the part you see
      // most often — every click on a tool ends with it.
      setClosing(true);
      stop(exit);
      exit.current = setTimeout(() => {
        open.current = false;
        setShown(null);
        setLeaving(null);
        setWidth(null);
        setClosing(false);
      }, EXIT);
    };
    if (now) go();
    else leave.current = setTimeout(go, 130);
  }, []);

  const show = useCallback(
    (el: HTMLElement | null, label: string, hint?: string) => {
      if (!enabled || !el) return;
      stop(delay);
      stop(leave);
      // Coming back to it while it's on the way out cancels the exit.
      stop(exit);
      setClosing(false);

      const place = () => {
        const r = el.getBoundingClientRect();
        /*
          A rail is labelled from the side, not from above.

          Over a vertical bar the label is as wide as the rail is tall, so
          centring it on the tool hangs most of it off the edge of the window
          — and the half that survives sits over the tool above. Beside it,
          pointing into the canvas, there is always room.
        */
        const at: Placement =
          bar === "left" ? "right" : bar === "right" ? "left" : "top";
        const x = Math.round(
          at === "right"
            ? r.right + 12
            : at === "left"
              ? r.left - 12
              : r.left + r.width / 2,
        );
        const y = Math.round(at === "top" ? r.top - 10 : r.top + r.height / 2);

        setShown((was) => {
          if (was && was.label !== label) {
            // Hand the old text over to be animated out.
            setLeaving({ label: was.label, hint: was.hint });
            setSwap((n) => n + 1);
            stop(settle);
            settle.current = setTimeout(() => setLeaving(null), SWAP);
          }
          return { label, hint, x, y, at };
        });
        open.current = true;
      };

      // The first label waits; once one is up, the next shows at once. Making
      // every tool serve its own delay is what makes a row feel sticky to read.
      if (open.current) place();
      else delay.current = setTimeout(place, wait);
    },
    // `bar` belongs here: without it the callback keeps whichever edge the
    // toolbar was on when it first mounted, and moving the bar to a rail leaves
    // its labels still being placed above the tools, off the side of the window.
    [enabled, bar, wait],
  );

  /** Spread onto any control that should carry a label. */
  const bind = useCallback(
    (label: string, hint?: string) => ({
      onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
        // Touch has no hover, and a label that appears on tap only covers the
        // thing that was tapped.
        if (e.pointerType === "touch") return;
        show(e.currentTarget, label, hint);
      },
      onPointerLeave: () => hide(),
      // A click is a decision; the label has no reason to linger over it.
      onPointerDown: () => hide(true),
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        if (e.currentTarget.matches(":focus-visible")) {
          show(e.currentTarget, label, hint);
        }
      },
      onBlur: () => hide(),
    }),
    [show, hide],
  );

  const body = (f: Face) => (
    <>
      <span className={css.label}>{f.label}</span>
      {f.hint && <kbd className={css.hint}>{f.hint}</kbd>}
    </>
  );

  const node =
    enabled && shown && typeof document !== "undefined"
      ? createPortal(
          /*
            Three layers, each with one job.

            The anchor travels, the pill holds its shape and resizes, and only
            the text inside is swapped. Animating the pill itself washes out
            its edge and its shadow, which reads as the whole thing going out
            of focus rather than as the label changing inside it.
          */
          <div
            className={css.anchor}
            style={{ transform: `translate3d(${shown.x}px, ${shown.y}px, 0)` }}
          >
            <div
              className={css.tip}
              data-at={shown.at}
              data-closing={closing || undefined}
              /* Caller overrides last, so a host can restyle the label without
                 having to reach into the stylesheet. */
              style={{ width: width ?? undefined, ...style }}
              role="tooltip"
            >
              {leaving && (
                <div className={css.face} data-leaving key={`out-${swap}`}>
                  {body(leaving)}
                </div>
              )}
              <div className={css.face} ref={face} key={`in-${swap}`}>
                {body(shown)}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  /** For everything that isn't a pen — undo, colour, the eyedropper. */
  const bindControl = useCallback(
    (label: string, hint?: string) => (toolsOnly ? {} : bind(label, hint)),
    [bind, toolsOnly],
  );

  return { bind, bindControl, node, hide };
}
