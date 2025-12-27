import { useEffect } from 'react';
import { Audio } from 'expo-av';

/**
 * Hook to configure audio session for headset Play/Pause button support.
 * Also enables background audio so recording continues when screen is off.
 * 
 * Note: Full headset button event handling in Expo requires native modules or
 * react-native-track-player. This hook configures the audio session properly
 * so that headset buttons can work, but actual event detection may need to be
 * implemented via native code or a library like react-native-track-player.
 * 
 * For MVP, users can use the on-screen record button. This hook sets up the
 * foundation for future headset button support.
 */
export function useHeadsetControls() {
  useEffect(() => {
    // Configure audio session to accept remote control commands.
    // staysActiveInBackground allows recording to continue when screen is off.
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch((error) => {
      console.warn('Failed to configure audio session for remote controls:', error);
    });
  }, []);
}

