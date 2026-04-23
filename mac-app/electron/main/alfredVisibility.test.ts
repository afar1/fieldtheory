import { describe, expect, it } from 'vitest';
import { isAlfredApp } from './alfredVisibility';

describe('isAlfredApp', () => {
  it('matches Alfred by bundle id', () => {
    expect(isAlfredApp({ bundleId: 'com.runningwithcrayons.Alfred', name: 'Alfred' })).toBe(true);
  });

  it('matches Alfred by app name when bundle id is unavailable', () => {
    expect(isAlfredApp({ bundleId: null, name: 'Alfred' })).toBe(true);
  });

  it('matches versioned Alfred app names when bundle id is unavailable', () => {
    expect(isAlfredApp({ bundleId: null, name: 'Alfred 5' })).toBe(true);
  });

  it('does not match unrelated app names', () => {
    expect(isAlfredApp({ bundleId: 'com.example.notes', name: 'Not Alfred' })).toBe(false);
  });
});
