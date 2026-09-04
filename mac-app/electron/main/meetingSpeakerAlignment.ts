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
const MIN_PRIMARY_OVERLAP_SHARE = 0.75;
const MIN_PRIMARY_MARGIN_SHARE = 0.5;

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
    const ranked = [...overlapBySpeaker.entries()].sort((left, right) => right[1] - left[1]);
    const primary = ranked[0];
    if (!primary) return { ...entry };
    const totalOverlap = ranked.reduce((total, candidate) => total + candidate[1], 0);
    const runnerUpOverlap = ranked[1]?.[1] ?? 0;
    const primaryShare = primary[1] / totalOverlap;
    const primaryMarginShare = (primary[1] - runnerUpOverlap) / totalOverlap;
    if (primaryShare < MIN_PRIMARY_OVERLAP_SHARE || primaryMarginShare < MIN_PRIMARY_MARGIN_SHARE) {
      return { ...entry };
    }
    return {
      ...entry,
      speakerId: stableIdByRawId.get(primary[0]) ?? null,
      speaker: labelByRawId.get(primary[0]) ?? null,
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
