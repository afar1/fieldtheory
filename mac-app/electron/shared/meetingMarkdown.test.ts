import { describe, expect, it } from 'vitest';
import {
  appendMeetingTranscript,
  createMeetingMarkdown,
  getMeetingSidecarPaths,
  isMeetingDocument,
  isMeetingFrontmatterKey,
  parseMeetingFrontmatter,
  renderMeetingRawTranscriptWikiLink,
  renderMeetingTranscriptEntry,
  replaceMeetingSummary,
  setMeetingFrontmatter,
  setMeetingStatus,
} from './meetingMarkdown';

describe('meetingMarkdown', () => {
  it('creates an ordinary meeting markdown file with scalar frontmatter and sidecar paths', () => {
    const content = createMeetingMarkdown({
      title: 'Weekly Sync',
      meetingId: '7e3f',
      createdAt: '2026-05-14T21:00:00-07:00',
      startedAt: '2026-05-14T21:01:03-07:00',
      status: 'recording',
    });
    const parsed = parseMeetingFrontmatter(content);

    expect(parsed.meeting).toMatchObject({
      kind: 'meeting',
      section: 'meetings',
      meetingId: '7e3f',
      createdAt: '2026-05-14T21:00:00-07:00',
      startedAt: '2026-05-14T21:01:03-07:00',
      endedAt: '',
      status: 'recording',
      sttEngine: 'parakeet',
      summaryModel: 'gemma-4-E4B-it-Q4_K_M',
      transcriptPath: '.meetings/7e3f/transcript.md',
      rawTranscriptPath: '.meetings/7e3f/transcript.jsonl',
      audioPath: '.meetings/7e3f/audio.wav',
    });
    expect(parsed.body).toBe('# Weekly Sync\n\n## Notes\n\n## Summary\n\n## Transcript\n');
    expect(isMeetingDocument(content)).toBe(true);
  });

  it('classifies meeting documents from kind, type, or section metadata', () => {
    expect(isMeetingDocument({ kind: 'meeting' })).toBe(true);
    expect(isMeetingDocument({ type: 'meeting' })).toBe(true);
    expect(isMeetingDocument({ section: 'meetings' })).toBe(true);
    expect(isMeetingDocument({ kind: 'note', section: 'scratchpad' })).toBe(false);
  });

  it('updates meeting frontmatter without rewriting the markdown body', () => {
    const content = [
      '---',
      'kind: meeting',
      'meeting_id: old',
      'status: draft',
      'ended_at:',
      'tags: [work]',
      '---',
      '',
      '# Existing',
      '',
      '## Notes',
      '',
      'Keep typing here.',
      '',
    ].join('\n');

    const updated = setMeetingFrontmatter(content, {
      meetingId: 'new',
      status: 'recording',
      startedAt: '2026-05-14T21:01:03-07:00',
      endedAt: null,
    });

    expect(updated).toBe([
      '---',
      'kind: meeting',
      'meeting_id: new',
      'started_at: 2026-05-14T21:01:03-07:00',
      'status: recording',
      '',
      'tags: [work]',
      '---',
      '',
      '# Existing',
      '',
      '## Notes',
      '',
      'Keep typing here.',
      '',
    ].join('\n'));
  });

  it('normalizes messy meeting frontmatter while preserving custom lines', () => {
    const content = [
      '---',
      'ended_at:',
      '',
      'kind: meeting',
      'section: meetings',
      'meeting_id: messy-1',
      '',
      'started_at: 2026-05-14T21:01:03-07:00',
      'summary_model: gemma-4-E4B-it-Q4_K_M',
      '',
      'transcript_path: .meetings/messy-1/transcript.md',
      'custom: keep me',
      'status: summarizing',
      '---',
      '',
      '# Existing',
      '',
    ].join('\n');

    const updated = setMeetingFrontmatter(content, {
      status: 'done',
      endedAt: '2026-05-14T21:30:00-07:00',
    });

    expect(updated).toBe([
      '---',
      'kind: meeting',
      'section: meetings',
      'meeting_id: messy-1',
      'started_at: 2026-05-14T21:01:03-07:00',
      'ended_at: 2026-05-14T21:30:00-07:00',
      'status: done',
      'summary_model: gemma-4-E4B-it-Q4_K_M',
      'transcript_path: .meetings/messy-1/transcript.md',
      '',
      'custom: keep me',
      '---',
      '',
      '# Existing',
      '',
    ].join('\n'));
  });

  it('sets meeting status with timestamps', () => {
    const updated = setMeetingStatus('# Meeting\n', 'complete', {
      endedAt: '2026-05-14T21:30:00-07:00',
    });

    expect(updated).toBe('---\nended_at: 2026-05-14T21:30:00-07:00\nstatus: complete\n---\n\n# Meeting\n');
  });

  it('appends speaker-aware transcript text under the transcript section', () => {
    const content = createMeetingMarkdown({
      title: 'Product Review',
      meetingId: 'review-1',
      createdAt: '2026-05-14T21:00:00-07:00',
    });

    const updated = appendMeetingTranscript(content, [
      { speaker: 'Ari', text: 'We should keep the markdown file as the source of truth.' },
      { text: 'Unlabeled audio is preserved without inventing a speaker.' },
    ]);

    expect(updated).toContain('## Transcript\n\n**Ari:** We should keep the markdown file as the source of truth.\n\nUnlabeled audio is preserved without inventing a speaker.\n');
    expect(renderMeetingTranscriptEntry({ speaker: '', text: 'No speaker label.' })).toBe('No speaker label.');
  });

  it('creates the transcript section when appending to a plain meeting note', () => {
    const updated = appendMeetingTranscript('# Meeting\n\n## Notes\n\nLive note.', {
      speaker: 'Sam',
      text: 'Transcript starts later.',
    });

    expect(updated).toBe('# Meeting\n\n## Notes\n\nLive note.\n\n## Transcript\n\n**Sam:** Transcript starts later.\n');
  });

  it('replaces only the summary section while preserving notes, transcript, and frontmatter', () => {
    const content = [
      '---',
      'kind: meeting',
      'meeting_id: 7e3f',
      '---',
      '',
      '# Planning',
      '',
      '## Notes',
      '',
      '- Human note stays.',
      '',
      '## Summary',
      '',
      'Old summary.',
      '',
      '## Transcript',
      '',
      '**Ari:** Keep the transcript.',
      '',
    ].join('\n');

    const updated = replaceMeetingSummary(content, '- New decision\n- Follow-up');

    expect(updated).toContain('kind: meeting');
    expect(updated).toContain('- Human note stays.');
    expect(updated).toContain('## Summary\n\n- New decision\n- Follow-up\n\n## Transcript');
    expect(updated).toContain('**Ari:** Keep the transcript.');
    expect(updated).not.toContain('Old summary.');
  });

  it('renders sidecar paths and a visible wiki link for the raw transcript markdown sidecar', () => {
    expect(getMeetingSidecarPaths('meeting_123')).toEqual({
      transcriptPath: '.meetings/meeting_123/transcript.md',
      rawTranscriptPath: '.meetings/meeting_123/transcript.jsonl',
      audioPath: '.meetings/meeting_123/audio.wav',
    });
    expect(renderMeetingRawTranscriptWikiLink('meeting_123')).toBe('[[.meetings/meeting_123/transcript|Raw transcript]]');
    expect(renderMeetingRawTranscriptWikiLink('.meetings/meeting_123/transcript.md', 'Open raw transcript')).toBe(
      '[[.meetings/meeting_123/transcript|Open raw transcript]]',
    );
  });

  it('recognizes meeting frontmatter keys', () => {
    expect(isMeetingFrontmatterKey('meeting-id')).toBe(true);
    expect(isMeetingFrontmatterKey('raw_transcript_path')).toBe(true);
    expect(isMeetingFrontmatterKey('todo')).toBe(false);
  });

  it('rejects meeting ids that cannot safely map to sidecar paths', () => {
    expect(() => getMeetingSidecarPaths('../outside')).toThrow(/Meeting id/);
  });
});
