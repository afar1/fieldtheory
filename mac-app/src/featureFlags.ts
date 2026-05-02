// =============================================================================
// Feature Flags - Central location for feature toggles.
// Use these flags to enable/disable features during development.
// =============================================================================

/**
 * Hot Mic feature - real-time messaging with team members.
 * Currently disabled for launch cleanup.
 */
export const FEATURE_HOT_MIC_ENABLED = false;

/**
 * Message shortcut feature - sending items to contacts via 'm' key.
 * Currently disabled for launch cleanup.
 */
export const FEATURE_MESSAGE_SHORTCUT_ENABLED = false;

/**
 * Sharing feature - sharing clipboard items to shared/team clipboard.
 * Hard-disabled: clipboard items must never sync or upload.
 */
export const FEATURE_SHARING_ENABLED = false;

/**
 * Narration feature - text-to-speech for Librarian readings.
 * Disabled by default. Uses ElevenLabs API.
 */
export const FEATURE_NARRATION_ENABLED = false;
