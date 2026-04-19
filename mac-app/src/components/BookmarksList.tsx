import { useTheme } from '../contexts/ThemeContext';

function twitterImageUrl(url: string, size: 'small' | 'medium' | 'large' | 'orig' = 'small'): string {
  const base = url.split('?')[0];
  const ext = base.match(/\.(jpg|jpeg|png)$/i);
  const format = ext ? ext[1].toLowerCase() : 'jpg';
  return `${base}?format=${format}&name=${size}`;
}

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

export default function BookmarksList({ bookmarks }: { bookmarks: Bookmark[] }) {
  const { theme } = useTheme();

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '12px 16px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {bookmarks.map((bm) => (
          <a
            key={bm.id}
            href={bm.url}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              display: 'flex',
              gap: '12px',
              padding: '12px',
              textDecoration: 'none',
              color: 'inherit',
              border: `1px solid ${theme.border}`,
              borderRadius: '10px',
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
              // Skip layout + paint for cards offscreen — huge win at 7k items.
              contentVisibility: 'auto',
              containIntrinsicSize: '160px',
            } as React.CSSProperties}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.hoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)';
            }}
          >
            {bm.authorAvatar && (
              <img
                src={bm.authorAvatar}
                alt=""
                width={36}
                height={36}
                style={{ width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>{bm.authorName || bm.authorHandle}</span>
                {bm.authorHandle && (
                  <span style={{ fontSize: '11px', color: theme.textSecondary }}>@{bm.authorHandle}</span>
                )}
                <span style={{ fontSize: '11px', color: theme.textSecondary, opacity: 0.7 }}>· {formatPostedAt(bm.postedAt)}</span>
              </div>
              <div style={{ fontSize: '13px', color: theme.text, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {bm.text}
              </div>
              {bm.images.length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {bm.images.slice(0, 4).map((img, idx) => (
                    <img
                      key={idx}
                      src={twitterImageUrl(img.url, 'small')}
                      alt=""
                      style={{
                        maxWidth: '140px',
                        maxHeight: '140px',
                        borderRadius: '8px',
                        objectFit: 'cover',
                        border: `1px solid ${theme.border}`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
