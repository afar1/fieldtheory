import { describe, expect, it } from 'vitest';
import { formatCompactPriorityMicName } from './audioDeviceLabels';

describe('formatCompactPriorityMicName', () => {
  it('matches the compact menu-bar priority mic label', () => {
    expect(formatCompactPriorityMicName('MacBook Pro Microphone')).toBe('Mac');
    expect(formatCompactPriorityMicName('Pro Microphone')).toBe('Pro');
  });

  it('falls back when the device name is missing', () => {
    expect(formatCompactPriorityMicName(null)).toBe('Mic');
    expect(formatCompactPriorityMicName('   ')).toBe('Mic');
  });
});
