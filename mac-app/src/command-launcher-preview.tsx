import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import BookmarkCard from './components/BookmarkCard';
import MarkdownPreviewCard from './components/MarkdownPreviewCard';
import type { LauncherClipboardPreviewContent } from './utils/clipboardLauncher';

type LauncherPreviewPayload =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'markdown'; title: string; filePath: string; content: string }
  | { kind: 'clipboard'; title: string; content: LauncherClipboardPreviewContent };

interface LauncherPreviewCommandsAPI {
  launcherPreviewResize?: (height: number) => void;
  onLauncherPreview: (callback: (preview: LauncherPreviewPayload) => void) => () => void;
}

interface LauncherPreviewThemeAPI {
  initialTheme?: boolean;
  getTheme: () => Promise<boolean>;
  onThemeChanged?: (callback: (isDark: boolean) => void) => () => void;
}

const commandsAPI = window.commandsAPI as unknown as LauncherPreviewCommandsAPI;
const themeAPI = window.themeAPI as unknown as LauncherPreviewThemeAPI | undefined;
const PREVIEW_PADDING = 20;
const COMMAND_LAUNCHER_RADIUS = 16;
const PREVIEW_STACK_PADDING_TOP = 10;
const PREVIEW_STACK_PADDING_BOTTOM = 14;
const PREVIEW_FRAME_MAX_HEIGHT = `calc(100vh - ${PREVIEW_PADDING * 2}px)`;
const PREVIEW_CONTENT_MAX_HEIGHT = `calc(100vh - ${PREVIEW_PADDING * 2 + PREVIEW_STACK_PADDING_TOP + PREVIEW_STACK_PADDING_BOTTOM}px)`;

function ClipboardPreviewCard({
  title,
  content,
  isDark,
}: {
  title: string;
  content: LauncherClipboardPreviewContent;
  isDark: boolean;
}) {
  const border = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
  const background = isDark ? '#1e1e1e' : '#fbfbfa';
  const text = isDark ? '#f2f2f2' : '#202020';
  const muted = isDark ? '#8a8a8a' : '#6f6f6f';

  return (
    <div
      style={{
        width: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${border}`,
        borderRadius: `${COMMAND_LAUNCHER_RADIUS}px`,
        background,
        color: text,
        overflow: 'hidden',
        boxShadow: isDark ? '0 18px 48px rgba(0, 0, 0, 0.42)' : '0 18px 48px rgba(0, 0, 0, 0.16)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          padding: '12px 14px 8px',
          borderBottom: `1px solid ${border}`,
          fontSize: '12px',
          lineHeight: '16px',
          fontWeight: 600,
          color: muted,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>
      {content.type === 'image' ? (
        <div
          style={{
            padding: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '180px',
            boxSizing: 'border-box',
          }}
        >
          <img
            src={`data:image/png;base64,${content.data}`}
            alt=""
            style={{
              maxWidth: '100%',
              maxHeight: PREVIEW_CONTENT_MAX_HEIGHT,
              objectFit: 'contain',
              borderRadius: '8px',
              display: 'block',
            }}
          />
        </div>
      ) : (
        <pre
          style={{
            margin: 0,
            padding: '14px',
            maxHeight: PREVIEW_CONTENT_MAX_HEIGHT,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'SF Mono, Monaco, Menlo, monospace',
            fontSize: '12px',
            lineHeight: '18px',
          }}
        >
          {content.content}
        </pre>
      )}
    </div>
  );
}

function PreviewStackFrame({
  children,
  isDark,
}: {
  children: React.ReactNode;
  isDark: boolean;
}) {
  const lowerBackground = isDark ? 'rgba(0, 0, 0, 0.42)' : 'rgba(17, 17, 17, 0.14)';
  const upperBackground = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.58)';
  const border = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxHeight: PREVIEW_FRAME_MAX_HEIGHT,
        minHeight: 0,
        padding: `${PREVIEW_STACK_PADDING_TOP}px 0 ${PREVIEW_STACK_PADDING_BOTTOM}px`,
        boxSizing: 'border-box',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '18px',
          right: '18px',
          top: '22px',
          bottom: '2px',
          borderRadius: `${COMMAND_LAUNCHER_RADIUS}px`,
          background: lowerBackground,
          border: `1px solid ${border}`,
          transform: 'translateY(12px) scale(0.94)',
          filter: 'blur(0.2px)',
          opacity: 0.8,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '9px',
          right: '9px',
          top: '16px',
          bottom: '7px',
          borderRadius: `${COMMAND_LAUNCHER_RADIUS}px`,
          background: upperBackground,
          border: `1px solid ${border}`,
          transform: 'translateY(6px) scale(0.97)',
          opacity: 0.9,
        }}
      />
      <div
        style={{
          position: 'relative',
          maxHeight: PREVIEW_CONTENT_MAX_HEIGHT,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          borderRadius: `${COMMAND_LAUNCHER_RADIUS}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function CommandLauncherPreview() {
  const [preview, setPreview] = useState<LauncherPreviewPayload | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean | null>(() => themeAPI?.initialTheme ?? null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return commandsAPI.onLauncherPreview(setPreview);
  }, []);

  useEffect(() => {
    let cancelled = false;
    themeAPI?.getTheme?.().then((dark) => {
      if (cancelled) return;
      setIsDarkMode(dark);
    });

    const unsubscribe = themeAPI?.onThemeChanged?.((dark) => {
      setIsDarkMode(dark);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useLayoutEffect(() => {
    if (!preview || isDarkMode === null) return;
    const el = previewRef.current;
    if (!el) return;

    const reportHeight = () => {
      commandsAPI.launcherPreviewResize?.(Math.ceil(el.getBoundingClientRect().height + PREVIEW_PADDING * 2));
    };

    reportHeight();
    const rafId = requestAnimationFrame(reportHeight);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(reportHeight)
      : null;
    resizeObserver?.observe(el);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
    };
  }, [preview, isDarkMode]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        padding: '20px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      {preview && isDarkMode !== null && (
        <div
          ref={previewRef}
          style={{
            width: '100%',
            maxHeight: PREVIEW_FRAME_MAX_HEIGHT,
            minHeight: 0,
            overflow: 'visible',
            borderRadius: `${COMMAND_LAUNCHER_RADIUS}px`,
          }}
        >
          <PreviewStackFrame isDark={isDarkMode}>
            {preview.kind === 'bookmark' ? (
              <BookmarkCard bookmark={preview.bookmark} isDark={isDarkMode} />
            ) : preview.kind === 'markdown' ? (
              <MarkdownPreviewCard
                title={preview.title}
                filePath={preview.filePath}
                content={preview.content}
                isDark={isDarkMode}
              />
            ) : (
              <ClipboardPreviewCard
                title={preview.title}
                content={preview.content}
                isDark={isDarkMode}
              />
            )}
          </PreviewStackFrame>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CommandLauncherPreview />
  </React.StrictMode>
);
