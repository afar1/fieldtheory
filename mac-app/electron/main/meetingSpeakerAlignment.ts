import type { MeetingSpeaker, MeetingTranscriptEntry } from '../shared/meetingMarkdown';

export type DiarizationSegment = {
  speakerId: string;
  startMs: number;
  endMs: number;
  confidence?: number | null;
};

export type SpeakerAlignmentResult = {
  entries: MeetingTranscriptEntry[];
  speakers: MeetingSpeaker[];
};

const MIN_SPEAKER_TOTAL_MS = 250;

function overlapMs(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

export function alignMeetingSpeakers(
  entries: MeetingTranscriptEntry[],
  segments: DiarizationSegment[],
): SpeakerAlignmentResult {
  const validSegments = segments.filter(segment => segment.speakerId && segment.endMs > segment.startMs);
  const durationBySpeaker = new Map<string, number>();
  for (const segment of validSegments) {
    durationBySpeaker.set(
      segment.speakerId,
      (durationBySpeaker.get(segment.speakerId) ?? 0) + segment.endMs - segment.startMs,
    );
  }
  const stableSegments = validSegments.filter(
    segment => (durationBySpeaker.get(segment.speakerId) ?? 0) >= MIN_SPEAKER_TOTAL_MS,
  );
  const orderedSpeakerIds = [...new Set(
    [...stableSegments]
      .sort((left, right) => left.startMs - right.startMs)
      .map(segment => segment.speakerId),
  )];
  const stableIdByRawId = new Map(orderedSpeakerIds.map((speakerId, index) => [speakerId, `spk_${index + 1}`]));
  const labelByRawId = new Map(orderedSpeakerIds.map((speakerId, index) => [speakerId, `Speaker ${index + 1}`]));

  const aligned = entries.map((entry) => {
    if (entry.startMs == null || entry.endMs == null || entry.endMs <= entry.startMs) return { ...entry };
    const overlapBySpeaker = new Map<string, number>();
    for (const segment of stableSegments) {
      const overlap = overlapMs(
        { startMs: entry.startMs, endMs: entry.endMs },
        { startMs: segment.startMs, endMs: segment.endMs },
      );
      if (overlap > 0) overlapBySpeaker.set(segment.speakerId, (overlapBySpeaker.get(segment.speakerId) ?? 0) + overlap);
    }
    const primary = [...overlapBySpeaker.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
    if (!primary) return { ...entry };
    return {
      ...entry,
      speakerId: stableIdByRawId.get(primary) ?? null,
      speaker: labelByRawId.get(primary) ?? null,
    };
  });

  const speakers = orderedSpeakerIds.map((rawId, index) => {
    const confidences = stableSegments
      .filter(segment => segment.speakerId === rawId && segment.confidence != null)
      .map(segment => segment.confidence as number);
    return {
      id: `spk_${index + 1}`,
      label: `Speaker ${index + 1}`,
      source: 'fluid-audio-community-1',
      confidence: confidences.length > 0
        ? confidences.reduce((total, value) => total + value, 0) / confidences.length
        : null,
    };
  });

  return { entries: aligned, speakers };
}
