import { useCallback, useRef, useState, type MouseEvent } from 'react';
import {
  COLLAPSED_SIDEBAR_AFFORDANCE_PROXIMITY_WIDTH,
  COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH,
  getCollapsedSidebarAffordanceOpacity,
} from '../utils/editorShortcuts';

export function useCollapsedSidebarHoverReveal(setSidebarHoverExpanded: (expanded: boolean) => void) {
  const currentPointerXRef = useRef<number | null>(null);
  const [affordanceOpacity, setAffordanceOpacity] = useState(0);

  const updatePointer = useCallback((clientX: number) => {
    currentPointerXRef.current = clientX;
    setAffordanceOpacity(getCollapsedSidebarAffordanceOpacity({
      currentClientX: clientX,
      hoverStripWidth: COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH,
      proximityWidth: COLLAPSED_SIDEBAR_AFFORDANCE_PROXIMITY_WIDTH,
    }));
  }, []);

  const handleSurfaceMouseMove = useCallback((event: MouseEvent<HTMLElement>) => {
    updatePointer(event.clientX);
  }, [updatePointer]);

  const handleSurfaceMouseLeave = useCallback(() => {
    currentPointerXRef.current = null;
    setAffordanceOpacity(0);
  }, []);

  const handleHoverStripMouseOver = useCallback((event: MouseEvent<HTMLElement>) => {
    updatePointer(event.clientX);
  }, [updatePointer]);

  const handleHoverStripClick = useCallback(() => {
    setSidebarHoverExpanded(true);
  }, [setSidebarHoverExpanded]);

  return {
    hoverStripWidth: COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH,
    affordanceOpacity,
    handleSurfaceMouseMove,
    handleSurfaceMouseLeave,
    handleHoverStripMouseOver,
    handleHoverStripClick,
  };
}
