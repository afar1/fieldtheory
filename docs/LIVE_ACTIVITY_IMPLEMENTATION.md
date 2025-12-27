# Live Activity Implementation Plan for Background Recording

## Overview

This document outlines the implementation plan for adding iOS Live Activities to Field Theory, enabling users to see recording status and control recording from the lock screen and Dynamic Island.

## What Are Live Activities?

Live Activities are a feature introduced in iOS 16.1 that allows apps to display real-time information on the lock screen and in the Dynamic Island (on iPhone 14 Pro and later). They're perfect for ongoing activities like recording sessions.

## Current State

- **iOS Deployment Target**: 15.1 (needs bump to 16.1 for Live Activities)
- **Background Audio**: ✅ Now enabled
- **Recording Indicator**: ✅ In-app orange dot added

## Proposed Live Activity Features

### Lock Screen Presence
```
┌─────────────────────────────────────┐
│  🔴 Field Theory Recording          │
│  Duration: 12:34                    │
│                                     │
│  [Stop & Transcribe]  [Pause]       │
│  [Create Tasks]       [Cursor →]    │
└─────────────────────────────────────┘
```

### Dynamic Island (Compact)
```
┌──────────────────────────────┐
│  🔴 Recording  •  12:34      │
└──────────────────────────────┘
```

### Dynamic Island (Expanded)
```
┌────────────────────────────────────────┐
│  🔴 Field Theory                       │
│  Recording: 12 minutes 34 seconds      │
│                                        │
│  [Stop]    [Pause]    [Send to Cursor] │
└────────────────────────────────────────┘
```

## Implementation Requirements

### 1. iOS Version Bump

Update `ios/littleai/Info.plist`:
```xml
<key>MinimumOSVersion</key>
<string>16.1</string>
```

Update `ios/Podfile`:
```ruby
platform :ios, '16.1'
```

Update `app.json`:
```json
{
  "ios": {
    "deploymentTarget": "16.1"
  }
}
```

### 2. Widget Extension Target

Create a new Widget Extension target in Xcode:
1. File → New → Target → Widget Extension
2. Name: `FieldTheoryLiveActivity`
3. Check "Include Live Activity"

This creates:
- `FieldTheoryLiveActivity/FieldTheoryLiveActivityBundle.swift`
- `FieldTheoryLiveActivity/FieldTheoryLiveActivityLiveActivity.swift`
- `FieldTheoryLiveActivity/Info.plist`

### 3. App Groups for Shared State

Configure App Groups to share recording state between main app and widget:
1. Add "App Groups" capability to both targets
2. Use shared container: `group.com.afar1.littleai`

### 4. ActivityKit Implementation

#### ActivityAttributes (Shared Data Model)
```swift
import ActivityKit

struct RecordingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var duration: TimeInterval
        var isPaused: Bool
    }
    
    var startTime: Date
}
```

#### Live Activity View
```swift
import SwiftUI
import WidgetKit

struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            // Lock screen view
            RecordingLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded view
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "record.circle.fill")
                        .foregroundColor(.red)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(formatDuration(context.state.duration))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Button("Stop") { /* deep link */ }
                        Button("Pause") { /* deep link */ }
                        Button("Cursor →") { /* deep link */ }
                    }
                }
            } compactLeading: {
                Image(systemName: "record.circle.fill")
                    .foregroundColor(.red)
            } compactTrailing: {
                Text(formatDuration(context.state.duration))
            } minimal: {
                Image(systemName: "record.circle.fill")
                    .foregroundColor(.red)
            }
        }
    }
}
```

### 5. React Native Bridge

Create a native module to control Live Activities from JavaScript:

#### Swift Native Module
```swift
// ios/littleai/LiveActivityModule.swift
import Foundation
import ActivityKit

@objc(LiveActivityModule)
class LiveActivityModule: NSObject {
    
    @objc
    func startRecordingActivity() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        
        let attributes = RecordingActivityAttributes(startTime: Date())
        let state = RecordingActivityAttributes.ContentState(
            duration: 0,
            isPaused: false
        )
        
        do {
            _ = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil)
            )
        } catch {
            print("Error starting Live Activity: \(error)")
        }
    }
    
    @objc
    func updateRecordingActivity(_ duration: Double, isPaused: Bool) {
        Task {
            for activity in Activity<RecordingActivityAttributes>.activities {
                let state = RecordingActivityAttributes.ContentState(
                    duration: duration,
                    isPaused: isPaused
                )
                await activity.update(using: state)
            }
        }
    }
    
    @objc
    func stopRecordingActivity() {
        Task {
            for activity in Activity<RecordingActivityAttributes>.activities {
                await activity.end(dismissalPolicy: .immediate)
            }
        }
    }
    
    @objc static func requiresMainQueueSetup() -> Bool { return false }
}
```

#### Objective-C Bridge
```objc
// ios/littleai/LiveActivityModule.m
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LiveActivityModule, NSObject)

RCT_EXTERN_METHOD(startRecordingActivity)
RCT_EXTERN_METHOD(updateRecordingActivity:(double)duration isPaused:(BOOL)isPaused)
RCT_EXTERN_METHOD(stopRecordingActivity)

@end
```

#### JavaScript Interface
```typescript
// hooks/useLiveActivity.ts
import { NativeModules, Platform } from 'react-native';

const { LiveActivityModule } = NativeModules;

export function useLiveActivity() {
  const startActivity = () => {
    if (Platform.OS === 'ios' && LiveActivityModule) {
      LiveActivityModule.startRecordingActivity();
    }
  };
  
  const updateActivity = (duration: number, isPaused: boolean) => {
    if (Platform.OS === 'ios' && LiveActivityModule) {
      LiveActivityModule.updateRecordingActivity(duration, isPaused);
    }
  };
  
  const stopActivity = () => {
    if (Platform.OS === 'ios' && LiveActivityModule) {
      LiveActivityModule.stopRecordingActivity();
    }
  };
  
  return { startActivity, updateActivity, stopActivity };
}
```

### 6. Deep Links for Actions

Configure URL schemes for Live Activity button actions:

```xml
<!-- Info.plist -->
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>fieldtheory</string>
        </array>
    </dict>
</array>
```

Deep link handlers:
- `fieldtheory://recording/stop` - Stop and transcribe
- `fieldtheory://recording/pause` - Pause recording
- `fieldtheory://recording/resume` - Resume recording
- `fieldtheory://cursor` - Open Cursor tab

## File Structure After Implementation

```
ios/
├── littleai/
│   ├── LiveActivityModule.swift    # Native module
│   ├── LiveActivityModule.m        # ObjC bridge
│   └── ...
├── FieldTheoryLiveActivity/
│   ├── FieldTheoryLiveActivityBundle.swift
│   ├── FieldTheoryLiveActivityLiveActivity.swift
│   ├── RecordingActivityAttributes.swift
│   └── Info.plist
└── ...
```

## Implementation Order

1. **Bump iOS version** to 16.1
2. **Create Widget Extension target** in Xcode
3. **Configure App Groups** for shared state
4. **Implement ActivityAttributes** model
5. **Build Live Activity UI** with SwiftUI
6. **Create native module** for React Native bridge
7. **Integrate with useWhisperRecording** hook
8. **Add deep link handling** for button actions
9. **Test on physical device** (Live Activities don't work in Simulator)

## Estimated Time

- Widget Extension setup: 30 minutes
- Live Activity UI: 1 hour
- Native module bridge: 30 minutes
- Deep link handling: 30 minutes
- Integration & testing: 1 hour

**Total: 3-4 hours**

## Considerations

### Silence Detection

The user mentioned wanting auto-stop on prolonged silence. This can be implemented by:
1. Analyzing audio levels during recording
2. Tracking consecutive silent frames
3. After X seconds of silence, prompt user or auto-stop

This is independent of Live Activities but would integrate with the recording flow.

### Battery Impact

Live Activities update the lock screen frequently. To minimize battery impact:
- Update duration every 5 seconds instead of every second
- Use `staleDate` to let iOS manage updates
- End activity promptly when recording stops

### Fallback

For iOS 15.x users who can't use Live Activities:
- The in-app recording indicator still works
- Could add local notifications as alternative lock screen presence

## Alternatives Considered

1. **Local Notifications**: Could show "Recording in progress" but lacks real-time updates and actions
2. **Now Playing Info**: Could hijack MPNowPlayingInfoCenter but feels hacky for a non-media app
3. **Control Center Widget**: Requires iOS 18+ and different implementation

## Next Steps

1. Verify this plan aligns with your vision
2. Create the Widget Extension target in Xcode
3. Implement the native Swift code
4. Bridge to React Native
