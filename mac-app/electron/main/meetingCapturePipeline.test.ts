import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { MeetingCapturePipeline, concatenateWavFiles } from './meetingCapturePipeline';

function writeFloatWav(filePath: string, durationMs: number, sampleRate = 16_000): void {
  const samples = Math.max(1, Math.round(sampleRate * durationMs / 1000));
  const dataSize = samples * 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buffer);
}

describe('MeetingCapturePipeline', () => {
  it('moves chunks durably before ASR, preserves order, and emits transcript entries', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-meeting-capture-'));
    const first = path.join(root, 'temporary-1.wav');
    const second = path.join(root, 'temporary-2.wav');
    writeFloatWav(first, 1_000);
    writeFloatWav(second, 2_000);
    const transcribe = vi.fn(async (filePath: string) => path.basename(filePath));
    const pipeline = new MeetingCapturePipeline({ meetingId: 'meeting-1', sidecarDir: path.join(root, 'sidecar'), transcribe });
    const entries: unknown[] = [];
    pipeline.on('transcript', entry => entries.push(entry));

    pipeline.acceptChunk(first);
    const result = await pipeline.finalize(second);

    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(false);
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(result.transcriptText).toBe('000001.wav 000002.wav');
    expect(entries).toEqual([
      { sequence: 1, startMs: 0, endMs: 1000, text: '000001.wav' },
      { sequence: 2, startMs: 1000, endMs: 3000, text: '000002.wav' },
    ]);
    expect(pipeline.getManifest().chunks.map(chunk => chunk.status)).toEqual(['transcribed', 'transcribed']);
    expect(fs.statSync(result.audioPath).size).toBe(44 + (16_000 * 3 * 4));
  });

  it('retries failed ASR without dropping the durable audio chunk', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-meeting-retry-'));
    const chunkPath = path.join(root, 'temporary.wav');
    writeFloatWav(chunkPath, 250);
    const transcribe = vi.fn()
      .mockRejectedValueOnce(new Error('runtime restarted'))
      .mockResolvedValueOnce('Recovered words');
    const pipeline = new MeetingCapturePipeline({
      meetingId: 'meeting-2',
      sidecarDir: path.join(root, 'sidecar'),
      transcribe,
      retryDelayMs: 0,
    });

    const result = await pipeline.finalize(chunkPath);

    expect(result.transcriptText).toBe('Recovered words');
    expect(pipeline.getManifest().chunks[0]).toMatchObject({ status: 'transcribed', attempts: 2 });
    expect(fs.existsSync(path.join(root, 'sidecar', 'audio', '000001.wav'))).toBe(true);
  });

  it('streams concatenation without changing the WAV format', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-meeting-wav-'));
    const first = path.join(root, '1.wav');
    const second = path.join(root, '2.wav');
    const output = path.join(root, 'joined.wav');
    writeFloatWav(first, 100);
    writeFloatWav(second, 150);

    concatenateWavFiles([first, second], output);

    const joined = fs.readFileSync(output);
    expect(joined.toString('ascii', 0, 4)).toBe('RIFF');
    expect(joined.readUInt32LE(40)).toBe(16_000 * 0.25 * 4);
  });
});
