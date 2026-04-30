import { forwardRef, type CSSProperties, type MouseEventHandler, type ClipboardEventHandler } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import '@prose-ui/style/prose-ui.css';
import '../prose.css';
import type { ProseRenderer } from '../utils/proseRenderer';

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
  onClick?: MouseEventHandler<HTMLDivElement>;
  onCopy?: ClipboardEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  remarkLineBreaks?: boolean;
  renderer?: ProseRenderer;
  size?: FieldTheoryProseSize;
  style?: CSSProperties;
  surface?: 'dark' | 'light';
}

type FieldTheoryProseStyleProps = Omit<
  FieldTheoryProseProps,
  'children' | 'className' | 'components' | 'onClick' | 'onCopy' | 'onMouseDown' | 'remarkLineBreaks' | 'renderer' | 'size' | 'surface'
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

const FieldTheoryProse = forwardRef<HTMLDivElement, FieldTheoryProseProps>(function FieldTheoryProse({
  children,
  className,
  components,
  onClick,
  onCopy,
  onMouseDown,
  remarkLineBreaks = false,
  renderer = 'field-theory',
  size = 'reader',
  surface,
  ...styleProps
}, ref) {
  const remarkPlugins = remarkLineBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm];
  const baseClassName = renderer === 'prose-ui'
    ? `prose-ui ft-prose-ui ft-prose-ui-${size}${surface ? ` ${surface}` : ''}`
    : `ft-prose ft-prose-${size}${surface ? ` ft-prose-${surface}` : ''}`;

  return (
    <div
      ref={ref}
      className={mergeClassName(baseClassName, className)}
      onClick={onClick}
      onCopy={onCopy}
      onMouseDown={onMouseDown}
      style={proseStyle(styleProps)}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});

export default FieldTheoryProse;
