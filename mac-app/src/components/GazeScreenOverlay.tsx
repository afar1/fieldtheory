import { useEffect, useMemo, useRef, useState } from 'react';

type ScreenOverlaySnapshot = {
  point: { x: number; y: number } | null;
  confidence: number;
  windowBounds: { x: number; y: number; width: number; height: number };
  status: {
    enabled: boolean;
    running: boolean;
    cameraAuthorized: boolean;
    targetFps: number;
    reason: string | null;
    lastSampleAtMs: number | null;
  };
  updatedAtMs: number;
};

export default function GazeScreenOverlay() {
  const [snapshot, setSnapshot] = useState<ScreenOverlaySnapshot | null>(null);
  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const currentRef = useRef<{ x: number; y: number } | null>(null);
  const [renderPoint, setRenderPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!window.gazeScreenOverlayAPI) {
      return;
    }

    const updateFromSnapshot = (nextSnapshot: ScreenOverlaySnapshot) => {
      setSnapshot(nextSnapshot);
      if (!nextSnapshot.point) {
        targetRef.current = null;
        currentRef.current = null;
        setRenderPoint(null);
        return;
      }
      const localX = nextSnapshot.point.x - nextSnapshot.windowBounds.x;
      const localY = nextSnapshot.point.y - nextSnapshot.windowBounds.y;
      targetRef.current = { x: localX, y: localY };
      if (!currentRef.current) {
        currentRef.current = { x: localX, y: localY };
        setRenderPoint({ x: localX, y: localY });
      }
    };

    window.gazeScreenOverlayAPI.onSnapshot(updateFromSnapshot);
    void window.gazeScreenOverlayAPI.getSnapshot?.().then((initial) => {
      if (initial) {
        updateFromSnapshot(initial);
      }
    });

    const poll = window.setInterval(() => {
      void window.gazeScreenOverlayAPI?.getSnapshot?.().then((next) => {
        if (next) {
          updateFromSnapshot(next);
        }
      });
    }, 600);

    return () => {
      window.clearInterval(poll);
      window.gazeScreenOverlayAPI?.removeAllListeners('gaze-screen-overlay:snapshot');
    };
  }, []);

  useEffect(() => {
    let rafId = 0;
    const animate = () => {
      const target = targetRef.current;
      if (!target) {
        rafId = requestAnimationFrame(animate);
        return;
      }

      const current = currentRef.current ?? { ...target };
      current.x += (target.x - current.x) * 0.35;
      current.y += (target.y - current.y) * 0.35;
      currentRef.current = current;
      setRenderPoint({ ...current });
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const plusOpacity = useMemo(() => {
    if (!snapshot) return 0;
    if (!snapshot.status.running) return 0.2;
    return Math.max(0.35, Math.min(1, snapshot.confidence));
  }, [snapshot]);

  if (!renderPoint) {
    return null;
  }

  return (
    <div style={styles.root}>
      <div
        style={{
          ...styles.plus,
          left: `${renderPoint.x}px`,
          top: `${renderPoint.y}px`,
          opacity: plusOpacity,
        }}
      >
        <div style={styles.plusHorizontal} />
        <div style={styles.plusVertical} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    userSelect: 'none',
  },
  plus: {
    position: 'absolute',
    width: 24,
    height: 24,
    marginLeft: -12,
    marginTop: -12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    filter: 'drop-shadow(0 0 9px rgba(255, 118, 190, 0.75))',
  },
  plusHorizontal: {
    position: 'absolute',
    width: 20,
    height: 2,
    backgroundColor: 'rgba(255, 118, 190, 0.96)',
    borderRadius: 999,
  },
  plusVertical: {
    position: 'absolute',
    width: 2,
    height: 20,
    backgroundColor: 'rgba(255, 118, 190, 0.96)',
    borderRadius: 999,
  },
};

declare global {
  interface Window {
    gazeScreenOverlayAPI?: {
      onSnapshot: (callback: (snapshot: ScreenOverlaySnapshot) => void) => void;
      getSnapshot?: () => Promise<ScreenOverlaySnapshot | null>;
      removeAllListeners: (channel: string) => void;
    };
  }
}
