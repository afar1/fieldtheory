import { useTheme } from '../contexts/ThemeContext';
import {
  getWikiLinkTargetKey,
  type MarkdownLinkedDocument,
  type WikiLinkTarget,
} from '../utils/wikiLinks';

const WIKI_LINK_DIRECTION_MARKER: Record<MarkdownLinkedDocument['direction'], string> = {
  outbound: '→',
  inbound: '←',
  bidirectional: '↔',
};

const WIKI_LINK_DIRECTION_LABEL: Record<MarkdownLinkedDocument['direction'], string> = {
  outbound: 'This document links out',
  inbound: 'Links back to this document',
  bidirectional: 'Linked both ways',
};

const WIKI_LINK_TARGET_LABEL: Record<WikiLinkTarget['kind'], string> = {
  wiki: 'Wiki',
  artifact: 'Artifact',
  command: 'Command',
  bookmarks: 'Bookmarks',
};

type LinkedDocumentsSectionProps = {
  links: MarkdownLinkedDocument[];
  onOpen: (target: WikiLinkTarget) => void;
};

export default function LinkedDocumentsSection({ links, onOpen }: LinkedDocumentsSectionProps) {
  const { theme } = useTheme();
  if (links.length === 0) return null;

  return (
    <section
      aria-label="Linked"
      className="linked-documents-section"
      style={{
        marginTop: '32px',
        paddingTop: '16px',
        borderTop: `1px solid ${theme.border}`,
      }}
    >
      <div
        style={{
          marginBottom: '8px',
          fontSize: '12px',
          fontWeight: 650,
          color: theme.textSecondary,
          letterSpacing: 0,
        }}
      >
        Linked
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {links.map((link) => (
          <button
            key={getWikiLinkTargetKey(link.target)}
            type="button"
            title={WIKI_LINK_DIRECTION_LABEL[link.direction]}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpen(link.target);
            }}
            style={{
              display: 'grid',
              gridTemplateColumns: '18px minmax(0, 1fr)',
              columnGap: '8px',
              alignItems: 'start',
              padding: '6px 0',
              border: 'none',
              backgroundColor: 'transparent',
              color: theme.text,
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                marginTop: '1px',
                color: theme.textSecondary,
                fontSize: '13px',
                lineHeight: 1.2,
                textAlign: 'center',
              }}
            >
              {WIKI_LINK_DIRECTION_MARKER[link.direction]}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>
                {link.title}
                <span style={{ marginLeft: '6px', color: theme.textSecondary, fontSize: '11px', fontWeight: 500 }}>
                  {WIKI_LINK_TARGET_LABEL[link.target.kind]}
                </span>
              </span>
              {link.excerpt && (
                <span
                  style={{
                    display: 'block',
                    marginTop: '2px',
                    color: theme.textSecondary,
                    fontSize: '12px',
                    lineHeight: 1.35,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {link.excerpt}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
