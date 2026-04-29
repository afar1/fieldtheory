import { createHash } from 'crypto';

export interface ExtractedWebBookmarkMarkdown {
  title: string;
  markdown: string;
  excerpt: string;
}

const BLOCK_TAGS = [
  'article',
  'main',
  'section',
  'div',
  'p',
  'blockquote',
  'pre',
  'ul',
  'ol',
];

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function getAttribute(tag: string, attr: string): string {
  const pattern = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  return decodeHtml((match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim());
}

function absoluteHttpUrl(raw: string, baseUrl: string): string {
  try {
    const parsed = new URL(raw, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function firstMetaContent(html: string, names: string[]): string {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metas) {
    const key = (getAttribute(tag, 'property') || getAttribute(tag, 'name')).toLowerCase();
    if (names.includes(key)) return getAttribute(tag, 'content');
  }
  return '';
}

function extractTitle(html: string): string {
  const metaTitle = firstMetaContent(html, ['og:title', 'twitter:title']);
  if (metaTitle) return stripTags(metaTitle);
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : '';
}

function extractContainer(html: string): string {
  for (const tag of ['article', 'main']) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return body?.[1] ?? html;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|button|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|button|nav|header|footer|aside)\b[^>]*\/?>/gi, '');
}

function inlineMarkdown(html: string, baseUrl: string): string {
  return stripTags(
    html
      .replace(/<img\b[^>]*>/gi, (tag) => {
        const src = absoluteHttpUrl(getAttribute(tag, 'src'), baseUrl);
        if (!src) return '';
        const alt = getAttribute(tag, 'alt') || 'image';
        return ` ![${alt.replace(/[\[\]]/g, '')}](${src}) `;
      })
      .replace(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi, (_all, d, s, b, inner) => {
        const text = stripTags(inner);
        const href = absoluteHttpUrl(d ?? s ?? b ?? '', baseUrl);
        if (!text) return '';
        return href ? ` [${text.replace(/[\[\]]/g, '')}](${href}) ` : text;
      }),
  );
}

function htmlToMarkdown(html: string, baseUrl: string): string {
  let out = cleanHtml(html);

  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_all, level, inner) => {
    const text = inlineMarkdown(inner, baseUrl);
    return text ? `\n\n${'#'.repeat(Number(level))} ${text}\n\n` : '\n\n';
  });
  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_all, inner) => {
    const text = inlineMarkdown(inner, baseUrl);
    return text ? `\n- ${text}` : '';
  });
  out = out.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_all, inner) => {
    const text = htmlToMarkdown(inner, baseUrl)
      .split('\n')
      .map((line) => line.trim() ? `> ${line}` : '>')
      .join('\n');
    return `\n\n${text}\n\n`;
  });
  out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_all, inner) => {
    const text = stripTags(inner);
    return text ? `\n\n\`\`\`\n${text}\n\`\`\`\n\n` : '';
  });

  for (const tag of BLOCK_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '\n\n');
    out = out.replace(new RegExp(`<\\/${tag}>`, 'gi'), '\n\n');
  }

  out = inlineMarkdown(out, baseUrl);
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function excerptFromMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^#+\s+/, '').trim())
    .filter((line) => line && !line.startsWith('![') && !line.startsWith('```'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 260)
    .trim();
}

export function canonicalWebBookmarkUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be saved');
  }
  parsed.hash = '';
  parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

export function webBookmarkId(canonicalUrl: string): string {
  return `web:${createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 16)}`;
}

export function webBookmarkDomain(canonicalUrl: string): string {
  return new URL(canonicalUrl).hostname.replace(/^www\./i, '').toLowerCase();
}

export function slugifyWebBookmarkTitle(title: string, fallback: string): string {
  const slug = (title || fallback)
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'saved-page';
}

export function extractWebBookmarkMarkdown(html: string, rawUrl: string): ExtractedWebBookmarkMarkdown {
  const canonicalUrl = canonicalWebBookmarkUrl(rawUrl);
  const title = extractTitle(html) || webBookmarkDomain(canonicalUrl);
  const body = htmlToMarkdown(extractContainer(html), canonicalUrl);
  const markdown = body.startsWith('# ') ? body : `# ${title}\n\n${body || canonicalUrl}`;
  return {
    title,
    markdown,
    excerpt: excerptFromMarkdown(markdown),
  };
}

export function withWebBookmarkFrontmatter(params: {
  title: string;
  url: string;
  domain: string;
  savedAt: string;
  markdown: string;
}): string {
  const escapeValue = (value: string) => JSON.stringify(value);
  return [
    '---',
    `title: ${escapeValue(params.title)}`,
    `source_url: ${escapeValue(params.url)}`,
    `domain: ${escapeValue(params.domain)}`,
    `saved_at: ${escapeValue(params.savedAt)}`,
    'source_type: "web"',
    '---',
    '',
    params.markdown.trim(),
    '',
  ].join('\n');
}
