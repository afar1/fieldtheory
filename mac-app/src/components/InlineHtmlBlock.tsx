import { useState } from 'react';
import { getHtmlPreviewSrcDoc } from '../utils/htmlPreview';

export const INLINE_HTML_BLOCK_CLASS = 'ft-inline-html-block';

interface InlineHtmlBlockProps {
  html: string;
  documentPath?: string | null;
}

export default function InlineHtmlBlock({ html, documentPath }: InlineHtmlBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const previewPath = documentPath || '/';

  return (
    <figure
      className={`${INLINE_HTML_BLOCK_CLASS}${expanded ? ` ${INLINE_HTML_BLOCK_CLASS}-expanded` : ''}`}
      data-ft-inline-html-block="true"
    >
      <div className={`${INLINE_HTML_BLOCK_CLASS}__toolbar`}>
        <figcaption>HTML</figcaption>
        <button
          type="button"
          aria-label={expanded ? 'Collapse HTML block' : 'Expand HTML block'}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <iframe
        title="Inline HTML block"
        srcDoc={getHtmlPreviewSrcDoc(html, previewPath)}
        sandbox=""
        data-ft-inline-html-preview="true"
      />
    </figure>
  );
}
