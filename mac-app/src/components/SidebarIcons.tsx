import type { CSSProperties } from 'react';

export const SIDEBAR_ICON_TEXT_GAP = '8px';
export const SIDEBAR_DARK_ICON_COLOR = '#a8a8a8';
export const SIDEBAR_DARK_TEXT_COLOR = '#d8d8d8';
export const SIDEBAR_LIGHT_ICON_COLOR = '#8a8a8a';
export const SIDEBAR_LIGHT_TEXT_COLOR = '#505050';
const iconStyle = (color: string, style?: CSSProperties): CSSProperties => ({
  color,
  opacity: 0.46,
  flexShrink: 0,
  ...style,
});
const SIDEBAR_ICON_SIZE = 14;

export function SidebarMarkdownIcon({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <svg
      width={SIDEBAR_ICON_SIZE}
      height={SIDEBAR_ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={iconStyle(color, style)}
    >
      <path
        d="M4.25 2.5h5.4L12.75 5.6v7.9h-8.5v-11z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.7v3.15h3.05M6 8.25h5M6 10.5h4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarFolderIcon({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <svg
      width={SIDEBAR_ICON_SIZE}
      height={SIDEBAR_ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={iconStyle(color, style)}
    >
      <path
        d="M2.25 5.25h4l1.25 1.5h6.25v6h-11.5v-7.5z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M2.25 5.25v-1.5h3.5l1.25 1.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarRecentIcon({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <svg
      width={SIDEBAR_ICON_SIZE}
      height={SIDEBAR_ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={iconStyle(color, style)}
    >
      <circle
        cx="8"
        cy="8"
        r="5.25"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M8 4.75V8H5.75"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SidebarBookmarkIcon({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <svg
      width={SIDEBAR_ICON_SIZE}
      height={SIDEBAR_ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={iconStyle(color, style)}
    >
      <path
        d="M4.25 2.75h7.5v10.5L8 10.9l-3.75 2.35V2.75z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}
