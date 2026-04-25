import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import BookmarkCard from './components/BookmarkCard';
import MarkdownPreviewCard from './components/MarkdownPreviewCard';

type LauncherPreviewPayload =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'markdown'; title: string; filePath: string; content: string };

interface LauncherPreviewCommandsAPI {
  launcherPreviewResize?: (height: number) => void;
  onLauncherPreview: (callback: (preview: LauncherPreviewPayload) => void) => () => void;
}

const commandsAPI = window.commandsAPI as unknown as LauncherPreviewCommandsAPI;
const PREVIEW_PADDING = 20;

function CommandLauncherPreview() {
  const [preview, setPreview] = useState<LauncherPreviewPayload | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return commandsAPI.onLauncherPreview(setPreview);
  }, []);

  useLayoutEffect(() => {
    if (!preview) return;
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
  }, [preview]);

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
      {preview && (
        <div
          ref={previewRef}
          style={{
            width: '100%',
            maxHeight: '100%',
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            borderRadius: '16px',
          }}
        >
          {preview.kind === 'bookmark' ? (
            <BookmarkCard bookmark={preview.bookmark} isDark />
          ) : (
            <MarkdownPreviewCard
              title={preview.title}
              filePath={preview.filePath}
              content={preview.content}
            />
          )}
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
