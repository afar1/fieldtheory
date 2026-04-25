import ReactMarkdown from 'react-markdown';

interface MarkdownPreviewCardProps {
  title: string;
  filePath: string;
  content: string;
}

export default function MarkdownPreviewCard({ title, filePath, content }: MarkdownPreviewCardProps) {
  return (
    <article
      style={{
        border: '1px solid rgba(255,255,255,0.1)',
        background: '#1c1c1e',
        color: '#f2f2f2',
        borderRadius: '16px',
        padding: '18px',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        boxShadow: '0 18px 50px rgba(0,0,0,0.4)',
      }}
    >
      <header style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#f2f2f2', wordBreak: 'break-word' }}>
          {title}
        </div>
        <div style={{ marginTop: '4px', fontSize: '11px', color: 'rgba(242,242,242,0.52)', wordBreak: 'break-all' }}>
          {filePath}
        </div>
      </header>
      <div
        style={{
          fontSize: '13px',
          lineHeight: 1.5,
          color: '#f2f2f2',
          overflowWrap: 'anywhere',
        }}
      >
        <ReactMarkdown
          components={{
            pre: ({ children }) => (
              <pre style={{ overflowX: 'auto', whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px' }}>
                {children}
              </pre>
            ),
            code: ({ children }) => (
              <code style={{ fontFamily: 'Menlo, Monaco, Consolas, monospace', fontSize: '12px' }}>
                {children}
              </code>
            ),
            a: ({ children, href }) => (
              <a href={href} style={{ color: '#8ab4ff' }}>
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </article>
  );
}
