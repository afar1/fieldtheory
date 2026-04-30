/**
 * useScrollFpsSampler — measures per-burst FPS on a scrollable element.
 *
 * Returns a callback ref. Pass it to the `ref` prop of any scrollable
 * element you want to measure; the hook attaches a passive scroll listener
 * on assignment and detaches on unmount or ref reassignment. This handles
 * conditionally-rendered scroll surfaces (textarea swapping in/out of the
 * tree) which a plain `RefObject`-based hook misses.
 *
 * The cost when diagnostics are off is one early-return per scroll event.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  isScrollDiagnosticsEnabled,
  recordScrollFrame,
} from '../utils/scrollDiagnostics';

const SCROLL_END_DELAY_MS = 160;

interface Attachment {
  element: HTMLElement;
  detach: () => void;
}

function attachSampler(element: HTMLElement, source: string): Attachment {
  let scrolling = false;
  let scrollStart = 0;
  let lastFrameTime = 0;
  let longestFrame = 0;
  let frameCount = 0;
  let stopTimer: number | null = null;
  let raf = 0;

  const tick = (now: number) => {
    if (!scrolling) return;
    if (lastFrameTime > 0) {
      const dt = now - lastFrameTime;
      if (dt > longestFrame) longestFrame = dt;
      frameCount++;
    }
    lastFrameTime = now;
    raf = requestAnimationFrame(tick);
  };

  const finishBurst = () => {
    if (!scrolling) return;
    scrolling = false;
    cancelAnimationFrame(raf);
    const durationMs = performance.now() - scrollStart;
    const fps = durationMs > 0 ? Math.round((frameCount / durationMs) * 1000) : 0;
    recordScrollFrame({
      source,
      fps,
      longestFrameMs: longestFrame,
      durationMs,
    });
  };

  const onScroll = () => {
    if (!isScrollDiagnosticsEnabled()) return;
    if (!scrolling) {
      scrolling = true;
      scrollStart = performance.now();
      lastFrameTime = 0;
      longestFrame = 0;
      frameCount = 0;
      raf = requestAnimationFrame(tick);
    }
    if (stopTimer !== null) window.clearTimeout(stopTimer);
    stopTimer = window.setTimeout(finishBurst, SCROLL_END_DELAY_MS);
  };

  element.addEventListener('scroll', onScroll, { passive: true });

  return {
    element,
    detach: () => {
      element.removeEventListener('scroll', onScroll);
      if (stopTimer !== null) window.clearTimeout(stopTimer);
      cancelAnimationFrame(raf);
    },
  };
}

export function useScrollFpsSampler(source: string) {
  const attachmentRef = useRef<Attachment | null>(null);

  const setRef = useCallback(
    (element: HTMLElement | null) => {
      const current = attachmentRef.current;
      if (current && current.element === element) return;
      if (current) {
        current.detach();
        attachmentRef.current = null;
      }
      if (element) {
        attachmentRef.current = attachSampler(element, source);
      }
    },
    [source],
  );

  useEffect(() => {
    return () => {
      attachmentRef.current?.detach();
      attachmentRef.current = null;
    };
  }, []);

  return setRef;
}
