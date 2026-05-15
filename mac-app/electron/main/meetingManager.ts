import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  appendMeetingTranscript,
  createMeetingMarkdown,
  DEFAULT_MEETING_STT_ENGINE,
  DEFAULT_MEETING_SUMMARY_MODEL,
  getMeetingSidecarPaths,
  isMeetingDocument,
  parseMeetingFrontmatter,
  renderMeetingRawTranscriptWikiLink,
  replaceMeetingSummary,
  setMeetingFrontmatter,
  setMeetingStatus,
  type MeetingTranscriptEntry,
} from '../shared/meetingMarkdown';
import { type DocumentSaveResult, type DocumentVersion, readDocumentVersion, writeTextFileWithConflictGuard } from './documentSaveGuard';
import type { LocalLlmManager, LocalLlmProgressEvent } from './localLlmManager';
import type { MaxwellRunManager } from './maxwellRunManager';
import type { MeetingCaptureResult, MeetingCaptureSession, TranscriberManager } from './transcriberManager';

export type MeetingStatus = 'idle' | 'starting' | 'recording' | 'transcribing' | 'summarizing' | 'done' | 'cancelled' | 'error';

export type MeetingFileContext = {
  type: 'wiki' | 'external';
  rootPath?: string;
  relPath: string;
  filePath: string;
  title: string;
};

export type MeetingOpenTarget = {
  kind: 'wiki' | 'external';
  path: string;
  contentMode: 'markdown';
  selectionStart: number;
  selectionEnd: number;
};

export type MeetingSession = {
  meetingId: string;
  title: string;
  type: 'wiki' | 'external';
  filePath: string;
  relPath: string | null;
  startedAt: string;
  endedAt: string | null;
  status: MeetingStatus;
  audioPath: string | null;
  transcriptPath: string | null;
  rawTranscriptPath: string | null;
  speakerDiarizationSupported: boolean;
  summaryRunId?: string;
  summaryError?: string;
};

export type MeetingActionResult = {
  success: boolean;
  error?: string;
  session?: MeetingSession;
  openTarget?: MeetingOpenTarget;
  summaryRunId?: string;
  summaryError?: string;
};

type MeetingWikiPage = {
  relPath: string;
  absPath: string;
  title: string;
  content: string;
  documentVersion: DocumentVersion;
};

type MeetingLibrarian = {
  createWikiFileWithTitle(folderName: string, title: string): MeetingWikiPage | null;
  getWikiPage(relPath: string): MeetingWikiPage | null;
  saveWikiPage(relPath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult;
  getWikiRoot(): string;
  emit(eventName: 'wiki:changed' | 'library:changed', rootPath?: string): boolean;
};

type MeetingTranscriber = Pick<TranscriberManager, 'startMeetingCapture' | 'stopMeetingCapture' | 'cancelMeetingCapture'>;
type MeetingLocalLlm = Pick<LocalLlmManager, 'runReplacementCommand' | 'getSelectedModel' | 'getHarness'>;

export type MeetingManagerOptions = {
  librarian: MeetingLibrarian;
  transcriber: MeetingTranscriber;
  localLlm: MeetingLocalLlm;
  getMeetingSummaryPrompt: () => string;
  getMaxwellRunManager?: () => MaxwellRunManager;
  readMemorySnapshot?: () => string | null;
  canWrite?: () => boolean;
  onBlockedWrite?: () => void;
  now?: () => Date;
  idFactory?: () => string;
};

type ReadTargetResult = {
  content: string;
  version: DocumentVersion;
};

type MeetingSidecarWriteResult = {
  audioPath: string | null;
  transcriptPath: string;
  rawTranscriptPath: string;
};

type PreparedMeetingTarget =
  | {
      success: true;
      target: MeetingFileContext;
      meetingId: string;
      openTarget: MeetingOpenTarget;
    }
  | {
      success: false;
      error: string;
    };

function localIsoDateParts(date: Date): { date: string; time: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}.${pad(date.getMinutes())}`,
  };
}

function defaultMeetingTitle(date: Date): string {
  const parts = localIsoDateParts(date);
  return `Meeting ${parts.date} ${parts.time}`;
}

function titleFromContext(context: MeetingFileContext): string {
  return context.title?.trim() || path.basename(context.filePath, path.extname(context.filePath)) || 'Meeting';
}

function notesSelectionStart(content: string): number {
  const match = content.match(/^##[ \t]+Notes[ \t]*$/m);
  if (!match || match.index === undefined) return content.length;
  let offset = match.index + match[0].length;
  if (content.slice(offset, offset + 2) === '\r\n') offset += 2;
  else if (content[offset] === '\n') offset += 1;
  if (content.slice(offset, offset + 2) === '\r\n') offset += 2;
  else if (content[offset] === '\n') offset += 1;
  return offset;
}

function openTargetFor(target: MeetingFileContext, content: string): MeetingOpenTarget {
  const selectionStart = notesSelectionStart(content);
  return {
    kind: target.type,
    path: target.type === 'wiki' ? target.relPath : target.filePath,
    contentMode: 'markdown',
    selectionStart,
    selectionEnd: selectionStart,
  };
}

function extractMarkdownSection(content: string, heading: string): string | null {
  const headingPattern = /^##[ \t]+(.+?)[ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(content))) {
    if (match[1].trim().toLowerCase() !== heading.toLowerCase()) continue;
    let contentStart = match.index + match[0].length;
    if (content.slice(contentStart, contentStart + 2) === '\r\n') contentStart += 2;
    else if (content[contentStart] === '\n') contentStart += 1;

    const nextHeadingPattern = /^##[ \t]+.+?[ \t]*$/gm;
    nextHeadingPattern.lastIndex = contentStart;
    const nextHeading = nextHeadingPattern.exec(content);
    const end = nextHeading?.index ?? content.length;
    return content.slice(contentStart, end).trim();
  }
  return null;
}

function transcriptEntriesFromText(text: string): MeetingTranscriptEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const entries: MeetingTranscriptEntry[] = [];
  const looseLines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of looseLines) {
    const speakerMatch = line.match(/^([A-Za-z][A-Za-z0-9 _.-]{0,39}|Speaker\s+\d+):\s+(.+)$/i);
    if (speakerMatch) {
      entries.push({ speaker: speakerMatch[1].trim(), text: speakerMatch[2].trim() });
    }
  }

  return entries.length > 0 ? entries : [{ text: trimmed }];
}

function jsonLine(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`;
}

export class MeetingManager extends EventEmitter {
  private activeSession: MeetingSession | null = null;

  constructor(private readonly options: MeetingManagerOptions) {
    super();
  }

  getActiveSession(): MeetingSession | null {
    return this.activeSession ? { ...this.activeSession } : null;
  }

  async createMeetingNote(title?: string): Promise<MeetingActionResult> {
    const writeCheck = this.ensureWritable();
    if (!writeCheck.success) return writeCheck;

    const createdAtDate = this.now();
    const baseTitle = title?.trim() || defaultMeetingTitle(createdAtDate);
    const meetingId = this.newMeetingId();
    const createdAt = createdAtDate.toISOString();
    const summaryModel = this.options.localLlm.getSelectedModel?.() ?? DEFAULT_MEETING_SUMMARY_MODEL;
    const content = createMeetingMarkdown({
      title: baseTitle,
      meetingId,
      createdAt,
      status: 'draft',
      sttEngine: DEFAULT_MEETING_STT_ENGINE,
      summaryModel,
    });
    const page = this.createUniqueWikiMeetingPage(baseTitle);
    if (!page) return { success: false, error: 'Could not create meeting note' };

    const saveResult = this.options.librarian.saveWikiPage(page.relPath, content, page.documentVersion);
    if (!saveResult.ok) return { success: false, error: `Could not seed meeting note: ${saveResult.reason}` };

    const target: MeetingFileContext = {
      type: 'wiki',
      relPath: page.relPath,
      filePath: page.absPath,
      title: baseTitle,
      rootPath: this.options.librarian.getWikiRoot(),
    };
    const session = this.buildSession(target, meetingId, {
      startedAt: '',
      status: 'idle',
    });
    const openTarget = openTargetFor(target, content);
    this.emitStatus(session);
    return { success: true, session, openTarget };
  }

  async startHere(context?: MeetingFileContext | null): Promise<MeetingActionResult> {
    if (this.activeSession) {
      return { success: false, error: 'A meeting is already recording', session: this.getActiveSession() ?? undefined };
    }
    const writeCheck = this.ensureWritable();
    if (!writeCheck.success) return writeCheck;

    const target = context && fs.existsSync(context.filePath) ? context : null;
    const resolved = target
      ? await this.prepareTargetForMeeting(target, 'starting')
      : await this.createAndPrepareTargetForMeeting();
    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }

    let capture: MeetingCaptureSession;
    try {
      capture = await this.options.transcriber.startMeetingCapture();
    } catch (error) {
      await this.markTargetError(resolved.target);
      return { success: false, error: error instanceof Error ? error.message : 'Could not start meeting capture' };
    }

    try {
      const started = await this.updateLatestTarget(resolved.target, (content) => setMeetingFrontmatter(content, {
        status: 'recording',
        startedAt: capture.startedAt,
        sttEngine: capture.transcriptionEngine,
        summaryModel: this.options.localLlm.getSelectedModel?.() ?? DEFAULT_MEETING_SUMMARY_MODEL,
      }));
      const session = this.buildSession(resolved.target, resolved.meetingId, {
        startedAt: capture.startedAt,
        status: 'recording',
        speakerDiarizationSupported: capture.speakerDiarizationSupported,
      });
      this.activeSession = session;
      this.emitStatus(session);
      return { success: true, session: { ...session }, openTarget: openTargetFor(resolved.target, started.content) };
    } catch (error) {
      await this.options.transcriber.cancelMeetingCapture().catch(() => {});
      return { success: false, error: error instanceof Error ? error.message : 'Could not bind recording to meeting note' };
    }
  }

  async stopActiveMeeting(): Promise<MeetingActionResult> {
    const active = this.activeSession;
    if (!active) return { success: false, error: 'No meeting is recording' };
    const writeCheck = this.ensureWritable();
    if (!writeCheck.success) return writeCheck;

    const target = this.targetFromSession(active);
    this.setActiveStatus('transcribing');

    let capture: MeetingCaptureResult;
    try {
      capture = await this.options.transcriber.stopMeetingCapture();
    } catch (error) {
      this.setActiveStatus('error');
      return { success: false, error: error instanceof Error ? error.message : 'Could not stop meeting capture', session: this.getActiveSession() ?? undefined };
    }

    let sidecars: MeetingSidecarWriteResult;
    try {
      sidecars = this.writeSidecars(active.meetingId, target, capture);
      const entries = transcriptEntriesFromText(capture.transcriptText);
      const rawLink = `Raw transcript: ${renderMeetingRawTranscriptWikiLink(sidecars.transcriptPath)}`;
      const transcriptInput = entries.length > 0 ? [rawLink, ...entries] : [rawLink, '(No transcript text returned.)'];
      const updated = await this.updateLatestTarget(target, (content) => {
        const withTranscript = appendMeetingTranscript(content, transcriptInput);
        return setMeetingFrontmatter(withTranscript, {
          status: 'transcribing',
          endedAt: capture.stoppedAt,
          sttEngine: capture.transcriptionEngine,
          transcriptPath: sidecars.transcriptPath,
          rawTranscriptPath: sidecars.rawTranscriptPath,
          audioPath: sidecars.audioPath ?? active.audioPath,
        });
      });
      this.activeSession = {
        ...active,
        endedAt: capture.stoppedAt,
        status: 'transcribing',
        audioPath: sidecars.audioPath,
        transcriptPath: sidecars.transcriptPath,
        rawTranscriptPath: sidecars.rawTranscriptPath,
        speakerDiarizationSupported: capture.speakerDiarizationSupported,
      };
      this.emitStatus(this.activeSession);
      const summary = await this.summarizeTarget(target);
      const doneSession = {
        ...this.activeSession,
        status: summary.success ? 'done' as const : 'error' as const,
        summaryRunId: summary.summaryRunId,
        summaryError: summary.summaryError ?? summary.error,
      };
      this.activeSession = null;
      this.emitStatus(doneSession);
      return {
        success: summary.success,
        error: summary.error,
        summaryError: summary.summaryError,
        summaryRunId: summary.summaryRunId,
        session: doneSession,
        openTarget: openTargetFor(target, updated.content),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not finalize meeting note';
      const errored = { ...active, endedAt: capture.stoppedAt, status: 'error' as const, summaryError: message };
      this.activeSession = null;
      this.emitStatus(errored);
      return { success: false, error: message, session: errored };
    }
  }

  async summarizeCurrentMeeting(context?: MeetingFileContext | null): Promise<MeetingActionResult> {
    const target = this.activeSession ? this.targetFromSession(this.activeSession) : context;
    if (!target || !fs.existsSync(target.filePath)) {
      return { success: false, error: 'No meeting note is selected' };
    }
    return this.summarizeTarget(target);
  }

  async cancelActiveMeeting(): Promise<MeetingActionResult> {
    const active = this.activeSession;
    if (!active) return { success: false, error: 'No meeting is recording' };
    try {
      await this.options.transcriber.cancelMeetingCapture();
      const target = this.targetFromSession(active);
      await this.updateLatestTarget(target, (content) => setMeetingStatus(content, 'cancelled', {
        endedAt: this.now().toISOString(),
      }));
      const cancelled = { ...active, endedAt: this.now().toISOString(), status: 'cancelled' as const };
      this.activeSession = null;
      this.emitStatus(cancelled);
      return { success: true, session: cancelled };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Could not cancel meeting', session: active };
    }
  }

  private async summarizeTarget(target: MeetingFileContext): Promise<MeetingActionResult> {
    const writeCheck = this.ensureWritable();
    if (!writeCheck.success) return writeCheck;

    let runId: string | undefined;
    let maxwellRuns: MaxwellRunManager | null = null;
    try {
      const current = this.readTarget(target);
      if (!isMeetingDocument(current.content)) {
        return { success: false, error: 'Selected document is not a meeting note' };
      }

      this.setActiveStatus('summarizing');
      const statusContent = await this.updateLatestTarget(target, (content) => setMeetingStatus(content, 'summarizing'));

      const localLlm = this.options.localLlm;
      const prompt = this.options.getMeetingSummaryPrompt();
      const memorySnapshot = this.options.readMemorySnapshot?.() ?? null;
      const preVersion = readDocumentVersion(target.filePath);
      maxwellRuns = this.options.getMaxwellRunManager?.() ?? null;
      if (maxwellRuns) {
        const run = maxwellRuns.createPendingRun({
          commandName: 'summarize-meeting',
          commandPath: null,
          commandContent: prompt,
          targetPath: target.filePath,
          targetRelPath: target.type === 'wiki' ? target.relPath : null,
          targetType: target.type === 'wiki' ? 'wiki' : 'reading',
          mode: 'document',
          preContent: statusContent.content,
          preVersion,
          model: localLlm.getSelectedModel?.() ?? null,
          harness: localLlm.getHarness?.() ?? null,
          memorySnapshot,
        });
        runId = run.runId;
      }

      const replacement = await localLlm.runReplacementCommand({
        commandName: 'summarize-meeting',
        commandContent: prompt,
        targetTitle: titleFromContext(target),
        targetPath: target.filePath,
        targetContent: statusContent.content,
        memorySnapshot,
      }, {
        onProgress: (event: LocalLlmProgressEvent) => {
          if (runId) maxwellRuns?.appendProgressEvent(runId, event);
          this.emit('summary-progress', { ...event, filePath: target.filePath, runId });
        },
      });

      const generatedSummary = extractMarkdownSection(replacement, 'Summary');
      if (generatedSummary === null) {
        throw new Error('Meeting summary did not include a Summary section.');
      }

      const saved = await this.updateLatestTarget(target, (latestContent) => {
        const withSummary = replaceMeetingSummary(latestContent, generatedSummary);
        return setMeetingStatus(withSummary, 'done');
      });
      if (runId) {
        maxwellRuns?.markGenerated(runId, saved.content);
        maxwellRuns?.markSuccess(runId, {
          generatedContent: saved.content,
          postContent: saved.content,
          postVersion: saved.version,
          summary: 'Updated meeting summary',
          timings: {},
        });
      }
      const parsed = parseMeetingFrontmatter(saved.content);
      const session = this.buildSession(target, parsed.meeting.meetingId ?? this.newMeetingId(), {
        startedAt: parsed.meeting.startedAt ?? '',
        endedAt: parsed.meeting.endedAt ?? null,
        status: 'done',
        audioPath: parsed.meeting.audioPath ?? null,
        transcriptPath: parsed.meeting.transcriptPath ?? null,
        rawTranscriptPath: parsed.meeting.rawTranscriptPath ?? null,
        summaryRunId: runId,
      });
      this.emit('summary-progress', {
        kind: 'file_change',
        message: 'Meeting summary done',
        detail: titleFromContext(target),
        phase: 'done',
        filePath: target.filePath,
        runId,
      });
      return { success: true, session, summaryRunId: runId, openTarget: openTargetFor(target, saved.content) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not summarize meeting';
      if (runId) maxwellRuns?.markError(runId, 'generation_error', message);
      await this.updateLatestTarget(target, (content) => setMeetingStatus(content, 'error')).catch(() => {});
      this.emit('summary-progress', {
        kind: 'error',
        message,
        phase: 'error',
        filePath: target.filePath,
        runId,
      });
      return { success: false, error: message, summaryError: message, summaryRunId: runId };
    }
  }

  private async createAndPrepareTargetForMeeting(): Promise<PreparedMeetingTarget> {
    const created = await this.createMeetingNote();
    if (!created.success || !created.session) {
      return { success: false, error: created.error ?? 'Could not create meeting note' };
    }
    const target = this.targetFromSession(created.session);
    const prepared = await this.prepareTargetForMeeting(target, 'starting');
    if (!prepared.success) return prepared;
    return { ...prepared, openTarget: created.openTarget ?? prepared.openTarget };
  }

  private async prepareTargetForMeeting(target: MeetingFileContext, status: MeetingStatus): Promise<PreparedMeetingTarget> {
    const current = this.readTarget(target);
    const parsed = parseMeetingFrontmatter(current.content);
    const meetingId = parsed.meeting.meetingId || this.newMeetingId();
    const sidecars = getMeetingSidecarPaths(meetingId);
    const createdAt = parsed.meeting.createdAt || this.now().toISOString();
    const nextContent = setMeetingFrontmatter(current.content, {
      kind: 'meeting',
      section: 'meetings',
      meetingId,
      createdAt,
      status,
      sttEngine: parsed.meeting.sttEngine || DEFAULT_MEETING_STT_ENGINE,
      summaryModel: parsed.meeting.summaryModel || this.options.localLlm.getSelectedModel?.() || DEFAULT_MEETING_SUMMARY_MODEL,
      transcriptPath: parsed.meeting.transcriptPath || sidecars.transcriptPath,
      rawTranscriptPath: parsed.meeting.rawTranscriptPath || sidecars.rawTranscriptPath,
      audioPath: parsed.meeting.audioPath || sidecars.audioPath,
    });
    const saveResult = this.saveTarget(target, nextContent, current.version);
    if (!saveResult.ok) return { success: false, error: `Could not prepare meeting note: ${saveResult.reason}` };
    return { success: true, target, meetingId, openTarget: openTargetFor(target, nextContent) };
  }

  private writeSidecars(meetingId: string, target: MeetingFileContext, capture: MeetingCaptureResult): MeetingSidecarWriteResult {
    const sidecars = getMeetingSidecarPaths(meetingId);
    const sidecarDir = path.join(this.options.librarian.getWikiRoot(), '.meetings', meetingId);
    fs.mkdirSync(sidecarDir, { recursive: true });

    const entries = transcriptEntriesFromText(capture.transcriptText);
    const transcriptMarkdown = [
      '# Raw Transcript',
      '',
      `Meeting: [[${target.type === 'wiki' ? target.relPath : target.filePath}|${titleFromContext(target)}]]`,
      `Stopped: ${capture.stoppedAt}`,
      `Engine: ${capture.transcriptionEngine}`,
      `Speaker diarization: ${capture.speakerDiarizationSupported ? 'supported' : 'not available'}`,
      '',
      '## Transcript',
      '',
      entries.length > 0
        ? entries.map(entry => entry.speaker ? `**${entry.speaker}:** ${entry.text}` : entry.text).join('\n\n')
        : '(No transcript text returned.)',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(sidecarDir, 'transcript.md'), transcriptMarkdown, 'utf-8');

    const rawLines = [
      jsonLine({
        type: 'metadata',
        meetingId,
        meetingPath: target.type === 'wiki' ? target.relPath : target.filePath,
        stoppedAt: capture.stoppedAt,
        transcriptionEngine: capture.transcriptionEngine,
        speakerDiarizationSupported: capture.speakerDiarizationSupported,
        source: capture.source,
      }),
      ...entries.map((entry, index) => jsonLine({
        type: 'transcript_entry',
        index,
        speaker: entry.speaker ?? null,
        text: entry.text,
      })),
    ].join('');
    fs.writeFileSync(path.join(sidecarDir, 'transcript.jsonl'), rawLines, 'utf-8');

    let audioPath: string | null = null;
    if (capture.audioPath && fs.existsSync(capture.audioPath)) {
      const audioDest = path.join(sidecarDir, 'audio.wav');
      if (path.resolve(capture.audioPath) !== path.resolve(audioDest)) {
        fs.copyFileSync(capture.audioPath, audioDest);
      }
      audioPath = sidecars.audioPath;
    }

    this.options.librarian.emit('wiki:changed');
    return {
      audioPath,
      transcriptPath: sidecars.transcriptPath,
      rawTranscriptPath: sidecars.rawTranscriptPath,
    };
  }

  private async updateLatestTarget(
    target: MeetingFileContext,
    transform: (content: string) => string,
  ): Promise<ReadTargetResult> {
    const current = this.readTarget(target);
    const nextContent = transform(current.content);
    const result = this.saveTarget(target, nextContent, current.version);
    if (!result.ok) {
      throw new Error(`Could not save meeting note: ${result.reason}`);
    }
    return { content: nextContent, version: result.version };
  }

  private readTarget(target: MeetingFileContext): ReadTargetResult {
    return {
      content: fs.readFileSync(target.filePath, 'utf-8'),
      version: readDocumentVersion(target.filePath),
    };
  }

  private saveTarget(target: MeetingFileContext, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult {
    if (target.type === 'wiki') {
      return this.options.librarian.saveWikiPage(target.relPath, content, expectedVersion);
    }
    return writeTextFileWithConflictGuard(target.filePath, content, expectedVersion);
  }

  private createUniqueWikiMeetingPage(baseTitle: string): MeetingWikiPage | null {
    for (let index = 0; index < 20; index += 1) {
      const title = index === 0 ? baseTitle : `${baseTitle} ${index + 1}`;
      const page = this.options.librarian.createWikiFileWithTitle('Meetings', title);
      if (page) return page;
    }
    return null;
  }

  private targetFromSession(session: MeetingSession): MeetingFileContext {
    return {
      type: session.type,
      relPath: session.relPath ?? '',
      filePath: session.filePath,
      title: session.title,
      rootPath: this.options.librarian.getWikiRoot(),
    };
  }

  private buildSession(
    target: MeetingFileContext,
    meetingId: string,
    updates: Partial<MeetingSession>,
  ): MeetingSession {
    return {
      meetingId,
      title: titleFromContext(target),
      type: target.type,
      relPath: target.type === 'wiki' ? target.relPath : null,
      filePath: target.filePath,
      startedAt: updates.startedAt ?? '',
      endedAt: updates.endedAt ?? null,
      status: updates.status ?? 'idle',
      audioPath: updates.audioPath ?? getMeetingSidecarPaths(meetingId).audioPath,
      transcriptPath: updates.transcriptPath ?? getMeetingSidecarPaths(meetingId).transcriptPath,
      rawTranscriptPath: updates.rawTranscriptPath ?? getMeetingSidecarPaths(meetingId).rawTranscriptPath,
      speakerDiarizationSupported: updates.speakerDiarizationSupported ?? false,
      summaryRunId: updates.summaryRunId,
      summaryError: updates.summaryError,
    };
  }

  private setActiveStatus(status: MeetingStatus): void {
    if (!this.activeSession) return;
    this.activeSession = { ...this.activeSession, status };
    this.emitStatus(this.activeSession);
  }

  private async markTargetError(target: MeetingFileContext): Promise<void> {
    await this.updateLatestTarget(target, (content) => setMeetingStatus(content, 'error')).catch(() => {});
  }

  private emitStatus(session: MeetingSession): void {
    this.emit('status', { ...session });
  }

  private ensureWritable(): MeetingActionResult {
    if (this.options.canWrite && !this.options.canWrite()) {
      this.options.onBlockedWrite?.();
      return { success: false, error: 'Field Theory is read-only' };
    }
    return { success: true };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private newMeetingId(): string {
    return this.options.idFactory?.() ?? crypto.randomUUID();
  }
}
