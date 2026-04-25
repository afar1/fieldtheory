import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import BookmarkCard from './components/BookmarkCard';

interface LauncherPreviewCommandsAPI {
  onLauncherPreviewBookmark: (callback: (bookmark: Bookmark) => void) => () => void;
}

const commandsAPI = window.commandsAPI as unknown as LauncherPreviewCommandsAPI;

function CommandLauncherPreview() {
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);

  useEffect(() => {
    return commandsAPI.onLauncherPreviewBookmark(setBookmark);
  }, []);

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
      }}
    >
      {bookmark && (
        <div
          style={{
            width: '100%',
            maxHeight: '100%',
            overflowY: 'auto',
            borderRadius: '16px',
          }}
        >
          <BookmarkCard bookmark={bookmark} isDark />
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
