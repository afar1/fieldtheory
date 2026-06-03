import React from 'react';

export const FIELD_THEORY_CHROME_TABS_BOTTOM_PX = 8;

export const FIELD_THEORY_TOP_CHROME_DRAG_STYLE = {
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

export const FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE = {
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

export const FOCUS_CHROME_ICON_SIZE_PX = 32;
export const FOCUS_CHROME_ICON_TOP_PX = 32;
export const FOCUS_CHROME_ICON_OPACITY = 0.62;

type LibrarySurfaceTopTabsTheme = {
  accent: string;
  info?: string;
  isDark: boolean;
  textSecondary: string;
};

export type LibrarySurfaceTopTab = {
  id: string;
  label: string;
  title?: string;
  indicator?: boolean;
};

export function LibrarySurfaceTopTabs(props: {
  theme: LibrarySurfaceTopTabsTheme;
  tabs: readonly LibrarySurfaceTopTab[];
  selectedId: string;
  onSelect: (id: string) => void;
  topPaddingPx: number;
  opacity: number;
  interactive: boolean;
  rightSlot?: React.ReactNode;
}) {
  const { theme, tabs, selectedId, onSelect, topPaddingPx, opacity, interactive, rightSlot } = props;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: `${topPaddingPx}px 28px 0 20px`,
        marginTop: 0,
        marginBottom: `${FIELD_THEORY_CHROME_TABS_BOTTOM_PX}px`,
        height: 'auto',
        minHeight: '32px',
        overflow: 'visible',
        opacity,
        pointerEvents: interactive ? 'auto' : 'none',
        transition: 'height 0.3s ease, min-height 0.3s ease, margin-top 0.3s ease, margin-bottom 0.3s ease, opacity 90ms linear',
        cursor: 'grab',
        ...FIELD_THEORY_TOP_CHROME_DRAG_STYLE,
      }}
    >
      {tabs.map((tab) => {
        const isSelected = selectedId === tab.id;
        const backgroundColor = isSelected ? theme.accent : 'transparent';
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            data-top-nav-mode={tab.id}
            tabIndex={0}
            title={tab.title}
            style={{
              position: 'relative',
              padding: '6px 8px',
              fontSize: '11px',
              fontWeight: 400,
              backgroundColor,
              color: isSelected ? '#fff' : theme.textSecondary,
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              transition: 'none',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              ...FIELD_THEORY_TOP_CHROME_NO_DRAG_STYLE,
            }}
            onMouseEnter={(event) => {
              if (!isSelected) {
                event.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
              }
            }}
            onMouseLeave={(event) => {
              if (!isSelected) {
                event.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            {tab.label}
            {tab.indicator ? (
              <span
                data-top-nav-indicator={tab.id}
                style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-2px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: theme.info ?? theme.accent,
                }}
              />
            ) : null}
          </button>
        );
      })}
      {rightSlot ? (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}

export function LibraryTopChromeActionFeedback(props: {
  message: string | null;
  theme: Pick<LibrarySurfaceTopTabsTheme, 'textSecondary'>;
}) {
  const { message, theme } = props;
  if (!message) return null;
  return (
    <span
      data-fieldtheory-top-chrome-action-feedback="true"
      style={{
        fontSize: '9px',
        fontWeight: 500,
        color: theme.textSecondary,
      }}
    >
      {message}
    </span>
  );
}

export function LibraryFocusChromeIcon(props: {
  isDark: boolean;
  top: number;
  contentCenterX: number | null;
  opacity: number;
  size?: number;
}) {
  const { isDark, top, contentCenterX, opacity, size = FOCUS_CHROME_ICON_SIZE_PX } = props;
  return (
    <div
      aria-hidden="true"
      data-fieldtheory-focus-chrome-icon="true"
      style={{
        position: 'absolute',
        top,
        left: contentCenterX === null ? '50%' : `${contentCenterX}px`,
        transform: 'translateX(-50%)',
        zIndex: 20,
        height: `${size}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        opacity,
      }}
    >
      <img
        src={isDark ? '/fieldtheory-icon.png' : '/field-theory-icon-black.png'}
        alt=""
        style={{
          height: `${size}px`,
          width: 'auto',
          display: 'block',
        }}
      />
    </div>
  );
}
