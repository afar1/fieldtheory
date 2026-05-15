import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceMeetingSummary } from '../shared/meetingMarkdown';
import { type DocumentSaveResult, type DocumentVersion, readDocumentVersion, writeTextFileWithConflictGuard } from './documentSaveGuard';
import { MeetingManager, type MeetingFileContext } from './meetingManager';

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
    startMeetingCapture: vi.fn(async () => ({
      startedAt: '2026-05-14T20:00:00.000Z',
      source: 'microphone' as const,
      transcriptionEngine: 'parakeet' as const,
      speakerDiarizationSupported: false as const,
    })),
    stopMeetingCapture: vi.fn(async () => ({
      startedAt: '2026-05-14T20:00:00.000Z',
      stoppedAt: '2026-05-14T20:03:00.000Z',
      source: 'microphone' as const,
      transcriptionEngine: 'parakeet' as const,
      speakerDiarizationSupported: false as const,
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
      commandContent: 'Summarize only the Summary section.',
    }), expect.any(Object));

    const finalContent = fs.readFileSync(context.filePath, 'utf-8');
    expect(finalContent).toContain('- typed while talking');
    expect(finalContent).toContain('Raw transcript: [[.meetings/meeting-1/transcript|Raw transcript]]');
    expect(finalContent).toContain('**Alice:** Keep the markdown file as the source of truth.');
    expect(finalContent).toContain('**Bob:** Add clean summary notes.');
    expect(finalContent).toContain('**Decisions:** Keep markdown native.');
    expect(finalContent).toContain('status: done');
    expect(fs.existsSync(path.join(root, '.meetings', 'meeting-1', 'transcript.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.meetings', 'meeting-1', 'transcript.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.meetings', 'meeting-1', 'audio.wav'))).toBe(true);
    expect(progressEvents).toContainEqual(expect.objectContaining({
      kind: 'file_change',
      message: 'Meeting summary done',
      phase: 'done',
      filePath: context.filePath,
    }));
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
      commandContent: 'Custom meeting prompt.',
      targetPath: context.filePath,
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
