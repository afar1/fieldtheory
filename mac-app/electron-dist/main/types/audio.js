"use strict";
// =============================================================================
// Audio Device Types - Shared type definitions for the audio priority system.
// These types are used across the Electron main process, renderer, and IPC.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioIPCChannels = void 0;
// =============================================================================
// IPC Message Types - Strongly typed messages for Electron main <-> renderer.
// =============================================================================
/**
 * IPC channels used for audio-related communication.
 * All channels are prefixed with 'audio:' for namespacing.
 */
exports.AudioIPCChannels = {
    // Renderer -> Main (invoke/handle pattern)
    GET_STATE: 'audio:getState',
    SET_PRIORITY_MODE: 'audio:setPriorityMode',
    SET_PRIORITY_DEVICE: 'audio:setPriorityDevice',
    RESET_OVERRIDE: 'audio:resetOverride',
    // Main -> Renderer (send pattern, broadcast)
    STATE_CHANGED: 'audio:stateChanged',
};
//# sourceMappingURL=audio.js.map