/* 16px stroke icons, drawn on a 16-unit grid. currentColor throughout. */

type P = { size?: number };

const Svg = ({ size = 16, children }: P & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const EraserIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6.6 13.2 2.9 9.5a1.2 1.2 0 0 1 0-1.7l5.4-5.4a1.2 1.2 0 0 1 1.7 0l3.4 3.4a1.2 1.2 0 0 1 0 1.7l-5.7 5.7Z" />
    <path d="M5.1 6.7 9.9 11.5" />
    <path d="M6.6 13.2H13.5" />
  </Svg>
);

export const UndoIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.8 5.5h6.9a3.6 3.6 0 0 1 0 7.2H6.2" />
    <path d="M5.4 2.9 2.8 5.5l2.6 2.6" />
  </Svg>
);

export const RedoIcon = (p: P) => (
  <Svg {...p}>
    <path d="M13.2 5.5H6.3a3.6 3.6 0 0 0 0 7.2h3.5" />
    <path d="M10.6 2.9l2.6 2.6-2.6 2.6" />
  </Svg>
);

export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path
      d="M4.8 3.3v9.4a.5.5 0 0 0 .76.43l7.3-4.7a.5.5 0 0 0 0-.86l-7.3-4.7a.5.5 0 0 0-.76.43Z"
      fill="currentColor"
    />
  </Svg>
);

export const ReplayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8" />
    <path d="M13.5 2.4v3.2h-3.2" />
  </Svg>
);

export const LoopIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.4 6.6a3.2 3.2 0 0 1 3.2-3.2h3.6" />
    <path d="M8.6 1.8 10.6 3.4 8.6 5" />
    <path d="M12.6 9.4a3.2 3.2 0 0 1-3.2 3.2H5.8" />
    <path d="M7.4 11 5.4 12.6 7.4 14.2" />
  </Svg>
);

export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.4v7.2" />
    <path d="M5.2 6.9 8 9.7l2.8-2.8" />
    <path d="M2.9 11.4v1.2a1 1 0 0 0 1 1h8.2a1 1 0 0 0 1-1v-1.2" />
  </Svg>
);

export const ImageIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.4" />
    <circle cx="6" cy="6.5" r="1.05" />
    <path d="M2.6 11 5.9 8.4a1 1 0 0 1 1.25-.02l2.2 1.7a1 1 0 0 0 1.28-.05l1.5-1.36a1 1 0 0 1 1.33-.01l0.9 0.8" />
  </Svg>
);

export const FrameIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.4" />
    <path
      d="M5.6 2.6v10.8M10.4 2.6v10.8M2.6 5.6h10.8M2.6 10.4h10.8"
      stroke="rgba(0,0,0,0.45)"
    />
  </Svg>
);

export const TuneIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.6 5h10.8M2.6 11h10.8" />
    <circle cx="6" cy="5" r="1.7" fill="var(--pill-bg, #1a1a1a)" />
    <circle cx="10.2" cy="11" r="1.7" fill="var(--pill-bg, #1a1a1a)" />
  </Svg>
);

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.2 8.4 6.4 11.6 12.8 4.8" />
  </Svg>
);

export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 3.6v8.8M3.6 8h8.8" />
  </Svg>
);

export const MinusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.6 8h8.8" />
  </Svg>
);

export const EyeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M1.8 8s2.4-4.4 6.2-4.4S14.2 8 14.2 8s-2.4 4.4-6.2 4.4S1.8 8 1.8 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </Svg>
);

export const EyeOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6.3 3.9A6.3 6.3 0 0 1 8 3.6C11.8 3.6 14.2 8 14.2 8a11 11 0 0 1-2 2.5" />
    <path d="M4.4 4.9A11.4 11.4 0 0 0 1.8 8s2.4 4.4 6.2 4.4a6 6 0 0 0 2.3-.45" />
    <path d="M6.7 6.7a1.9 1.9 0 0 0 2.6 2.6" />
    <path d="M2.6 2.6 13.4 13.4" />
  </Svg>
);

export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1" />
  </Svg>
);

export const UnlinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6.6 9.4 5.5 10.5a2.6 2.6 0 0 1-3.7-3.7l1.6-1.6" />
    <path d="M9.4 6.6 10.5 5.5a2.6 2.6 0 0 1 3.7 3.7l-1.6 1.6" />
    <path d="M2.4 2.4 13.6 13.6" />
  </Svg>
);

export const TimelineIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.6 4.6h7.2M2.6 8h10.8M2.6 11.4h5.2" />
  </Svg>
);

export const BackIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9.8 3.6 5.4 8l4.4 4.4" />
  </Svg>
);

export const CollapseIcon = (p: P) => (
  <Svg {...p}>
    {/* Arrows drawing inward — the bar shrinks, it doesn't slide off an edge,
        so a directional chevron reads as the wrong gesture entirely. */}
    <path d="M6.6 2.9v3.7H2.9" />
    <path d="M2.6 2.6 6.6 6.6" />
    <path d="M9.4 13.1V9.4h3.7" />
    <path d="M13.4 13.4 9.4 9.4" />
  </Svg>
);

/** Sampling a colour from the screen. */
export function DropperIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m14.6 6.6 3-3a2.1 2.1 0 1 1 3 3l-3 3 .4.4a2.1 2.1 0 1 1-3 3l-3.4-3.4a2.1 2.1 0 1 1 3-3l.4.4Z" />
      <path d="M5 20v-2.6l7.2-7.2" />
      <path d="m4 21 .9-.9h2.6l7.2-7.2" />
    </svg>
  );
}
