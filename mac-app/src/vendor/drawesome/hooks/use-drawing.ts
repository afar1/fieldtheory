import { useCallback, useMemo, useRef, useState } from "react";
import type { Stroke } from "../engine/types";

/** Stroke list + undo/redo, exposed as a small transaction API. */
export type DrawingController = {
  strokes: Stroke[];
  canUndo: boolean;
  canRedo: boolean;
  /** Replace the strokes and push one history entry. */
  commit: (next: Stroke[]) => void;
  /** Start a multi-step gesture. */
  begin: () => void;
  /** Update strokes mid-gesture without touching history. */
  update: (next: Stroke[] | ((prev: Stroke[]) => Stroke[])) => void;
  /** Finish a gesture, pushing one history entry if anything changed. */
  end: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  /** Load strokes without recording history (e.g. restoring a saved file). */
  reset: (next: Stroke[]) => void;
};

export function useDrawing(initial: Stroke[] = []): DrawingController {
  const [strokes, setStrokes] = useState<Stroke[]>(initial);
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);

  // The gesture snapshot lives in a ref, not state: it must survive the
  // re-renders that `update` triggers without itself causing one.
  const snapshot = useRef<Stroke[] | null>(null);
  // Mirrors `strokes` so `end()` can compare against the latest value rather
  // than the (possibly stale) one captured when the gesture began.
  const latest = useRef(strokes);
  latest.current = strokes;

  // Note: never nest setState calls inside another setState updater — React
  // re-invokes updaters (twice in StrictMode) and would corrupt these stacks.
  // Each of these reads the current render's committed values instead.
  const commit = useCallback((next: Stroke[]) => {
    setPast((p) => [...p, latest.current]);
    setFuture([]);
    setStrokes(next);
  }, []);

  const begin = useCallback(() => {
    snapshot.current = latest.current;
  }, []);

  const update = useCallback(
    (next: Stroke[] | ((prev: Stroke[]) => Stroke[])) => setStrokes(next),
    [],
  );

  const end = useCallback(() => {
    const before = snapshot.current;
    snapshot.current = null;
    if (!before || before === latest.current) return;
    setPast((p) => [...p, before]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (!past.length) return;
    setStrokes(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setFuture([strokes, ...future]);
  }, [past, future, strokes]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setStrokes(future[0]);
    setFuture(future.slice(1));
    setPast([...past, strokes]);
  }, [past, future, strokes]);

  const clear = useCallback(() => {
    if (!latest.current.length) return;
    commit([]);
  }, [commit]);

  const reset = useCallback((next: Stroke[]) => {
    setStrokes(next);
    setPast([]);
    setFuture([]);
  }, []);

  return useMemo(
    () => ({
      strokes,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      commit,
      begin,
      update,
      end,
      undo,
      redo,
      clear,
      reset,
    }),
    [
      strokes,
      past.length,
      future.length,
      commit,
      begin,
      update,
      end,
      undo,
      redo,
      clear,
      reset,
    ],
  );
}
