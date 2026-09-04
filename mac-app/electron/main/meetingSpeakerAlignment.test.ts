import { describe, expect, it } from 'vitest';
import { alignMeetingSpeakers } from './meetingSpeakerAlignment';

describe('alignMeetingSpeakers', () => {
  it('renumbers arbitrary diarizer clusters by first appearance', () => {
    const result = alignMeetingSpeakers([
      { text: 'First', startMs: 0, endMs: 900 },
      { text: 'Second', startMs: 1_000, endMs: 2_000 },
      { text: 'First again', startMs: 2_100, endMs: 3_000 },
    ], [
      { speakerId: 'SPEAKER_26', startMs: 0, endMs: 900 },
      { speakerId: 'SPEAKER_04', startMs: 1_000, endMs: 2_000 },
      { speakerId: 'SPEAKER_26', startMs: 2_100, endMs: 3_000 },
    ]);

    expect(result.entries.map(entry => [entry.speakerId, entry.speaker])).toEqual([
      ['spk_1', 'Speaker 1'],
      ['spk_2', 'Speaker 2'],
      ['spk_1', 'Speaker 1'],
    ]);
    expect(result.speakers.map(speaker => speaker.id)).toEqual(['spk_1', 'spk_2']);
  });

  it('uses greatest overlap and leaves unsupported entries unlabeled', () => {
    const result = alignMeetingSpeakers([
      { text: 'Mostly B', startMs: 1_000, endMs: 3_000 },
      { text: 'No timing' },
    ], [
      { speakerId: 'A', startMs: 900, endMs: 1_500 },
      { speakerId: 'B', startMs: 1_500, endMs: 3_000 },
    ]);

    expect(result.entries[0]).toMatchObject({ speakerId: 'spk_2', speaker: 'Speaker 2' });
    expect(result.entries[1]).toEqual({ text: 'No timing' });
  });

  it('leaves a transcript segment unlabeled when speaker overlap is ambiguous', () => {
    const result = alignMeetingSpeakers([
      { text: 'Overlapping exchange', startMs: 1_000, endMs: 2_000 },
    ], [
      { speakerId: 'A', startMs: 1_000, endMs: 1_600 },
      { speakerId: 'B', startMs: 1_400, endMs: 2_000 },
    ]);

    expect(result.entries[0]).toEqual({
      text: 'Overlapping exchange',
      startMs: 1_000,
      endMs: 2_000,
    });
    expect(result.speakers.map(speaker => speaker.id)).toEqual(['spk_1', 'spk_2']);
  });

  it('drops tiny end-of-file clusters that create phantom speakers', () => {
    const result = alignMeetingSpeakers([
      { text: 'Closing thought', startMs: 30_000, endMs: 33_100 },
    ], [
      { speakerId: 'S2', startMs: 30_000, endMs: 33_000 },
      { speakerId: 'S3', startMs: 33_000, endMs: 33_040 },
      { speakerId: 'S2', startMs: 33_040, endMs: 33_070 },
      { speakerId: 'S3', startMs: 33_070, endMs: 33_100 },
    ]);

    expect(result.entries[0]).toMatchObject({ speakerId: 'spk_1', speaker: 'Speaker 1' });
    expect(result.speakers.map(speaker => speaker.id)).toEqual(['spk_1']);
  });
});
