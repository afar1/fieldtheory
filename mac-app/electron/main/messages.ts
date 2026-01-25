/**
 * Centralized user-facing notification messages.
 * Edit this file to change any notification text shown to users.
 *
 * Message types:
 * - recordingNote: Yellow info, 3s auto-dismiss (showRecordingNote)
 * - critical: Orange dot, 2.5s auto-dismiss (showCriticalMessage)
 * - overlay: Brief feedback in recording overlay (overlay.showStatus)
 */

export const MESSAGES = {
  // Recording notes (yellow info, 3s auto-dismiss)
  recordingNote: {
    priorityMicLimitReached: 'Priority mic limit reached (upgrade)',
    autoStackLimitReached: (used: number, limit: number) =>
      `Auto-stack limit reached (${used}/${limit})(upgrade)`,
    tooManyImages: 'Note: Stacking 10+ images, some apps may have limits',
    autoImproveEnabled: 'Auto-improve enabled',
    autoImproveDisabled: 'Auto-improve disabled',
  },

  // Critical messages (orange dot, 2.5s auto-dismiss)
  critical: {
    improvementQuotaExhausted: 'Auto-improve limit reached (upgrade)',
    noLlmConfigured: 'Download a model in Settings',
    pastingManyImages: 'Pasting 10+ images, some apps may have limits',
    noTargetInputField: 'No input field focused',
  },

  // Overlay status (brief feedback in recording overlay)
  overlay: {
    noAudioFound: 'No audio found',
    cancelled: 'Cancelled',
  },
};
