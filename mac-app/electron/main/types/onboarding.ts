/**
 * IPC channels for onboarding communication.
 */
export const OnboardingIPCChannels = {
  // Permission checks
  GET_PERMISSION_STATUS: 'onboarding:getPermissionStatus',
  REQUEST_MICROPHONE: 'onboarding:requestMicrophone',
  OPEN_ACCESSIBILITY_SETTINGS: 'onboarding:openAccessibilitySettings',
  OPEN_SCREEN_RECORDING_SETTINGS: 'onboarding:openScreenRecordingSettings',
  TRIGGER_SCREEN_RECORDING_PROMPT: 'onboarding:triggerScreenRecordingPrompt',
  
  // Onboarding state
  GET_ONBOARDING_STATE: 'onboarding:getState',
  SET_ONBOARDING_STEP: 'onboarding:setStep',
  COMPLETE_ONBOARDING: 'onboarding:complete',
  SKIP_ONBOARDING: 'onboarding:skip',
  RESET_ONBOARDING: 'onboarding:reset',
  
  // Model download (reuses existing model download infrastructure)
  CHECK_MODEL_STATUS: 'onboarding:checkModelStatus',
} as const;

/**
 * Permission status returned by getPermissionStatus.
 */
export interface PermissionStatus {
  microphone: 'granted' | 'denied' | 'not-determined';
  accessibility: boolean;
  screenRecording: boolean;
}

/**
 * Current onboarding state.
 */
export interface OnboardingState {
  isComplete: boolean;
  currentStep: number;
  permissions: PermissionStatus;
  modelDownloaded: boolean;
}

