import type { CSSProperties } from 'react';
import { localAvatarUrl, localMediaUrls } from '../utils/bookmarkMedia';

function formatPostedAt(raw: string): string {
  if (!raw) return '';
  const time = new Date(raw).getTime();
  if (!time) return '';
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function mediaGridStyle(count: number, border: string): CSSProperties {
  return {
    marginTop: '10px',
    display: 'grid',
    gap: '6px',
    width: '100%',
    height: count === 1 ? '210px' : '240px',
    gridTemplateColumns: count === 1 ? '1fr' : '1fr 1fr',
    gridTemplateRows: count <= 2 ? '1fr' : '1fr 1fr',
    borderRadius: '12px',
    overflow: 'hidden',
    border: `1px solid ${border}`,
  };
}

function mediaCellStyle(count: number, index: number): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    gridColumn: count === 3 && index === 0 ? '1' : undefined,
    gridRow: count === 3 && index === 0 ? '1 / span 2' : undefined,
  };
}

function AuthorLine({ source, secondary }: { source: { authorHandle: string; authorName: string; localAvatarFilename?: string }; secondary?: boolean }) {
  const avatar = localAvatarUrl(source);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
      {avatar && (
        <img
          src={avatar}
          alt=""
          style={{ width: secondary ? '14px' : '18px', height: secondary ? '14px' : '18px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {source.authorName || (source.authorHandle ? `@${source.authorHandle}` : 'Unknown author')}
      </span>
      {source.authorHandle && (
        <span style={{ opacity: 0.72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          @{source.authorHandle}
        </span>
      )}
    </div>
  );
}

export default function BookmarkCard({ bookmark, compact = false, isDark = true }: { bookmark: Bookmark; compact?: boolean; isDark?: boolean }) {
  const mediaUrls = localMediaUrls(bookmark.images).slice(0, 4);
  const quotedMediaUrls = localMediaUrls(bookmark.quotedTweet?.images).slice(0, 4);
  const colors = isDark ? {
    bg: '#1c1c1e',
    border: 'rgba(255,255,255,0.1)',
    text: '#f2f2f2',
    secondary: 'rgba(242,242,242,0.66)',
    quoteBg: 'rgba(255,255,255,0.045)',
  } : {
    bg: '#ffffff',
    border: 'rgba(0,0,0,0.1)',
    text: '#111111',
    secondary: 'rgba(17,17,17,0.58)',
    quoteBg: 'rgba(0,0,0,0.035)',
  };

  return (
    <article
      style={{
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.text,
        borderRadius: compact ? '12px' : '16px',
        padding: compact ? '14px' : '18px',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        boxShadow: isDark ? '0 18px 50px rgba(0,0,0,0.4)' : '0 18px 50px rgba(0,0,0,0.12)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: compact ? '12px' : '13px', fontWeight: 650, color: colors.secondary }}>
        <AuthorLine source={bookmark} />
        <span style={{ flexShrink: 0, fontWeight: 500 }}>{formatPostedAt(bookmark.postedAt)}</span>
      </header>

      {bookmark.text && (
        <div style={{ marginTop: '10px', fontSize: compact ? '13px' : '14px', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {bookmark.text}
        </div>
      )}

      {mediaUrls.length > 0 && (
        <div style={mediaGridStyle(mediaUrls.length, colors.border)}>
          {mediaUrls.map((src, index) => (
            <img key={src} src={src} alt="" style={mediaCellStyle(mediaUrls.length, index)} />
          ))}
        </div>
      )}

      {bookmark.quotedTweet && (
        <section
          style={{
            marginTop: '12px',
            padding: '10px 12px',
            borderRadius: '10px',
            border: `1px solid ${colors.border}`,
            background: colors.quoteBg,
            color: colors.text,
          }}
        >
          <div style={{ fontSize: compact ? '11px' : '12px', fontWeight: 650, color: colors.secondary }}>
            <AuthorLine source={bookmark.quotedTweet} secondary />
          </div>
          {bookmark.quotedTweet.text && (
            <div style={{ marginTop: '7px', fontSize: compact ? '12px' : '13px', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {bookmark.quotedTweet.text}
            </div>
          )}
          {quotedMediaUrls.length > 0 && (
            <div style={{ ...mediaGridStyle(quotedMediaUrls.length, colors.border), height: quotedMediaUrls.length === 1 ? '140px' : '180px' }}>
              {quotedMediaUrls.map((src, index) => (
                <img key={src} src={src} alt="" style={mediaCellStyle(quotedMediaUrls.length, index)} />
              ))}
            </div>
          )}
        </section>
      )}
    </article>
  );
}
