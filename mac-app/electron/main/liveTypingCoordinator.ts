import type { TextTargetFailureReason } from './types/audio';

export type InsertTextSegmentResult = {
  success: boolean;
  reason?: TextTargetFailureReason | 'helper-not-running' | 'timeout';
};

export type LiveTypingDeps = {
  insertTextSegment: (bundleId: string, text: string) => Promise<InsertTextSegmentResult>;
  onTrace?: (event: string, data?: Record<string, unknown>) => void;
};

type QueuedSegment = {
  text: string;
};

const BUFFER_REASONS = new Set<string>([
  'app-not-running',
  'not-frontmost',
  'no-focused-text-input',
  'secure-input',
]);

export class LiveTypingCoordinator {
  private targetBundleId: string | null = null;
  private lastFrontmostBundleId: string | null = null;
  private queue: QueuedSegment[] = [];
  private queueHead = 0;
  private flushPromise: Promise<void> | null = null;
  private acceptingSegments = false;
  private active = false;
  private paused = false;
  private degraded = false;
  private consecutiveHardFailures = 0;
  private typedSegmentCount = 0;

  constructor(private readonly deps: LiveTypingDeps) {}

  start(targetBundleId: string): void {
    this.targetBundleId = targetBundleId;
    this.lastFrontmostBundleId = targetBundleId;
    this.queue = [];
    this.queueHead = 0;
    this.flushPromise = null;
    this.acceptingSegments = true;
    this.active = true;
    this.paused = false;
    this.degraded = false;
    this.consecutiveHardFailures = 0;
    this.typedSegmentCount = 0;
    this.trace('start', { targetBundleId });
  }

  enqueueSegment(text: string): void {
    if (!this.active || !this.acceptingSegments || this.degraded) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    this.queue.push({ text: `${trimmed} ` });
    if (this.lastFrontmostBundleId !== this.targetBundleId) {
      this.paused = true;
      this.trace('segment.buffered', { reason: 'not-frontmost', chars: trimmed.length });
      return;
    }
    this.requestFlush();
  }

  notifyFrontmostChanged(bundleId: string | null): void {
    this.lastFrontmostBundleId = bundleId;
    if (!this.active || this.degraded || !this.targetBundleId) return;

    if (bundleId !== this.targetBundleId) {
      this.paused = true;
      return;
    }

    this.paused = false;
    this.requestFlush();
  }

  async finish(): Promise<{ typedSegmentCount: number }> {
    if (!this.active) {
      return { typedSegmentCount: this.typedSegmentCount };
    }

    this.acceptingSegments = false;
    await this.flushBufferedSegmentsIfFrontmost();

    this.active = false;
    this.trace('finish', {
      typedSegmentCount: this.typedSegmentCount,
      bufferedSegmentCount: this.pendingSegmentCount(),
      degraded: this.degraded,
    });
    return { typedSegmentCount: this.typedSegmentCount };
  }

  async drain(): Promise<{ typedSegmentCount: number; bufferedSegmentCount: number }> {
    if (!this.active) {
      return { typedSegmentCount: this.typedSegmentCount, bufferedSegmentCount: this.pendingSegmentCount() };
    }

    await this.flushBufferedSegmentsIfFrontmost();

    return { typedSegmentCount: this.typedSegmentCount, bufferedSegmentCount: this.pendingSegmentCount() };
  }

  cancel(): void {
    const bufferedSegmentCount = this.pendingSegmentCount();
    this.acceptingSegments = false;
    this.active = false;
    this.paused = true;
    this.queue = [];
    this.queueHead = 0;
    this.trace('cancel', { typedSegmentCount: this.typedSegmentCount, bufferedSegmentCount });
  }

  private requestFlush(): void {
    if (!this.active || this.paused || this.degraded || this.flushPromise || this.pendingSegmentCount() === 0) {
      return;
    }

    this.flushPromise = this.flushQueue().finally(() => {
      this.flushPromise = null;
      if (this.active && !this.paused && !this.degraded && this.pendingSegmentCount() > 0) {
        this.requestFlush();
      }
    });
  }

  private async flushBufferedSegmentsIfFrontmost(): Promise<void> {
    while (this.flushPromise) {
      await this.flushPromise;
    }

    if (!this.degraded && this.pendingSegmentCount() > 0 && this.lastFrontmostBundleId === this.targetBundleId) {
      this.paused = false;
      await this.flushQueue();
    }
  }

  private async flushQueue(): Promise<void> {
    while (this.active && !this.paused && !this.degraded && this.pendingSegmentCount() > 0) {
      const segment = this.queue[this.queueHead];
      const outcome = await this.insertSegment(segment);
      if (outcome === 'typed') {
        this.queueHead += 1;
        this.typedSegmentCount += 1;
        this.compactQueueIfNeeded();
        continue;
      }
      break;
    }
  }

  private pendingSegmentCount(): number {
    return this.queue.length - this.queueHead;
  }

  private compactQueueIfNeeded(): void {
    if (this.queueHead === 0) return;
    if (this.queueHead === this.queue.length) {
      this.queue = [];
      this.queueHead = 0;
      return;
    }
    if (this.queueHead >= 32 && this.queueHead * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  private async insertSegment(segment: QueuedSegment): Promise<'typed' | 'buffered'> {
    const targetBundleId = this.targetBundleId;
    if (!targetBundleId) {
      this.paused = true;
      return 'buffered';
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = performance.now();
      const result = await this.tryInsert(targetBundleId, segment.text);
      const latencyMs = Math.round(performance.now() - startedAt);

      if (result.success) {
        this.consecutiveHardFailures = 0;
        this.trace('segment.typed', { chars: segment.text.length, latencyMs });
        return 'typed';
      }

      const reason = result.reason ?? 'post-failed';
      if (BUFFER_REASONS.has(reason)) {
        this.paused = true;
        this.trace('segment.buffered', { reason, chars: segment.text.length, latencyMs });
        return 'buffered';
      }

      this.consecutiveHardFailures += 1;
      this.trace('segment.hard-failure', {
        reason,
        chars: segment.text.length,
        attempt: attempt + 1,
        consecutiveHardFailures: this.consecutiveHardFailures,
        latencyMs,
      });

      if (this.consecutiveHardFailures >= 3) {
        this.degraded = true;
        this.paused = true;
        this.trace('degraded', { reason, bufferedSegmentCount: this.pendingSegmentCount() });
        return 'buffered';
      }
    }

    this.paused = true;
    return 'buffered';
  }

  private async tryInsert(targetBundleId: string, text: string): Promise<InsertTextSegmentResult> {
    try {
      return await this.deps.insertTextSegment(targetBundleId, text);
    } catch {
      return { success: false, reason: 'post-failed' };
    }
  }

  private trace(event: string, data?: Record<string, unknown>): void {
    this.deps.onTrace?.(`liveTyping.${event}`, data);
  }
}
