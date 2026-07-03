import { type CSSProperties, type ReactNode } from 'react';

// =============================================================================
// PillSlot — one generic primitive for all animated slots in the Dynamic
// Island. Two stages, single timing:
//   appearing  → slot widens (260ms), content fades + scales in (140ms delayed 200ms)
//   disappearing → content fades out first (140ms), slot collapses (260ms delayed 140ms)
// Everything above the stylesheet is API; everything below is implementation.
// =============================================================================

// Content fade duration on hide, also the delay before the slot width
// collapses. The containing section must use the same value as its
// transition-delay when shrinking (UnifiedIsland handles that).
export const PILL_SLOT_CONTENT_FADE_MS = 140;
const SLOT_WIDTH_DURATION_MS = 260;

const STYLESHEET_ID = 'di-pill-slot-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLESHEET_ID)) {
  const sheet = document.createElement('style');
  sheet.id = STYLESHEET_ID;
  sheet.textContent = `
    .di-slot {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 22px;
      overflow: hidden;
      box-sizing: border-box;
    }
    /* Slots inside the left section reveal content from the right (notch
       side); slots in the right section reveal from the left. Either way
       content looks like it's sliding out from behind the notch. */
    .di-section--left .di-slot { justify-content: flex-end; }
    .di-section--right .di-slot { justify-content: flex-start; }
    .di-slot--visible {
      width: var(--di-slot-w, 22px);
      margin-right: var(--di-slot-m, 8px);
      transition:
        width ${SLOT_WIDTH_DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1),
        margin-right ${SLOT_WIDTH_DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .di-slot--hidden {
      width: 0;
      min-width: 0;
      margin-right: 0;
      transition:
        width ${SLOT_WIDTH_DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1) ${PILL_SLOT_CONTENT_FADE_MS}ms,
        margin-right ${SLOT_WIDTH_DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1) ${PILL_SLOT_CONTENT_FADE_MS}ms;
    }
    .di-slot__content {
      display: flex;
      align-items: center;
      justify-content: center;
      will-change: opacity, transform;
    }
    .di-slot--visible > .di-slot__content {
      opacity: 1;
      transform: scale(1);
      transition:
        opacity 140ms ease-out 200ms,
        transform 140ms ease-out 200ms;
    }
    .di-slot--hidden > .di-slot__content {
      opacity: 0;
      transform: scale(0.85);
      transition:
        opacity 140ms ease-in,
        transform 140ms ease-in;
    }
    /* Outer section = the visible pill. Renderer-driven width; both sides
       use max(leftSum, rightSum) for symmetric growth. pointer-events is
       re-enabled here since the parent wrapper disables them so menu-bar
       clicks pass through transparent area. */
    .di-section {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      background: #000;
      box-sizing: border-box;
      overflow: hidden;
      pointer-events: auto;
      transition: width 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .di-section--left {
      justify-content: flex-end;
      border-radius: 0 0 0 16px;
      padding: 0 8px 0 10px;
    }
    .di-section--right {
      justify-content: flex-start;
      border-radius: 0 0 16px 0;
      padding: 0 10px 0 8px;
    }
    .di-section--floating {
      justify-content: center;
      border-radius: 0;
      padding: 0;
      background: transparent;
    }
  `;
  document.head.appendChild(sheet);
}

export interface PillSlotProps {
  visible: boolean;
  width?: number;
  marginRight?: number;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  style?: CSSProperties;
}

export function PillSlot({
  visible,
  width = 22,
  marginRight = 8,
  children,
  onClick,
  title,
  style,
}: PillSlotProps) {
  return (
    <div
      className={`di-slot ${visible ? 'di-slot--visible' : 'di-slot--hidden'}`}
      onClick={onClick}
      title={title}
      style={{
        ['--di-slot-w' as string]: `${width}px`,
        ['--di-slot-m' as string]: `${marginRight}px`,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      <div className="di-slot__content">{children}</div>
    </div>
  );
}
