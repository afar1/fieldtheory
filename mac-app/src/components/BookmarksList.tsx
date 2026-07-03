import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { List, RowComponentProps, useDynamicRowHeight } from 'react-window';
import { localAvatarUrl, localMediaUrls } from '../utils/bookmarkMedia';
import { wrapLines } from '../utils/bookmarkCardHeight';
import { copyBookmarkContent, sendBookmarkToCodex } from '../utils/bookmarkCopy';

function formatPostedAt(raw: string): string {
  if (!raw) return '';
  const t = new Date(raw).getTime();
  if (!t) return '';
  const diff = Date.now() - t;
  const day = 86400000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function bookmarkPrimaryLabel(bm: Bookmark): string {
  if (bm.sourceType === 'web') return bm.title || bm.domain || bm.url;
  return bm.authorName || bm.authorHandle || 'Unknown author';
}

function bookmarkSecondaryLabel(bm: Bookmark): string {
  if (bm.sourceType === 'web') return bm.domain || 'web';
  return bm.authorHandle ? `@${bm.authorHandle}` : '';
}

function bookmarkBodyText(bm: Bookmark): string {
  if (bm.sourceType === 'web') return bm.excerpt || bm.text;
  return bm.text;
}

// Virtualization constants. Height is estimated from char count so we avoid
// mounting all 7k+ list items on first paint (was ~400ms of React
// reconciliation). Approximate heights cause no layout jump because each
// row is positioned absolutely by react-window.
const CARD_PAD = 12;
const CARD_BORDER = 1;
const HEADER_ROW = 20;
const BODY_LINE_HEIGHT = 13 * 1.45;
const BODY_WIDTH_ESTIMATE = 680; // 720px max minus padding
const AVG_CHAR = 7;
const IMAGE_BLOCK = 148;
const GAP_BELOW = 8;

export function estimateRowHeight(bm: Bookmark): number {
  const text = bookmarkBodyText(bm);
  const bodyLines = text ? wrapLines(text, AVG_CHAR, BODY_WIDTH_ESTIMATE) : 0;
  const bodyHeight = bodyLines * BODY_LINE_HEIGHT + (text ? 4 : 0);
  const imageHeight = localMediaUrls(bm.images).length > 0 ? IMAGE_BLOCK : 0;
  return Math.round(CARD_PAD * 2 + CARD_BORDER * 2 + HEADER_ROW + bodyHeight + imageHeight + GAP_BELOW);
}

export function estimateDefaultRowHeight(bookmarks: Bookmark[]): number {
  if (bookmarks.length === 0) return 160;

  const sample = bookmarks.slice(0, Math.min(bookmarks.length, 20));
  const total = sample.reduce((sum, bm) => sum + estimateRowHeight(bm), 0);
  return Math.round(total / sample.length);
}

export function getHeightCacheKey(bookmarks: Bookmark[]): string {
  return bookmarks.map((bm) => bm.id).join('|');
}

interface RowProps {
  bookmarks: Bookmark[];
  theme: ReturnType<typeof useTheme>['theme'];
  copiedBookmarkId: string | null;
  hoverBookmarkId: string | null;
  onCopyBookmark: (bookmarkId: string) => void;
  onSendBookmarkToCodex: (bookmarkId: string) => void;
  onHoverBookmark: (bookmarkId: string | null) => void;
}

function Row({ index, style, bookmarks, theme, copiedBookmarkId, hoverBookmarkId, onCopyBookmark, onSendBookmarkToCodex, onHoverBookmark }: RowComponentProps<RowProps>) {
  const bm = bookmarks[index];
  const mediaUrls = localMediaUrls(bm.images).slice(0, 4);
  const avatarUrl = localAvatarUrl(bm);
  const secondary = bookmarkSecondaryLabel(bm);
  const bodyText = bookmarkBodyText(bm);
  const hovered = hoverBookmarkId === bm.id;
  const copyVisible = hovered || copiedBookmarkId === bm.id;
  const copied = copiedBookmarkId === bm.id;
  const cardBackground = hovered
    ? theme.hoverBg
    : theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)';
  return (
    <div style={style}>
      <div
        onMouseEnter={() => onHoverBookmark(bm.id)}
        onMouseLeave={() => onHoverBookmark(null)}
        style={{
          position: 'relative',
          marginBottom: `${GAP_BELOW}px`,
        }}
      >
        <a
          href={bm.url}
          onClick={(e) => {
            e.preventDefault();
            void window.shellAPI?.openExternal(bm.url);
          }}
          style={{
            display: 'flex',
            gap: '12px',
            padding: '12px',
            textDecoration: 'none',
            color: 'inherit',
            border: `1px solid ${theme.border}`,
            borderRadius: '10px',
            backgroundColor: cardBackground,
            transition: 'background-color 0.15s ease, border-color 0.15s ease',
            boxSizing: 'border-box',
          } as React.CSSProperties}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap', paddingRight: '28px' }}>
              {avatarUrl && (
                <img
                  src={avatarUrl}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                  style={{ width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              )}
              <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>{bookmarkPrimaryLabel(bm)}</span>
              {secondary && (
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>{secondary}</span>
              )}
              <span style={{ fontSize: '11px', color: theme.textSecondary, opacity: 0.7 }}>· {formatPostedAt(bm.postedAt)}</span>
            </div>
            <div style={{ fontSize: '13px', color: theme.text, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {bodyText}
            </div>
            {mediaUrls.length > 0 && (
              <div
                style={{
                  marginTop: '8px',
                  display: 'grid',
                  gap: '6px',
                  width: '140px',
                  height: '140px',
                  gridTemplateColumns: mediaUrls.length === 1 ? '1fr' : '1fr 1fr',
                  gridTemplateRows: mediaUrls.length <= 2 ? '1fr' : '1fr 1fr',
                }}
              >
                {mediaUrls.map((src, idx) => (
                  <img
                    key={idx}
                    src={src}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '8px',
                      objectFit: 'cover',
                      border: `1px solid ${theme.border}`,
                      gridColumn: mediaUrls.length === 3 && idx === 0 ? '1' : undefined,
                      gridRow: mediaUrls.length === 3 && idx === 0 ? '1 / span 2' : undefined,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </a>
        <button
          type="button"
          aria-label="Send bookmark to Codex"
          title="Send bookmark to Codex"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSendBookmarkToCodex(bm.id);
          }}
          style={{
            position: 'absolute',
            top: '8px',
            right: '40px',
            width: '26px',
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.text,
            backgroundColor: theme.isDark ? 'rgba(18,18,20,0.78)' : 'rgba(255,255,255,0.88)',
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            cursor: 'pointer',
            opacity: copyVisible ? 1 : 0,
            pointerEvents: copyVisible ? 'auto' : 'none',
            transition: 'opacity 0.14s ease, color 0.14s ease, transform 0.14s ease',
            transform: copyVisible ? 'translateY(0)' : 'translateY(-2px)',
            boxShadow: theme.isDark ? '0 6px 16px rgba(0,0,0,0.32)' : '0 6px 16px rgba(0,0,0,0.12)',
            zIndex: 2,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 1.8 16.95 5.8v8L10 17.8l-6.95-4v-8L10 1.8Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
            <path d="M10 1.8v7.95m0 8.05V9.75M3.05 5.8 10 9.75l6.95-3.95M3.05 13.8 10 9.75l6.95 4.05" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" opacity="0.82" />
            <path d="M6.65 4.05 13.4 15.6M13.35 4.05 6.6 15.6" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" opacity="0.38" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={copied ? 'Copied' : 'Copy bookmark content'}
          title={copied ? 'Copied' : 'Copy bookmark content'}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCopyBookmark(bm.id);
          }}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '26px',
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: copied ? '#22c55e' : theme.text,
            backgroundColor: theme.isDark ? 'rgba(18,18,20,0.78)' : 'rgba(255,255,255,0.88)',
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            cursor: 'pointer',
            opacity: copyVisible ? 1 : 0,
            pointerEvents: copyVisible ? 'auto' : 'none',
            transition: 'opacity 0.14s ease, color 0.14s ease, transform 0.14s ease',
            transform: copyVisible ? 'translateY(0)' : 'translateY(-2px)',
            boxShadow: theme.isDark ? '0 6px 16px rgba(0,0,0,0.32)' : '0 6px 16px rgba(0,0,0,0.12)',
            zIndex: 2,
          }}
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export default function BookmarksList({ bookmarks, onActionFeedback }: { bookmarks: Bookmark[]; onActionFeedback?: (message: string) => void }) {
  const { theme } = useTheme();
  const [hoverBookmarkId, setHoverBookmarkId] = useState<string | null>(null);
  const [copiedBookmarkId, setCopiedBookmarkId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultRowHeight = useMemo(() => estimateDefaultRowHeight(bookmarks), [bookmarks]);
  const heightCacheKey = useMemo(() => getHeightCacheKey(bookmarks), [bookmarks]);
  const rowHeight = useDynamicRowHeight({ defaultRowHeight, key: heightCacheKey });
  const handleCopyBookmark = useCallback((bookmarkId: string) => {
    void copyBookmarkContent(bookmarkId).then((success) => {
      if (!success) return;
      setCopiedBookmarkId(bookmarkId);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedBookmarkId(null), 1200);
    });
  }, []);
  const handleSendBookmarkToCodex = useCallback((bookmarkId: string) => {
    void sendBookmarkToCodex(bookmarkId).then((success) => {
      if (success) onActionFeedback?.('Bookmark sent to Codex');
    });
  }, [onActionFeedback]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  return (
    <div style={{ height: '100%', padding: '12px 16px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '720px', height: '100%', margin: '0 auto' }}>
        <List
          rowCount={bookmarks.length}
          rowHeight={rowHeight}
          rowComponent={Row}
          rowProps={{
            bookmarks,
            theme,
            copiedBookmarkId,
            hoverBookmarkId,
            onCopyBookmark: handleCopyBookmark,
            onSendBookmarkToCodex: handleSendBookmarkToCodex,
            onHoverBookmark: setHoverBookmarkId,
          }}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}
