import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceMeetingSummary } from '../shared/meetingMarkdown';
import { type DocumentSaveResult, type DocumentVersion, readDocumentVersion, writeTextFileWithConflictGuard } from './documentSaveGuard';
import { MeetingManager, type MeetingFileContext } from './meetingManager';
import type { MeetingCaptureResult, MeetingCaptureSession } from './transcriberManager';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-meetings-'));
  tempDirs.push(dir);
  return dir;
}

function makeLibrarian(root: string) {
  return {
    createWikiFileWithTitle: vi.fn((folderName: string, title: string) => {
      const dir = path.join(root, folderName);
      fs.mkdirSync(dir, { recursive: true });
      const fileName = `${title.replace(/[/:]/g, '-').trim()}.md`;
      const absPath = path.join(dir, fileName);
      if (fs.existsSync(absPath)) return null;
      fs.writeFileSync(absPath, '', 'utf-8');
      return {
        relPath: `${folderName}/${path.basename(fileName, '.md')}`,
        absPath,
        title,
        content: '',
        documentVersion: readDocumentVersion(absPath),
      };
    }),
    getWikiPage: vi.fn((relPath: string) => {
      const absPath = path.join(root, `${relPath}.md`);
      if (!fs.existsSync(absPath)) return null;
      return {
        relPath,
        absPath,
        title: path.basename(absPath, '.md'),
        content: fs.readFileSync(absPath, 'utf-8'),
        documentVersion: readDocumentVersion(absPath),
      };
    }),
    saveWikiPage: vi.fn((relPath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult => {
      return writeTextFileWithConflictGuard(path.join(root, `${relPath}.md`), content, expectedVersion);
    }),
    getWikiRoot: vi.fn(() => root),
    emit: vi.fn(() => true),
  };
}

function makeManager(overrides: Partial<ConstructorParameters<typeof MeetingManager>[0]> = {}) {
  const root = makeTempDir();
  const audioPath = path.join(root, 'capture.wav');
  fs.writeFileSync(audioPath, 'audio');
  const librarian = makeLibrarian(root);
  const transcriber = {
    startMeetingCapture: vi.fn(async (): Promise<MeetingCaptureSession> => ({
      startedAt: '2026-05-14T20:00:00.000Z',
      source: 'microphone',
      transcriptionEngine: 'parakeet',
      speakerDiarizationSupported: false,
    })),
    stopMeetingCapture: vi.fn(async (): Promise<MeetingCaptureResult> => ({
      startedAt: '2026-05-14T20:00:00.000Z',
      stoppedAt: '2026-05-14T20:03:00.000Z',
      source: 'microphone',
      transcriptionEngine: 'parakeet',
      speakerDiarizationSupported: false,
      transcriptText: 'Alice: Keep the markdown file as the source of truth.\nBob: Add clean summary notes.',
      audioPath,
    })),
    cancelMeetingCapture: vi.fn(async () => {}),
  };
  const localLlm = {
    getSelectedModel: vi.fn(() => 'gemma-4-E4B-it-Q4_K_M' as const),
    getHarness: vi.fn(() => 'direct' as const),
    runReplacementCommand: vi.fn(async ({ targetContent }: { targetContent: string }) => (
      replaceMeetingSummary(targetContent, '**Decisions:** Keep markdown native.\n\n**Action Items:** Add meeting manager.')
    )),
  };
  const manager = new MeetingManager({
    librarian,
    transcriber,
    localLlm,
    getMeetingSummaryPrompt: () => 'Summarize only the Summary section.',
    now: () => new Date('2026-05-14T20:00:00.000Z'),
    idFactory: () => 'meeting-1',
    ...overrides,
  });
  return { manager, root, audioPath, librarian, transcriber, localLlm };
}

function contextFromResult(result: Awaited<ReturnType<MeetingManager['createMeetingNote']>>): MeetingFileContext {
  if (!result.session) throw new Error('missing session');
  return {
    type: result.session.type,
    relPath: result.session.relPath ?? '',
    filePath: result.session.filePath,
    title: result.session.title,
  };
}

describe('MeetingManager', () => {
  it('creates an ordinary meeting note under Meetings and opens the Notes section', async () => {
    const { manager, root } = makeManager();

    const result = await manager.createMeetingNote('Design Review');

    expect(result.success).toBe(true);
    expect(result.openTarget).toMatchObject({
      kind: 'wiki',
      path: 'Meetings/Design Review',
      contentMode: 'markdown',
    });
    expect(result.openTarget?.selectionStart).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(root, 'Meetings', 'Design Review.md'), 'utf-8');
    expect(content).toContain('kind: meeting');
    expect(content).toContain('meeting_id: meeting-1');
    expect(content).toContain('## Notes');
  });

  it('records into the bound markdown file, writes hidden sidecars, and preserves live notes', async () => {
    const { manager, root, transcriber, localLlm } = makeManager();
    const progressEvents: Array<Record<string, unknown>> = [];
    manager.on('summary-progress', (event) => progressEvents.push(event));
    const created = await manager.createMeetingNote('Planning');
    const context = contextFromResult(created);

    const started = await manager.startHere(context);
    expect(started.success).toBe(true);
    expect(transcriber.startMeetingCapture).toHaveBeenCalledOnce();

    const duringCall = fs.readFileSync(context.filePath, 'utf-8')
      .replace('## Notes\n\n', '## Notes\n\n- typed while talking\n\n');
    fs.writeFileSync(context.filePath, duringCall, 'utf-8');

    const stopped = await manager.stopActiveMeeting();

    expect(stopped.success).toBe(true);
    expect(transcriber.stopMeetingCapture).toHaveBeenCalledOnce();
    expect(localLlm.runReplacementCommand).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'summarize-meeting',
      commandContent: expect.stringContaining('Summarize only the Summary section.'),
    }), expect.any(Object));
    expect(localLlm.runReplacementCommand).toHaveBeenCalledWith(expect.objectContaining({
      commandContent: expect.stringContaining('Do not renumber Speaker 1, Speaker 2, Speaker 3, or any named speaker.'),
    }), expect.any(Object));

    const finalContent = fs.readFileSync(context.filePath, 'utf-8');
    expect(finalContent).toContain('- typed while talking');
    expect(finalContent).toContain('Raw transcript: [[.meetings/meeting-1/transcript|Raw transcript]]');
    expect(finalContent).toContain('<!-- speaker_id: spk_1 -->\n**Alice:** Keep the markdown file as the source of truth.');
    expect(finalContent).toContain('<!-- speaker_id: spk_2 -->\n**Bob:** Add clean summary notes.');
    expect(finalContent).toContain('**Alice:** Keep the markdown file as the source of truth.');
    expect(finalContent).toContain('**Bob:** Add clean summary notes.');
    expect(finalContent).toContain('**Decisions:** Keep markdown native.');
    expect(finalContent).toContain('status: done');
    expect(fs.existsSync(path.join(root, '.meetings', 'meeting-1', 'transcript.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.meetings', 'meeting-1', 'transcript.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.meetings', 'meeting-1', 'speakers.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.meetings', 'meeting-1', 'audio.wav'))).toBe(true);
    const speakers = JSON.parse(fs.readFileSync(path.join(root, '.meetings', 'meeting-1', 'speakers.json'), 'utf-8'));
    expect(speakers).toMatchObject({
      meetingId: 'meeting-1',
      source: 'transcript-label',
      speakers: [
        { id: 'spk_1', label: 'Alice', source: 'transcript-label' },
        { id: 'spk_2', label: 'Bob', source: 'transcript-label' },
      ],
    });
    const rawTranscript = fs.readFileSync(path.join(root, '.meetings', 'meeting-1', 'transcript.jsonl'), 'utf-8');
    expect(rawTranscript).toContain('"speaker_id":"spk_1"');
    expect(rawTranscript).toContain('"speaker_id":"spk_2"');
    expect(progressEvents).toContainEqual(expect.objectContaining({
      kind: 'file_change',
      message: 'Meeting summary done',
      phase: 'done',
      filePath: context.filePath,
    }));
  });

  it('streams durable transcript deltas to one Ambient task and reconciles diarization on stop', async () => {
    const ambient = {
      start: vi.fn(async () => ({ threadId: 'ambient-thread-1' })),
      enqueueTranscript: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      stop: vi.fn(),
      getState: vi.fn(() => null),
    };
    const diarizer = {
      diarize: vi.fn(async () => ({
        speakerCount: 2,
        segments: [
          { speakerId: 'SPEAKER_26', startMs: 0, endMs: 900 },
          { speakerId: 'SPEAKER_4', startMs: 1_000, endMs: 1_900 },
        ],
      })),
    };
    const { manager, root, audioPath, transcriber } = makeManager({
      ambient: ambient as never,
      diarizer: diarizer as never,
    });
    transcriber.stopMeetingCapture.mockResolvedValueOnce({
      startedAt: '2026-05-14T20:00:00.000Z',
      stoppedAt: '2026-05-14T20:03:00.000Z',
      source: 'microphone',
      transcriptionEngine: 'parakeet',
      speakerDiarizationSupported: false,
      transcriptText: 'We should inspect the API. I can pull the current schema.',
      transcriptEntries: [
        { sequence: 1, startMs: 0, endMs: 900, text: 'We should inspect the API.' },
        { sequence: 2, startMs: 1_000, endMs: 1_900, text: 'I can pull the current schema.' },
      ],
      audioPath,
    });
    const created = await manager.createMeetingNote('API Review');
    const context = contextFromResult(created);

    const started = await manager.startHere(context);

    expect(started.success).toBe(true);
    expect(ambient.start).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      title: 'API Review',
      workingDirectory: path.join(root, '.meetings', 'meeting-1'),
    });
    expect(ambient.start.mock.invocationCallOrder[0]).toBeLessThan(
      transcriber.startMeetingCapture.mock.invocationCallOrder[0],
    );
    const captureOptions = (transcriber.startMeetingCapture.mock.calls[0] as unknown as [
      { onTranscript?: (entry: { sequence: number; startMs: number; endMs: number; text: string }) => void },
    ])[0];
    captureOptions.onTranscript?.({
      sequence: 1,
      startMs: 0,
      endMs: 900,
      text: 'We should inspect the API.',
    });
    expect(ambient.enqueueTranscript).toHaveBeenCalledWith({
      sequence: 1,
      startMs: 0,
      endMs: 900,
      text: 'We should inspect the API.',
    });

    const stopped = await manager.stopActiveMeeting();

    expect(stopped.success).toBe(true);
    expect(diarizer.diarize).toHaveBeenCalledWith(audioPath);
    expect(ambient.enqueueTranscript).toHaveBeenLastCalledWith({
      sequence: 3,
      startMs: 0,
      endMs: 1_900,
      text: [
        'Final stable transcript with reconciled speaker labels:',
        '[0:00] Speaker 1: We should inspect the API.',
        '[0:01] Speaker 2: I can pull the current schema.',
      ].join('\n'),
    });
    expect(ambient.flush).toHaveBeenLastCalledWith(true);
    expect(ambient.stop).toHaveBeenCalledOnce();

    const note = fs.readFileSync(context.filePath, 'utf-8');
    expect(note).toContain('ambient_thread_id: ambient-thread-1');
    expect(note).toContain('diarization_status: done');
    expect(note).toContain('**Speaker 1:** We should inspect the API.');
    expect(note).toContain('**Speaker 2:** I can pull the current schema.');
    expect(note).not.toContain('Speaker 26');
    const speakers = JSON.parse(fs.readFileSync(path.join(root, '.meetings', 'meeting-1', 'speakers.json'), 'utf-8'));
    expect(speakers).toMatchObject({
      source: 'fluid-audio-community-1',
      speakers: [
        { id: 'spk_1', label: 'Speaker 1', source: 'fluid-audio-community-1' },
        { id: 'spk_2', label: 'Speaker 2', source: 'fluid-audio-community-1' },
      ],
    });
  });

  it('flushes live Ambient transcript updates every 30 seconds', async () => {
    vi.useFakeTimers();
    const ambient = {
      start: vi.fn(async () => ({ threadId: 'ambient-thread-1' })),
      enqueueTranscript: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      stop: vi.fn(),
      getState: vi.fn(() => null),
    };
    const { manager, transcriber } = makeManager({ ambient: ambient as never });

    try {
      const created = await manager.createMeetingNote('Live Cadence');
      await manager.startHere(contextFromResult(created));
      const captureOptions = (transcriber.startMeetingCapture.mock.calls[0] as unknown as [
        { onTranscript?: (entry: { sequence: number; startMs: number; endMs: number; text: string }) => void },
      ])[0];
      captureOptions.onTranscript?.({ sequence: 1, startMs: 0, endMs: 10_000, text: 'Live update.' });

      await vi.advanceTimersByTimeAsync(29_999);
      expect(ambient.flush).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(ambient.flush).toHaveBeenCalledOnce();
      expect(ambient.flush).toHaveBeenCalledWith();
      await manager.cancelActiveMeeting();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps meeting speaker labels beyond Speaker 2 in the note and raw sidecar', async () => {
    const { manager, root, audioPath, transcriber, localLlm } = makeManager();
    transcriber.stopMeetingCapture.mockResolvedValueOnce({
      startedAt: '2026-05-14T20:00:00.000Z',
      stoppedAt: '2026-05-14T20:03:00.000Z',
      source: 'microphone',
      transcriptionEngine: 'whisper',
      speakerDiarizationSupported: true,
      transcriptText: [
        'Speaker 1: First person opens.',
        'Speaker 2: Second person responds.',
        'Speaker 3: Third person joins.',
      ].join('\n'),
      audioPath,
    });
    localLlm.runReplacementCommand.mockImplementationOnce(async ({ targetContent }: { targetContent: string }) => {
      expect(fs.existsSync(path.join(root, '.meetings', 'meeting-1', 'speakers.json'))).toBe(true);
      return replaceMeetingSummary(targetContent, '**Decisions:** Keep speaker identity stable.');
    });
    const created = await manager.createMeetingNote('Multi Speaker');
    const context = contextFromResult(created);

    await manager.startHere(context);
    const result = await manager.stopActiveMeeting();

    expect(result.success).toBe(true);
    const finalContent = fs.readFileSync(context.filePath, 'utf-8');
    expect(finalContent).toContain('<!-- speaker_id: spk_1 -->\n**Speaker 1:** First person opens.');
    expect(finalContent).toContain('<!-- speaker_id: spk_2 -->\n**Speaker 2:** Second person responds.');
    expect(finalContent).toContain('<!-- speaker_id: spk_3 -->\n**Speaker 3:** Third person joins.');
    expect(finalContent).toContain('**Speaker 1:** First person opens.');
    expect(finalContent).toContain('**Speaker 2:** Second person responds.');
    expect(finalContent).toContain('**Speaker 3:** Third person joins.');
    const speakers = JSON.parse(fs.readFileSync(path.join(root, '.meetings', 'meeting-1', 'speakers.json'), 'utf-8'));
    expect(speakers).toMatchObject({
      source: 'turn-marker',
      speakers: [
        { id: 'spk_1', label: 'Speaker 1', source: 'turn-marker' },
        { id: 'spk_2', label: 'Speaker 2', source: 'turn-marker' },
        { id: 'spk_3', label: 'Speaker 3', source: 'turn-marker' },
      ],
    });
    const rawTranscript = fs.readFileSync(path.join(root, '.meetings', 'meeting-1', 'transcript.jsonl'), 'utf-8');
    expect(rawTranscript).toContain('"speaker_id":"spk_3"');
    expect(rawTranscript).toContain('"speaker":"Speaker 3"');
    expect(rawTranscript).toContain('"text":"Third person joins."');
  });

  it('re-reads the file after Maxwell runs so notes typed during summary survive', async () => {
    const root = makeTempDir();
    const librarian = makeLibrarian(root);
    const maxwellRuns = {
      createPendingRun: vi.fn(() => ({ runId: 'run-1' })),
      appendProgressEvent: vi.fn(),
      markGenerated: vi.fn(),
      markSuccess: vi.fn(),
      markError: vi.fn(),
    };
    const localLlm = {
      getSelectedModel: vi.fn(() => 'gemma-4-E4B-it-Q4_K_M' as const),
      getHarness: vi.fn(() => 'direct' as const),
      runReplacementCommand: vi.fn(async ({ targetContent }: { targetContent: string }) => {
        const filePath = path.join(root, 'Meetings', 'Summary.md');
        const latest = fs.readFileSync(filePath, 'utf-8')
          .replace('## Notes\n\n', '## Notes\n\n- typed during summary\n\n');
        fs.writeFileSync(filePath, latest, 'utf-8');
        return replaceMeetingSummary(targetContent, '**Decisions:** Preserve live edits.');
      }),
    };
    const manager = new MeetingManager({
      librarian,
      transcriber: {
        startMeetingCapture: vi.fn(),
        stopMeetingCapture: vi.fn(),
        cancelMeetingCapture: vi.fn(),
      },
      localLlm,
      getMeetingSummaryPrompt: () => 'Custom meeting prompt.',
      getMaxwellRunManager: () => maxwellRuns as never,
      now: () => new Date('2026-05-14T20:00:00.000Z'),
      idFactory: () => 'meeting-1',
    });
    const created = await manager.createMeetingNote('Summary');
    const context = contextFromResult(created);

    const result = await manager.summarizeCurrentMeeting(context);

    expect(result.success).toBe(true);
    const finalContent = fs.readFileSync(context.filePath, 'utf-8');
    expect(finalContent).toContain('- typed during summary');
    expect(finalContent).toContain('**Decisions:** Preserve live edits.');
    expect(maxwellRuns.createPendingRun).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'summarize-meeting',
      commandContent: expect.stringContaining('Custom meeting prompt.'),
      targetPath: context.filePath,
    }));
    expect(maxwellRuns.createPendingRun).toHaveBeenCalledWith(expect.objectContaining({
      commandContent: expect.stringContaining('Speaker identity contract:'),
    }));
    expect(maxwellRuns.markSuccess).toHaveBeenCalledWith('run-1', expect.objectContaining({
      summary: 'Updated meeting summary',
    }));
  });

  it('does not mutate a non-meeting document when summarizing the current file', async () => {
    const { manager, root, localLlm } = makeManager();
    const filePath = path.join(root, 'Plain.md');
    const content = '# Plain\n\nThis is not a meeting.\n';
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = await manager.summarizeCurrentMeeting({
      type: 'wiki',
      relPath: 'Plain',
      filePath,
      title: 'Plain',
    });

    expect(result).toMatchObject({
      success: false,
      error: 'Selected document is not a meeting note',
    });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
    expect(localLlm.runReplacementCommand).not.toHaveBeenCalled();
  });

  it('emits error summary progress when Gemma summary generation fails', async () => {
    const { manager, localLlm } = makeManager();
    const progressEvents: Array<Record<string, unknown>> = [];
    manager.on('summary-progress', (event) => progressEvents.push(event));
    localLlm.runReplacementCommand.mockRejectedValueOnce(new Error('Gemma failed'));
    const created = await manager.createMeetingNote('Broken Summary');
    const context = contextFromResult(created);

    const result = await manager.summarizeCurrentMeeting(context);

    expect(result).toMatchObject({
      success: false,
      error: 'Gemma failed',
      summaryError: 'Gemma failed',
    });
    expect(fs.readFileSync(context.filePath, 'utf-8')).toContain('status: error');
    expect(progressEvents).toContainEqual(expect.objectContaining({
      kind: 'error',
      message: 'Gemma failed',
      phase: 'error',
      filePath: context.filePath,
    }));
  });
});
