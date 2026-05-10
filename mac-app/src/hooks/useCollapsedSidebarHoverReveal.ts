import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  COLLAPSED_SIDEBAR_AFFORDANCE_PROXIMITY_WIDTH,
  COLLAPSED_SIDEBAR_HOVER_DWELL_MS,
  COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH,
  getCollapsedSidebarAffordanceOpacity,
  isPointerInsideCollapsedSidebarHoverStrip,
} from '../utils/editorShortcuts';

export function useCollapsedSidebarHoverReveal(setSidebarHoverExpanded: (expanded: boolean) => void) {
  const dwellTimerRef = useRef<number | null>(null);
  const currentPointerXRef = useRef<number | null>(null);
  const [affordanceOpacity, setAffordanceOpacity] = useState(0);

  const cancelDwell = useCallback(() => {
    if (dwellTimerRef.current !== null) {
      window.clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
  }, []);

  const updatePointer = useCallback((clientX: number) => {
    currentPointerXRef.current = clientX;
    setAffordanceOpacity(getCollapsedSidebarAffordanceOpacity({
      currentClientX: clientX,
      hoverStripWidth: COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH,
      proximityWidth: COLLAPSED_SIDEBAR_AFFORDANCE_PROXIMITY_WIDTH,
    }));
  }, []);

  const scheduleDwell = useCallback(() => {
    if (dwellTimerRef.current !== null) {
      window.clearTimeout(dwellTimerRef.current);
    }
    dwellTimerRef.current = window.setTimeout(() => {
      dwellTimerRef.current = null;
      const currentClientX = currentPointerXRef.current;
      if (currentClientX === null) return;
      if (isPointerInsideCollapsedSidebarHoverStrip({
        currentClientX,
        hoverStripWidth: COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH,
      })) {
        setSidebarHoverExpanded(true);
      }
    }, COLLAPSED_SIDEBAR_HOVER_DWELL_MS);
  }, [setSidebarHoverExpanded]);

  const handleSurfaceMouseMove = useCallback((event: MouseEvent<HTMLElement>) => {
    updatePointer(event.clientX);
    if (isPointerInsideCollapsedSidebarHoverStrip({
      currentClientX: event.clientX,
      hoverStripWidth: COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH,
    })) {
      scheduleDwell();
    } else {
      cancelDwell();
    }
  }, [cancelDwell, scheduleDwell, updatePointer]);

  const handleSurfaceMouseLeave = useCallback(() => {
    currentPointerXRef.current = null;
    setAffordanceOpacity(0);
    cancelDwell();
    setSidebarHoverExpanded(false);
  }, [cancelDwell, setSidebarHoverExpanded]);

  const handleHoverStripMouseOver = useCallback((event: MouseEvent<HTMLElement>) => {
    updatePointer(event.clientX);
    scheduleDwell();
  }, [scheduleDwell, updatePointer]);

  const handleHoverStripClick = useCallback(() => {
    cancelDwell();
    setSidebarHoverExpanded(true);
  }, [cancelDwell, setSidebarHoverExpanded]);

  useEffect(() => cancelDwell, [cancelDwell]);

  return {
    hoverStripWidth: COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH,
    affordanceOpacity,
    handleSurfaceMouseMove,
    handleSurfaceMouseLeave,
    handleHoverStripMouseOver,
    handleHoverStripClick,
  };
}
