import { useTheme } from '../contexts/ThemeContext';
import { List } from 'react-window';
import { localAvatarUrl, localMediaUrls } from '../utils/bookmarkMedia';

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

function estimateRowHeight(bm: Bookmark): number {
  const bodyLines = bm.text ? Math.max(1, Math.ceil(bm.text.length * AVG_CHAR / BODY_WIDTH_ESTIMATE)) : 0;
  const bodyHeight = bodyLines * BODY_LINE_HEIGHT + (bm.text ? 4 : 0);
  const imageHeight = localMediaUrls(bm.images).length > 0 ? IMAGE_BLOCK : 0;
  return Math.round(CARD_PAD * 2 + CARD_BORDER * 2 + HEADER_ROW + bodyHeight + imageHeight + GAP_BELOW);
}

interface RowProps {
  bookmarks: Bookmark[];
  theme: ReturnType<typeof useTheme>['theme'];
}

function Row({ index, style, bookmarks, theme }: { index: number; style: React.CSSProperties } & RowProps) {
  const bm = bookmarks[index];
  const mediaUrls = localMediaUrls(bm.images).slice(0, 4);
  const avatarUrl = localAvatarUrl(bm);
  return (
    <div style={style}>
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
          marginBottom: `${GAP_BELOW}px`,
          textDecoration: 'none',
          color: 'inherit',
          border: `1px solid ${theme.border}`,
          borderRadius: '10px',
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
          boxSizing: 'border-box',
        } as React.CSSProperties}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.hoverBg;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)';
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                style={{ width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
            )}
            <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>{bm.authorName || bm.authorHandle}</span>
            {bm.authorHandle && (
              <span style={{ fontSize: '11px', color: theme.textSecondary }}>@{bm.authorHandle}</span>
            )}
            <span style={{ fontSize: '11px', color: theme.textSecondary, opacity: 0.7 }}>· {formatPostedAt(bm.postedAt)}</span>
          </div>
          <div style={{ fontSize: '13px', color: theme.text, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {bm.text}
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
    </div>
  );
}

export default function BookmarksList({ bookmarks }: { bookmarks: Bookmark[] }) {
  const { theme } = useTheme();

  return (
    <div style={{ height: '100%', padding: '12px 16px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '720px', height: '100%', margin: '0 auto' }}>
        <List
          rowCount={bookmarks.length}
          rowHeight={(index: number, props: RowProps) => estimateRowHeight(props.bookmarks[index])}
          rowComponent={Row}
          rowProps={{ bookmarks, theme }}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}
