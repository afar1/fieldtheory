import { Children, forwardRef, isValidElement, useEffect, useMemo, useState, type CSSProperties, type MouseEventHandler, type ClipboardEventHandler, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import InlineHtmlBlock from './InlineHtmlBlock';
import BookmarkCard from './BookmarkCard';
import { getBookmarks, onBookmarksChanged, peekBookmarks } from '../services/bookmarksCache';
import { normalizeMarkdownImageUrl } from '../utils/portableMarkdownImages';
import '../prose.css';

type FieldTheoryProseSize = 'reader' | 'compact' | 'preview';

export interface FieldTheoryProseProps {
  children: string;
  components?: Components;
  className?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: string;
  headingFontFamily?: string;
  h1Size?: string;
  h2Size?: string;
  h3Size?: string;
  lineHeight?: CSSProperties['lineHeight'];
  linkColor?: string;
  mutedColor?: string;
  paragraphSpacing?: CSSProperties['marginBottom'];
  documentPath?: string | null;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onCopy?: ClipboardEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  remarkLineBreaks?: boolean;
  size?: FieldTheoryProseSize;
  style?: CSSProperties;
  surface?: 'dark' | 'light';
}

type FieldTheoryProseStyleProps = Omit<
  FieldTheoryProseProps,
  'children' | 'className' | 'components' | 'onClick' | 'onCopy' | 'onMouseDown' | 'remarkLineBreaks' | 'size' | 'surface'
>;

function mergeClassName(base: string, next?: string): string {
  return next ? `${base} ${next}` : base;
}

function proseStyle(props: FieldTheoryProseStyleProps): CSSProperties {
  return {
    '--ft-prose-color': props.color,
    '--ft-prose-font-family': props.fontFamily,
    '--ft-prose-font-size': props.fontSize,
    '--ft-prose-heading-font-family': props.headingFontFamily,
    '--ft-prose-h1-size': props.h1Size,
    '--ft-prose-h2-size': props.h2Size,
    '--ft-prose-h3-size': props.h3Size,
    '--ft-prose-line-height': props.lineHeight,
    '--ft-prose-paragraph-spacing': props.paragraphSpacing,
    '--ft-prose-link': props.linkColor,
    '--ft-prose-muted': props.mutedColor,
    '--p-color-text': props.color,
    '--p-color-text-strong': props.color,
    '--p-color-text-muted': props.mutedColor,
    '--p-color-text-accent': props.linkColor,
    '--p-font-family': props.fontFamily,
    '--p-font-family-heading': props.headingFontFamily ?? props.fontFamily,
    '--p-font-size': props.fontSize,
    '--p-body-font-size': props.fontSize,
    '--p-body-font-height': props.lineHeight,
    '--p-body-color-text': props.color,
    '--p-h1-font-size': props.h1Size,
    '--p-h1-letter-spacing': 0,
    '--p-h2-font-size': props.h2Size,
    '--p-h2-letter-spacing': 0,
    '--p-h3-font-size': props.h3Size,
    '--p-h3-letter-spacing': 0,
    '--p-link-text-color': props.linkColor,
    '--p-link-text-decoration-color': props.linkColor,
    ...props.style,
  } as CSSProperties;
}

export function localFileUrlToFieldTheoryUrl(url: string): string {
  if (!/^file:\/\//i.test(url)) return url;
  return url.replace(/^file:/i, 'ftlocalfile:');
}

function fieldTheoryUrlTransform(url: string, key: string, documentPath?: string | null): string {
  if (key === 'src') {
    if (/^bookmark:\/\//i.test(url)) return url;
    const localImageUrl = normalizeMarkdownImageUrl(url, documentPath);
    if (localImageUrl) return localImageUrl;
  }
  if (key === 'href' && /^(wiki|artifact|command):/i.test(url)) return url;
  return defaultUrlTransform(url);
}

function getTextContent(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return '';
  }).join('');
}

function getBookmarkEmbedId(src: string | undefined): string | null {
  if (!src) return null;
  const clean = src.trim().replace(/^<|>$/g, '');
  if (!clean.toLowerCase().startsWith('bookmark://')) return null;
  const rawId = clean.slice('bookmark://'.length).split(/[?#]/, 1)[0] ?? '';
  if (!rawId) return null;
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}

function BookmarkEmbed({ alt, bookmarkId, isDark }: { alt?: string; bookmarkId: string; isDark: boolean }) {
  const [snapshot, setSnapshot] = useState<BookmarksSnapshot | null>(() => peekBookmarks());

  useEffect(() => {
    let cancelled = false;
    void getBookmarks().then((next) => {
      if (!cancelled) setSnapshot(next);
    });
    const unsubscribe = onBookmarksChanged(setSnapshot);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const bookmark = useMemo(
    () => snapshot?.bookmarks.find((item) => item.id === bookmarkId) ?? null,
    [bookmarkId, snapshot],
  );

  if (!bookmark) {
    return <div data-ft-bookmark-embed-missing="true">{alt || `Bookmark ${bookmarkId}`}</div>;
  }

  return (
    <div data-ft-bookmark-embed="true" style={{ display: 'block', margin: '1em 0' }}>
      <BookmarkCard bookmark={bookmark} compact={false} isDark={isDark} />
    </div>
  );
}

function createFieldTheoryProseComponents(
  components: Components | undefined,
  documentPath: string | null | undefined,
  surface: 'light' | 'dark',
): Components {
  return {
    p: ({ children, ...props }) => {
      const childNodes = Children.toArray(children);
      const onlyChild = childNodes[0];
      if (childNodes.length === 1 && isValidElement<{ alt?: string; src?: string }>(onlyChild)) {
        if (onlyChild.type === BookmarkEmbed) return <>{onlyChild}</>;
        const bookmarkId = getBookmarkEmbedId(onlyChild.props.src);
        if (bookmarkId) {
          return <BookmarkEmbed alt={onlyChild.props.alt} bookmarkId={bookmarkId} isDark={surface === 'dark'} />;
        }
      }
      return <p {...props}>{children}</p>;
    },
    img: ({ alt, src, ...props }) => {
      const bookmarkId = getBookmarkEmbedId(src);
      if (bookmarkId) return <BookmarkEmbed alt={alt} bookmarkId={bookmarkId} isDark={surface === 'dark'} />;
      return <img alt={alt} src={src} {...props} />;
    },
    pre: ({ children, ...props }) => {
      const child = Children.toArray(children)[0];
      if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
        const isInlineHtmlBlock = /(?:^|\s)language-ft-html(?:\s|$)/.test(child.props.className ?? '');
        if (isInlineHtmlBlock) {
          return <InlineHtmlBlock html={getTextContent(child.props.children)} documentPath={documentPath} />;
        }
      }
      return <pre {...props}>{children}</pre>;
    },
    ...components,
  };
}

const FieldTheoryProse = forwardRef<HTMLDivElement, FieldTheoryProseProps>(function FieldTheoryProse({
  children,
  className,
  components,
  documentPath,
  onClick,
  onCopy,
  onMouseDown,
  remarkLineBreaks = false,
  size = 'reader',
  surface,
  ...styleProps
}, ref) {
  const remarkPlugins = remarkLineBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm];
  const baseClassName = `ft-prose ft-prose-${size}${surface ? ` ft-prose-${surface}` : ''}`;
  const fieldTheoryComponents = createFieldTheoryProseComponents(components, documentPath, surface ?? 'light');

  return (
    <div
      ref={ref}
      className={mergeClassName(baseClassName, className)}
      onClick={onClick}
      onCopy={onCopy}
      onMouseDown={onMouseDown}
      style={proseStyle(styleProps)}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={fieldTheoryComponents}
        urlTransform={(url, key) => fieldTheoryUrlTransform(url, key, documentPath)}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

export default FieldTheoryProse;
