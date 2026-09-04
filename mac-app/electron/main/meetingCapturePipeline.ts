import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export type MeetingAudioChunkStatus = 'captured' | 'transcribing' | 'transcribed' | 'error';

export type MeetingAudioChunk = {
  sequence: number;
  fileName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: MeetingAudioChunkStatus;
  transcript?: string;
  transcriptSegments?: MeetingChunkTranscriptSegment[];
  attempts: number;
  error?: string;
};

export type MeetingChunkTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type MeetingChunkTranscription = {
  text: string;
  segments?: MeetingChunkTranscriptSegment[];
};

export type MeetingCaptureManifest = {
  version: 1;
  meetingId: string;
  createdAt: string;
  updatedAt: string;
  chunks: MeetingAudioChunk[];
};

export type MeetingCaptureTranscriptEntry = {
  sequence: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type MeetingCapturePipelineResult = {
  audioPath: string;
  transcriptText: string;
  entries: MeetingCaptureTranscriptEntry[];
  manifestPath: string;
};

export type MeetingCapturePipelineOptions = {
  meetingId: string;
  sidecarDir: string;
  transcribe: (filePath: string) => Promise<string | MeetingChunkTranscription>;
  now?: () => Date;
  retryDelayMs?: number;
};

function transcriptSegmentsForChunk(chunk: MeetingAudioChunk): MeetingChunkTranscriptSegment[] {
  if (chunk.transcriptSegments?.length) return chunk.transcriptSegments;
  const text = chunk.transcript?.trim();
  return text ? [{ startMs: chunk.startMs, endMs: chunk.endMs, text }] : [];
}

function transcriptEntriesForChunks(chunks: MeetingAudioChunk[]): MeetingCaptureTranscriptEntry[] {
  let sequence = 0;
  return chunks.flatMap(chunk => transcriptSegmentsForChunk(chunk).map(segment => ({
    sequence: ++sequence,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
  })));
}

function normalizeTranscription(
  transcription: string | MeetingChunkTranscription,
  chunk: MeetingAudioChunk,
): { text: string; segments: MeetingChunkTranscriptSegment[] } {
  const text = (typeof transcription === 'string' ? transcription : transcription.text).trim();
  const rawSegments = typeof transcription === 'string' ? [] : transcription.segments ?? [];
  const segments = rawSegments.flatMap((segment) => {
    const segmentText = segment.text.trim();
    const relativeStartMs = Math.max(0, Math.min(chunk.durationMs, segment.startMs));
    const relativeEndMs = Math.max(relativeStartMs, Math.min(chunk.durationMs, segment.endMs));
    if (!segmentText || relativeEndMs <= relativeStartMs) return [];
    return [{
      startMs: chunk.startMs + relativeStartMs,
      endMs: chunk.startMs + relativeEndMs,
      text: segmentText,
    }];
  });
  return {
    text,
    segments: segments.length > 0
      ? segments
      : (text ? [{ startMs: chunk.startMs, endMs: chunk.endMs, text }] : []),
  };
}

type WavDataRange = {
  header: Buffer;
  dataOffset: number;
  dataSize: number;
  format: Buffer;
};

function parseWav(filePath: string): WavDataRange {
  const fd = fs.openSync(filePath, 'r');
  try {
    const prefix = Buffer.alloc(12);
    if (fs.readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length
      || prefix.toString('ascii', 0, 4) !== 'RIFF'
      || prefix.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error(`Invalid WAV file: ${filePath}`);
    }

    let offset = 12;
    let format: Buffer | null = null;
    while (true) {
      const chunkHeader = Buffer.alloc(8);
      if (fs.readSync(fd, chunkHeader, 0, chunkHeader.length, offset) !== chunkHeader.length) break;
      const chunkId = chunkHeader.toString('ascii', 0, 4);
      const chunkSize = chunkHeader.readUInt32LE(4);
      const dataOffset = offset + 8;
      if (chunkId === 'fmt ') {
        format = Buffer.alloc(chunkSize);
        fs.readSync(fd, format, 0, chunkSize, dataOffset);
      }
      if (chunkId === 'data') {
        if (!format || format.length < 16) throw new Error(`WAV format chunk missing: ${filePath}`);
        return { header: prefix, dataOffset, dataSize: chunkSize, format };
      }
      offset = dataOffset + chunkSize + (chunkSize % 2);
    }
    throw new Error(`WAV data chunk missing: ${filePath}`);
  } finally {
    fs.closeSync(fd);
  }
}

function wavDurationMs(filePath: string): number {
  const wav = parseWav(filePath);
  const byteRate = wav.format.readUInt32LE(8);
  if (byteRate <= 0) throw new Error(`Invalid WAV byte rate: ${filePath}`);
  return Math.max(0, Math.round((wav.dataSize / byteRate) * 1000));
}

function moveFile(source: string, destination: string): void {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    fs.copyFileSync(source, destination);
    fs.unlinkSync(source);
  }
}

export function concatenateWavFiles(inputPaths: string[], outputPath: string): void {
  if (inputPaths.length === 0) throw new Error('No meeting audio chunks were captured.');
  const parsed = inputPaths.map(parseWav);
  const format = parsed[0].format;
  for (let index = 1; index < parsed.length; index += 1) {
    if (!parsed[index].format.equals(format)) {
      throw new Error(`Meeting audio format changed at chunk ${index + 1}.`);
    }
  }

  const dataSize = parsed.reduce((total, wav) => total + wav.dataSize, 0);
  const fmtPadding = format.length % 2;
  const dataPadding = dataSize % 2;
  const riffSize = 4 + 8 + format.length + fmtPadding + 8 + dataSize + dataPadding;
  const header = Buffer.alloc(12 + 8 + format.length + fmtPadding + 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(riffSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(format.length, 16);
  format.copy(header, 20);
  const dataHeaderOffset = 20 + format.length + fmtPadding;
  header.write('data', dataHeaderOffset, 'ascii');
  header.writeUInt32LE(dataSize, dataHeaderOffset + 4);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = fs.openSync(outputPath, 'w');
  try {
    fs.writeSync(output, header);
    const buffer = Buffer.alloc(1024 * 1024);
    for (let index = 0; index < inputPaths.length; index += 1) {
      const input = fs.openSync(inputPaths[index], 'r');
      try {
        let remaining = parsed[index].dataSize;
        let position = parsed[index].dataOffset;
        while (remaining > 0) {
          const read = fs.readSync(input, buffer, 0, Math.min(buffer.length, remaining), position);
          if (read <= 0) throw new Error(`Meeting audio chunk ended early: ${inputPaths[index]}`);
          fs.writeSync(output, buffer, 0, read);
          remaining -= read;
          position += read;
        }
      } finally {
        fs.closeSync(input);
      }
    }
    if (dataPadding) fs.writeSync(output, Buffer.from([0]));
  } finally {
    fs.closeSync(output);
  }
}

export class MeetingCapturePipeline extends EventEmitter {
  private readonly audioDir: string;
  private readonly manifestPath: string;
  private readonly now: () => Date;
  private readonly retryDelayMs: number;
  private manifest: MeetingCaptureManifest;
  private processing: Promise<void> = Promise.resolve();
  private failure: Error | null = null;

  constructor(private readonly options: MeetingCapturePipelineOptions) {
    super();
    this.audioDir = path.join(options.sidecarDir, 'audio');
    this.manifestPath = path.join(options.sidecarDir, 'capture.json');
    this.now = options.now ?? (() => new Date());
    this.retryDelayMs = options.retryDelayMs ?? 250;
    fs.mkdirSync(this.audioDir, { recursive: true });
    this.manifest = this.readManifest() ?? {
      version: 1,
      meetingId: options.meetingId,
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
      chunks: [],
    };
    this.persist();
  }

  acceptChunk(sourcePath: string): MeetingAudioChunk {
    const sequence = this.manifest.chunks.length + 1;
    const fileName = `${String(sequence).padStart(6, '0')}.wav`;
    const destination = path.join(this.audioDir, fileName);
    moveFile(sourcePath, destination);
    const durationMs = wavDurationMs(destination);
    const startMs = this.manifest.chunks.at(-1)?.endMs ?? 0;
    const chunk: MeetingAudioChunk = {
      sequence,
      fileName,
      startMs,
      endMs: startMs + durationMs,
      durationMs,
      status: 'captured',
      attempts: 0,
    };
    this.manifest.chunks.push(chunk);
    this.persist();
    this.queueTranscription(chunk);
    return { ...chunk };
  }

  resume(): void {
    for (const chunk of this.manifest.chunks) {
      if (chunk.status !== 'transcribed') this.queueTranscription(chunk);
    }
  }

  async finalize(finalTailPath?: string | null): Promise<MeetingCapturePipelineResult> {
    if (finalTailPath && fs.existsSync(finalTailPath)) this.acceptChunk(finalTailPath);
    await this.processing;
    if (this.failure) throw this.failure;

    const ordered = [...this.manifest.chunks].sort((left, right) => left.sequence - right.sequence);
    const audioPath = path.join(this.options.sidecarDir, 'audio.wav');
    concatenateWavFiles(ordered.map(chunk => path.join(this.audioDir, chunk.fileName)), audioPath);
    const entries = transcriptEntriesForChunks(ordered);
    return {
      audioPath,
      transcriptText: entries.map(entry => entry.text).join(' ').trim(),
      entries,
      manifestPath: this.manifestPath,
    };
  }

  getManifest(): MeetingCaptureManifest {
    return JSON.parse(JSON.stringify(this.manifest)) as MeetingCaptureManifest;
  }

  private queueTranscription(chunk: MeetingAudioChunk): void {
    this.processing = this.processing.then(async () => {
      const filePath = path.join(this.audioDir, chunk.fileName);
      chunk.status = 'transcribing';
      chunk.error = undefined;
      this.persist();
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        chunk.attempts += 1;
        try {
          const transcription = normalizeTranscription(await this.options.transcribe(filePath), chunk);
          chunk.transcript = transcription.text;
          chunk.transcriptSegments = transcription.segments;
          chunk.status = 'transcribed';
          chunk.error = undefined;
          this.persist();
          if (transcription.segments.length > 0) {
            const priorEntries = transcriptEntriesForChunks(
              this.manifest.chunks.filter(candidate => candidate.sequence < chunk.sequence),
            ).length;
            transcription.segments.forEach((segment, index) => {
              this.emit('transcript', {
                sequence: priorEntries + index + 1,
                startMs: segment.startMs,
                endMs: segment.endMs,
                text: segment.text,
              } satisfies MeetingCaptureTranscriptEntry);
            });
          }
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          chunk.status = 'error';
          chunk.error = lastError.message;
          this.persist();
          if (attempt < 2 && this.retryDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
          }
        }
      }
      this.failure = lastError ?? new Error(`Could not transcribe meeting audio chunk ${chunk.sequence}.`);
    });
  }

  private readManifest(): MeetingCaptureManifest | null {
    if (!fs.existsSync(this.manifestPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8')) as MeetingCaptureManifest;
    if (parsed.version !== 1 || parsed.meetingId !== this.options.meetingId || !Array.isArray(parsed.chunks)) {
      throw new Error(`Invalid meeting capture manifest: ${this.manifestPath}`);
    }
    return parsed;
  }

  private persist(): void {
    this.manifest.updatedAt = this.now().toISOString();
    const tempPath = `${this.manifestPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(this.manifest, null, 2)}\n`, 'utf-8');
    fs.renameSync(tempPath, this.manifestPath);
  }
}
