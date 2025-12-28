# Internal Build & Distribution Guide (Ad-Hoc)

**Note:** This guide is for creating internal builds that install directly on devices. 
This does NOT go through App Store or TestFlight.

## Build Information

**Current Build:**
- **Version:** 1.0.1 (Background Recording)
- **Build Number:** 2
- **Branch:** cursor/background-recording-implementation-1718
- **Features:** Background recording, instant tab switching
- **Distribution:** Internal/Ad-hoc (NOT for App Store)

---

## Step-by-Step: Build for Internal Distribution

### Prerequisites

```
✓ Xcode installed (latest version)
✓ Apple Developer account active
✓ Physical iOS device(s) registered in your developer account
✓ Device UDID(s) added to provisioning profile
✓ NO App Store Connect needed (this is internal only)
```

---

### Step 1: Open Project in Xcode

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. Open Terminal                                        │
│  2. Navigate to project:                                │
│                                                         │
│     cd /Users/afar/dev/littleai/ios                     │
│                                                         │
│  3. Open workspace (NOT .xcodeproj):                   │
│                                                         │
│     open littleai.xcworkspace                           │
│                                                         │
│  Note: Use .xcworkspace because of CocoaPods            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 2: Verify Version & Build Numbers

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  In Xcode:                                              │
│                                                         │
│  1. Select "littleai" project in left sidebar          │
│  2. Select "littleai" target                           │
│  3. Go to "General" tab                                 │
│  4. Verify:                                             │
│                                                         │
│     Version:     1.0.1                                  │
│     Build:       2                                      │
│                                                         │
│  If these don't match, update them manually:           │
│  • Version = 1.0.1                                      │
│  • Build = 2                                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 3: Select Build Scheme & Destination

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  In Xcode toolbar:                                      │
│                                                         │
│  1. Scheme dropdown (top left):                         │
│     Select: "littleai"                                  │
│                                                         │
│  2. Destination dropdown (next to scheme):             │
│     Select: "Any iOS Device" or "Generic iOS Device"   │
│                                                         │
│     ┌─────────────────────────────────────┐            │
│     │ Scheme: littleai                    │            │
│     │ Destination: Any iOS Device         │            │
│     └─────────────────────────────────────┘            │
│                                                         │
│  Important: Must select "Any iOS Device" for archive    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 4: Clean Build Folder

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Menu: Product → Clean Build Folder                    │
│                                                         │
│  Or keyboard shortcut:                                  │
│  Shift + Command + K                                   │
│                                                         │
│  Wait for clean to complete (may take a minute)        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 5: Archive the Build

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Menu: Product → Archive                                │
│                                                         │
│  Or keyboard shortcut:                                  │
│  Control + Command + B                                  │
│                                                         │
│  This will:                                              │
│  • Build the app                                        │
│  • Create an archive                                     │
│  • Open Organizer window                                │
│                                                         │
│  Wait for archive to complete (5-10 minutes)           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 6: Export for Ad-Hoc Distribution

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  After archive completes:                                │
│                                                         │
│  1. Organizer window opens automatically                │
│  2. Select your archive (should show "1.0.1 (2)")     │
│  3. Click "Distribute App" button                      │
│                                                         │
│  ┌─────────────────────────────────────┐              │
│  │ littleai 1.0.1 (2)                   │              │
│  │ Dec 27, 2025 at 3:45 PM              │              │
│  │                                       │              │
│  │  [Distribute App]                     │              │
│  └─────────────────────────────────────┘              │
│                                                         │
│  4. Select distribution method:                         │
│     → "Ad Hoc" (NOT App Store Connect)                  │
│     → Click "Next"                                      │
│                                                         │
│  5. Select distribution options:                        │
│     → "Export" (not Upload)                             │
│     → Click "Next"                                      │
│                                                         │
│  6. Select signing options:                             │
│     → "Automatically manage signing" OR                  │
│     → Select your provisioning profile                  │
│     → Click "Next"                                      │
│                                                         │
│  7. Review and click "Export"                            │
│                                                         │
│  8. Choose export location:                             │
│     → Select Desktop or Downloads folder                 │
│     → Click "Export"                                     │
│                                                         │
│  This creates an .ipa file you can install directly     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 7: Install on Device (Method 1: Xcode)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Option A: Install via Xcode                           │
│                                                         │
│  1. Connect your iPhone to Mac via USB                  │
│  2. Open Xcode                                          │
│  3. Window → Devices and Simulators                    │
│  4. Select your device                                  │
│  5. Click "+" under "Installed Apps"                    │
│  6. Navigate to exported .ipa file                      │
│  7. Select and install                                  │
│                                                         │
│  App will appear on your device                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 7: Install on Device (Method 2: Apple Configurator 2)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Option B: Install via Apple Configurator 2            │
│                                                         │
│  1. Download Apple Configurator 2 from Mac App Store   │
│  2. Connect your iPhone via USB                         │
│  3. Open Apple Configurator 2                          │
│  4. Select your device                                  │
│  5. Click "Add" → "Apps"                                 │
│  6. Select your .ipa file                               │
│  7. Click "Add"                                          │
│                                                         │
│  App will install on device                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 7: Install on Device (Method 3: Direct Install)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Option C: Install via Web Server (for multiple devices)│
│                                                         │
│  1. Upload .ipa file to a web server                    │
│  2. Create a manifest.plist file:                      │
│                                                         │
│     <?xml version="1.0" encoding="UTF-8"?>            │
│     <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST...">   │
│     <plist version="1.0">                              │
│     <dict>                                              │
│       <key>items</key>                                  │
│       <array>                                            │
│         <dict>                                          │
│           <key>assets</key>                             │
│           <array>                                        │
│             <dict>                                      │
│               <key>kind</key>                           │
│               <string>software-package</string>         │
│               <key>url</key>                            │
│               <string>https://yourserver.com/app.ipa</string>│
│             </dict>                                     │
│           </array>                                      │
│           <key>metadata</key>                           │
│           <dict>                                        │
│             <key>bundle-identifier</key>                │
│             <string>com.afar1.littleai</string>         │
│             <key>bundle-version</key>                    │
│             <string>1.0.1</string>                     │
│             <key>kind</key>                             │
│             <string>software</string>                    │
│             <key>title</key>                             │
│             <string>littleai</string>                    │
│           </dict>                                       │
│         </dict>                                         │
│       </array>                                          │
│     </dict>                                             │
│     </plist>                                            │
│                                                         │
│  3. Create install link:                                │
│     itms-services://?action=download-manifest&url=     │
│     https://yourserver.com/manifest.plist               │
│                                                         │
│  4. Open link on iPhone Safari                          │
│  5. Tap "Install" when prompted                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 8: Trust Developer Certificate (First Install Only)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  On your iPhone (first time only):                     │
│                                                         │
│  1. After installation, app shows as "Untrusted"        │
│  2. Go to: Settings → General → VPN & Device Management│
│  3. Tap on your developer certificate                    │
│  4. Tap "Trust [Your Name]"                             │
│  5. Confirm "Trust"                                     │
│                                                         │
│  Now you can open the app normally                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 9: Test the App

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  On your iPhone:                                        │
│                                                         │
│  1. Open the app (icon should be on home screen)        │
│                                                         │
│  2. Test background recording:                           │
│     • Tap Record button                                  │
│     • Lock screen (power button)                         │
│     • Speak for 10 seconds                              │
│     • Unlock and stop recording                          │
│     • Verify transcription appears                       │
│                                                         │
│  3. Test app switching:                                 │
│     • Start recording                                    │
│     • Press home button                                  │
│     • Open another app                                  │
│     • Return to app                                     │
│     • Stop recording                                     │
│     • Verify transcription works                        │
│                                                         │
│  4. Test instant tab switching:                         │
│     • Navigate between tabs                              │
│     • Verify no animation (instant)                      │
│     • Verify recording indicator stays visible          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

### Common Issues

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Issue: "No signing certificate found"                   │
│  Fix: Xcode → Preferences → Accounts →                  │
│       Add your Apple ID → Download Manual Profiles      │
│                                                         │
│  Issue: "Device not registered"                         │
│  Fix: Add device UDID to Apple Developer account:       │
│       1. Get UDID: Settings → General → About          │
│       2. developer.apple.com → Devices → Add Device    │
│       3. Re-export archive                              │
│                                                         │
│  Issue: "Invalid provisioning profile"                  │
│  Fix: Xcode → Preferences → Accounts →                 │
│       Select team → Download Manual Profiles            │
│       OR create new Ad-Hoc provisioning profile         │
│                                                         │
│  Issue: Archive fails with CocoaPods errors             │
│  Fix: Terminal → cd ios → pod install →                │
│       Clean build folder → Archive again               │
│                                                         │
│  Issue: "Untrusted Developer" on device                 │
│  Fix: Settings → General → VPN & Device Management →   │
│       Trust your developer certificate                  │
│                                                         │
│  Issue: App crashes on launch                           │
│  Fix: Check device is registered, provisioning         │
│       profile includes device, re-export                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Adding Devices to Provisioning Profile

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  To add more devices:                                    │
│                                                         │
│  1. Get device UDID:                                    │
│     • Connect device to Mac                             │
│     • Xcode → Window → Devices and Simulators           │
│     • Select device → Copy Identifier                    │
│                                                         │
│  2. Add to Apple Developer:                             │
│     • developer.apple.com → Certificates, IDs & Profiles│
│     • Devices → + → Register Device                     │
│     • Paste UDID → Register                             │
│                                                         │
│  3. Update provisioning profile:                        │
│     • Profiles → Select your Ad-Hoc profile             │
│     • Edit → Select new device → Save                    │
│     • Download updated profile                           │
│                                                         │
│  4. Re-export archive with new profile                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Version Tracking

### Current Build Info

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Version: 1.0.1                                         │
│  Build: 2                                                │
│  Branch: cursor/background-recording-implementation-1718│
│  Date: Dec 27, 2025                                      │
│                                                         │
│  Features:                                               │
│  • Background recording enabled                          │
│  • Instant tab switching                                 │
│  • Visual recording indicator                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### For Future Builds

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  To create a new build:                                 │
│                                                         │
│  1. Update version/build numbers:                       │
│     • app.json: "version": "1.0.2"                      │
│     • Info.plist: CFBundleShortVersionString = "1.0.2" │
│     • Info.plist: CFBundleVersion = "3"                 │
│     • project.pbxproj: MARKETING_VERSION = 1.0.2       │
│     • project.pbxproj: CURRENT_PROJECT_VERSION = 3     │
│                                                         │
│  2. Follow steps 1-11 above                             │
│                                                         │
│  3. Document build info in this file                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Reference Commands

```bash
# Open project
cd /Users/afar/dev/littleai/ios
open littleai.xcworkspace

# Clean CocoaPods (if needed)
cd ios
pod install

# Check current version
grep -A 1 "CFBundleShortVersionString" ios/littleai/Info.plist
grep -A 1 "CFBundleVersion" ios/littleai/Info.plist
```

---

## Notes

- **Ad-Hoc builds expire** - Provisioning profiles expire after 1 year
- **Device limit** - Ad-Hoc distribution supports up to 100 devices
- **No App Store** - This build will NOT appear in App Store Connect
- **Direct install** - Install directly on registered devices only
- **Keep this branch** - So you can reference this version later
- **Re-export needed** - If you add new devices, re-export the archive
