/**
 * useInteractionFpsSampler - measures FPS during short user-interaction bursts.
 *
 * The cost when diagnostics are off is one early-return per interaction.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  isScrollDiagnosticsEnabled,
  recordInteractionFrame,
} from '../utils/scrollDiagnostics';

const INTERACTION_END_DELAY_MS = 160;

interface InteractionBurst {
  active: boolean;
  start: number;
  lastFrameTime: number;
  longestFrame: number;
  frameCount: number;
  raf: number;
  stopTimer: number | null;
}

function createBurst(): InteractionBurst {
  return {
    active: false,
    start: 0,
    lastFrameTime: 0,
    longestFrame: 0,
    frameCount: 0,
    raf: 0,
    stopTimer: null,
  };
}

export function useInteractionFpsSampler(source: string) {
  const burstRef = useRef<InteractionBurst>(createBurst());

  const finishBurst = useCallback(() => {
    const burst = burstRef.current;
    if (!burst.active) return;
    burst.active = false;
    cancelAnimationFrame(burst.raf);
    const durationMs = performance.now() - burst.start;
    const fps = durationMs > 0 ? Math.round((burst.frameCount / durationMs) * 1000) : 0;
    recordInteractionFrame({
      source,
      fps,
      longestFrameMs: burst.longestFrame,
      durationMs,
      frameCount: burst.frameCount,
    });
  }, [source]);

  const tick = useCallback((now: number) => {
    const burst = burstRef.current;
    if (!burst.active) return;
    if (burst.lastFrameTime > 0) {
      const dt = now - burst.lastFrameTime;
      if (dt > burst.longestFrame) burst.longestFrame = dt;
      burst.frameCount++;
    }
    burst.lastFrameTime = now;
    burst.raf = requestAnimationFrame(tick);
  }, []);

  const sampleInteraction = useCallback(() => {
    if (!isScrollDiagnosticsEnabled()) return;
    const burst = burstRef.current;
    if (!burst.active) {
      burst.active = true;
      burst.start = performance.now();
      burst.lastFrameTime = 0;
      burst.longestFrame = 0;
      burst.frameCount = 0;
      burst.raf = requestAnimationFrame(tick);
    }
    if (burst.stopTimer !== null) window.clearTimeout(burst.stopTimer);
    burst.stopTimer = window.setTimeout(finishBurst, INTERACTION_END_DELAY_MS);
  }, [finishBurst, tick]);

  useEffect(() => {
    return () => {
      const burst = burstRef.current;
      if (burst.stopTimer !== null) window.clearTimeout(burst.stopTimer);
      cancelAnimationFrame(burst.raf);
      burst.active = false;
    };
  }, []);

  return sampleInteraction;
}
