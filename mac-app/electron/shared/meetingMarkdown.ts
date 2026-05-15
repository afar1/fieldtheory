import {
  parseMarkdownFrontmatter,
  type ParsedMarkdownFrontmatter,
} from './markdownFrontmatter';

export const DEFAULT_MEETING_STT_ENGINE = 'parakeet';
export const DEFAULT_MEETING_SUMMARY_MODEL = 'gemma-4-E4B-it-Q4_K_M';

export type MeetingSidecarPaths = {
  transcriptPath: string;
  rawTranscriptPath: string;
  audioPath: string;
};

export type MeetingFrontmatter = {
  kind?: string;
  type?: string;
  section?: string;
  meetingId?: string;
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  status?: string;
  sttEngine?: string;
  summaryModel?: string;
  transcriptPath?: string;
  rawTranscriptPath?: string;
  audioPath?: string;
};

export type ParsedMeetingFrontmatter = ParsedMarkdownFrontmatter & {
  meeting: MeetingFrontmatter;
};

export type CreateMeetingMarkdownOptions = {
  title: string;
  meetingId: string;
  createdAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  status?: string;
  sttEngine?: string | null;
  summaryModel?: string | null;
};

export type MeetingTranscriptEntry = {
  text: string;
  speaker?: string | null;
};

export type MeetingTranscriptInput =
  | string
  | MeetingTranscriptEntry
  | Array<string | MeetingTranscriptEntry>;

type MeetingFrontmatterUpdate = Partial<Record<keyof MeetingFrontmatter, string | null | undefined>>;

const MEETING_FRONTMATTER_FIELDS: Record<keyof MeetingFrontmatter, string> = {
  kind: 'kind',
  type: 'type',
  section: 'section',
  meetingId: 'meeting_id',
  createdAt: 'created_at',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  status: 'status',
  sttEngine: 'stt_engine',
  summaryModel: 'summary_model',
  transcriptPath: 'transcript_path',
  rawTranscriptPath: 'raw_transcript_path',
  audioPath: 'audio_path',
};

const MEETING_FRONTMATTER_KEYS = new Set(Object.values(MEETING_FRONTMATTER_FIELDS));

function assertValidMeetingId(meetingId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(meetingId)) {
    throw new Error('Meeting id must contain only letters, numbers, underscores, or hyphens.');
  }
}

function normalizeClassifier(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function cleanFrontmatterScalar(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

function renderFrontmatterLine(field: string, value: string): string {
  const scalar = cleanFrontmatterScalar(value);
  return scalar ? `${field}: ${scalar}` : `${field}:`;
}

function normalizeFrontmatterFieldName(field: string): string {
  return field.replace(/-/g, '_').toLowerCase();
}

function readFrontmatterFieldName(line: string): string | null {
  const field = line.match(/^\s*([A-Za-z][\w-]*)\s*:/);
  return field ? normalizeFrontmatterFieldName(field[1]) : null;
}

function rebuildMarkdown(parsed: ParsedMarkdownFrontmatter, body: string): string {
  if (parsed.raw === null) return body;
  return `---\n${parsed.raw}\n---\n\n${body.replace(/^\n+/, '')}`;
}

function findSection(body: string, heading: string): { start: number; end: number; content: string } | null {
  const headingPattern = /^##[ \t]+(.+?)[ \t]*$/gm;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(body))) {
    if (match[1].trim().toLowerCase() !== heading.toLowerCase()) continue;

    const start = match.index;
    let contentStart = start + match[0].length;
    if (body.slice(contentStart, contentStart + 2) === '\r\n') {
      contentStart += 2;
    } else if (body[contentStart] === '\n') {
      contentStart += 1;
    }

    const nextHeadingPattern = /^##[ \t]+.+?[ \t]*$/gm;
    nextHeadingPattern.lastIndex = contentStart;
    const nextHeading = nextHeadingPattern.exec(body);
    const end = nextHeading?.index ?? body.length;
    return { start, end, content: body.slice(contentStart, end) };
  }

  return null;
}

function renderSection(heading: string, content: string): string {
  const trimmed = content.trim();
  return trimmed ? `## ${heading}\n\n${trimmed}\n\n` : `## ${heading}\n\n`;
}

function replaceSection(body: string, heading: string, content: string): string {
  const section = findSection(body, heading);
  const rendered = renderSection(heading, content);
  if (!section) {
    return `${body.replace(/\s*$/, '')}\n\n${rendered}`.replace(/\s*$/, '\n');
  }

  const after = body.slice(section.end).replace(/^\n+/, '');
  return `${body.slice(0, section.start).replace(/\s*$/, '')}\n\n${rendered}${after}`.replace(/\s*$/, '\n');
}

function appendToSection(body: string, heading: string, content: string): string {
  const section = findSection(body, heading);
  if (!section) return replaceSection(body, heading, content);

  const nextContent = section.content.trim()
    ? `${section.content.trim()}\n\n${content.trim()}`
    : content.trim();
  return replaceSection(body, heading, nextContent);
}

function escapeWikiLinkPart(value: string): string {
  return value.replace(/\]/g, '\\]');
}

function normalizeTranscriptWikiTarget(path: string): string {
  return path.replace(/\.md$/i, '');
}

export function getMeetingSidecarPaths(meetingId: string): MeetingSidecarPaths {
  assertValidMeetingId(meetingId);
  const basePath = `.meetings/${meetingId}`;
  return {
    transcriptPath: `${basePath}/transcript.md`,
    rawTranscriptPath: `${basePath}/transcript.jsonl`,
    audioPath: `${basePath}/audio.wav`,
  };
}

export function renderMeetingRawTranscriptWikiLink(meetingIdOrPath: string, label = 'Raw transcript'): string {
  const transcriptPath = meetingIdOrPath.startsWith('.meetings/')
    ? meetingIdOrPath
    : getMeetingSidecarPaths(meetingIdOrPath).transcriptPath;
  return `[[${escapeWikiLinkPart(normalizeTranscriptWikiTarget(transcriptPath))}|${escapeWikiLinkPart(label)}]]`;
}

export function createMeetingMarkdown(options: CreateMeetingMarkdownOptions): string {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const sidecars = getMeetingSidecarPaths(options.meetingId);
  const lines = [
    'kind: meeting',
    'section: meetings',
    `meeting_id: ${options.meetingId}`,
    `created_at: ${createdAt}`,
    renderFrontmatterLine('started_at', options.startedAt ?? ''),
    renderFrontmatterLine('ended_at', options.endedAt ?? ''),
    `status: ${options.status ?? 'draft'}`,
    `stt_engine: ${options.sttEngine ?? DEFAULT_MEETING_STT_ENGINE}`,
    `summary_model: ${options.summaryModel ?? DEFAULT_MEETING_SUMMARY_MODEL}`,
    `transcript_path: ${sidecars.transcriptPath}`,
    `raw_transcript_path: ${sidecars.rawTranscriptPath}`,
    `audio_path: ${sidecars.audioPath}`,
  ];

  return [
    '---',
    ...lines,
    '---',
    '',
    `# ${options.title.trim() || 'Untitled Meeting'}`,
    '',
    '## Notes',
    '',
    '## Summary',
    '',
    '## Transcript',
    '',
  ].join('\n');
}

export function parseMeetingFrontmatter(content: string): ParsedMeetingFrontmatter {
  const parsed = parseMarkdownFrontmatter(content);
  const { meta } = parsed;
  return {
    ...parsed,
    meeting: {
      kind: meta.kind,
      type: meta.type,
      section: meta.section,
      meetingId: meta.meeting_id,
      createdAt: meta.created_at,
      startedAt: meta.started_at,
      endedAt: meta.ended_at,
      status: meta.status,
      sttEngine: meta.stt_engine,
      summaryModel: meta.summary_model,
      transcriptPath: meta.transcript_path,
      rawTranscriptPath: meta.raw_transcript_path,
      audioPath: meta.audio_path,
    },
  };
}

export function isMeetingDocument(contentOrMeta: string | Record<string, string>): boolean {
  const meta = typeof contentOrMeta === 'string'
    ? parseMarkdownFrontmatter(contentOrMeta).meta
    : contentOrMeta;
  return normalizeClassifier(meta.kind) === 'meeting'
    || normalizeClassifier(meta.type) === 'meeting'
    || normalizeClassifier(meta.section) === 'meetings';
}

export function setMeetingFrontmatter(content: string, updates: MeetingFrontmatterUpdate): string {
  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content : parsed.body;
  const updateEntries = Object.entries(updates)
    .filter((entry): entry is [keyof MeetingFrontmatter, string | null] => entry[1] !== undefined);
  if (updateEntries.length === 0) return content;

  const meetingLinesByField = new Map<string, string>();
  const unknownLines: string[] = [];
  if (parsed.raw?.trim()) {
    for (const line of parsed.lines) {
      if (!line.trim()) continue;
      const field = readFrontmatterFieldName(line);
      if (field && MEETING_FRONTMATTER_KEYS.has(field)) {
        meetingLinesByField.set(field, renderFrontmatterLine(field, parsed.meta[field] ?? ''));
      } else {
        unknownLines.push(line);
      }
    }
  }

  for (const [key, value] of updateEntries) {
    const field = MEETING_FRONTMATTER_FIELDS[key];
    if (value === null) {
      meetingLinesByField.delete(field);
    } else {
      meetingLinesByField.set(field, renderFrontmatterLine(field, value));
    }
  }

  const meetingLines = Object.values(MEETING_FRONTMATTER_FIELDS)
    .flatMap((field) => meetingLinesByField.get(field) ?? []);

  const nextLines = [
    ...meetingLines,
    ...(unknownLines.length > 0 ? ['', ...unknownLines] : []),
  ];
  const nonEmptyLines = nextLines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) return body;

  return `---\n${nextLines.join('\n')}\n---\n\n${body}`;
}

export function setMeetingStatus(
  content: string,
  status: string,
  timestamps: Pick<MeetingFrontmatter, 'startedAt' | 'endedAt'> = {},
): string {
  return setMeetingFrontmatter(content, {
    status,
    ...timestamps,
  });
}

export function renderMeetingTranscriptEntry(entry: string | MeetingTranscriptEntry): string {
  if (typeof entry === 'string') return entry.trim();

  const text = entry.text.trim();
  if (!text) return '';

  const speaker = entry.speaker?.trim();
  return speaker ? `**${speaker}:** ${text}` : text;
}

export function appendMeetingTranscript(content: string, input: MeetingTranscriptInput): string {
  const entries = Array.isArray(input) ? input : [input];
  const transcriptText = entries
    .map(renderMeetingTranscriptEntry)
    .filter(Boolean)
    .join('\n\n');
  if (!transcriptText) return content;

  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content : parsed.body;
  return rebuildMarkdown(parsed, appendToSection(body, 'Transcript', transcriptText));
}

export function replaceMeetingSummary(content: string, summary: string): string {
  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content : parsed.body;
  return rebuildMarkdown(parsed, replaceSection(body, 'Summary', summary));
}

export function isMeetingFrontmatterKey(key: string): boolean {
  return MEETING_FRONTMATTER_KEYS.has(key.replace(/-/g, '_').toLowerCase());
}
