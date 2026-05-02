import type { CSSProperties } from 'react';
import FieldTheoryProse from './FieldTheoryProse';

interface MarkdownPreviewCardProps {
  title: string;
  filePath: string;
  content: string;
  isDark?: boolean;
}

export default function MarkdownPreviewCard({ title, filePath, content, isDark = true }: MarkdownPreviewCardProps) {
  const colors = isDark ? {
    bg: '#1c1c1e',
    border: 'rgba(255,255,255,0.1)',
    text: '#f2f2f2',
    secondary: 'rgba(242,242,242,0.52)',
    codeBg: 'rgba(255,255,255,0.06)',
    link: '#8ab4ff',
    shadow: '0 18px 50px rgba(0,0,0,0.4)',
  } : {
    bg: '#ffffff',
    border: 'rgba(0,0,0,0.1)',
    text: '#111111',
    secondary: 'rgba(17,17,17,0.58)',
    codeBg: 'rgba(0,0,0,0.045)',
    link: '#1d4ed8',
    shadow: '0 18px 50px rgba(0,0,0,0.12)',
  };

  return (
    <article
      style={{
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.text,
        borderRadius: '16px',
        padding: '18px',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        boxShadow: colors.shadow,
      }}
    >
      <header style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: colors.text, wordBreak: 'break-word' }}>
          {title}
        </div>
        <div style={{ marginTop: '4px', fontSize: '11px', color: colors.secondary, wordBreak: 'break-all' }}>
          {filePath}
        </div>
      </header>
      <FieldTheoryProse
        color={colors.text}
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
        fontSize="13px"
        h1Size="18px"
        h2Size="15px"
        h3Size="13px"
        linkColor={colors.link}
        size="preview"
        surface={isDark ? 'dark' : 'light'}
        style={{
          '--ft-prose-code': colors.codeBg,
        } as CSSProperties}
      >
        {content}
      </FieldTheoryProse>
    </article>
  );
}
