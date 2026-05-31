# TestFlight Build & Distribution Guide (Xcode Only)

## Build Information

**Current Build:**
- **Version:** 1.0.1 (Background Recording)
- **Build Number:** 2
- **Branch:** cursor/background-recording-implementation-1718
- **Features:** Background recording, instant tab switching

---

## Steps After Building Successfully

### Step 1: Archive the Build

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  In Xcode:                                              │
│                                                         │
│  1. Make sure destination is "Any iOS Device"          │
│  2. Menu: Product → Archive                            │
│                                                         │
│  Or keyboard shortcut:                                  │
│  Control + Command + B                                  │
│                                                         │
│  Wait for archive to complete (5-10 minutes)           │
│  Organizer window opens automatically                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 2: Validate Archive (Optional but Recommended)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  In Organizer window:                                   │
│                                                         │
│  1. Select your archive (should show "1.0.1 (2)")       │
│  2. Click "Validate App"                                │
│  3. Select "App Store Connect" → Next                  │
│  4. Select upload options:                              │
│     ✓ Upload your app's symbols                          │
│     ✓ Manage Version and Build Number                   │
│  5. Click "Validate"                                     │
│                                                         │
│  Wait 2-5 minutes for validation                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 3: Distribute to TestFlight

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  In Organizer window:                                   │
│                                                         │
│  1. Select your archive                                  │
│  2. Click "Distribute App"                              │
│  3. Select "App Store Connect" → Next                  │
│  4. Select "Upload" (not Export) → Next                │
│  5. Select upload options:                              │
│     ✓ Upload your app's symbols                          │
│     ✓ Manage Version and Build Number                   │
│  6. Click "Upload"                                       │
│                                                         │
│  Wait 5-15 minutes for upload                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 4: Process Build in App Store Connect

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. Go to: https://appstoreconnect.apple.com            │
│  2. Sign in with your Apple Developer account           │
│  3. Navigate: My Apps → littleai (or Oscar)            │
│  4. Click "TestFlight" tab                              │
│                                                         │
│  5. Wait for processing (10-30 minutes):                │
│     • Build shows as "Processing..."                    │
│     • You'll get an email when done                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 5: Add Build to TestFlight Testing

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  In App Store Connect TestFlight tab:                   │
│                                                         │
│  1. Find your build (Build 2)                           │
│  2. Click "+" next to "TestFlight Testing"              │
│  3. Select the build → Next                             │
│  4. Fill in "What to Test" (optional):                 │
│     "Background Recording Test                          │
│      • Test recording with screen locked                │
│      • Test recording while app is backgrounded         │
│      • Verify instant tab switching"                    │
│  5. Click "Start Testing"                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 6: Add Internal Testers (Optional)

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  To test yourself:                                      │
│                                                         │
│  1. Go to "Internal Testing" section                    │
│  2. Click "+" to add testers                            │
│  3. Add your Apple ID email                             │
│  4. Select build (Build 2)                              │
│  5. Click "Start Testing"                               │
│                                                         │
│  You'll receive an email invitation                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Step 7: Install via TestFlight App

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  On your iPhone:                                        │
│                                                         │
│  1. Install TestFlight app (if not installed)           │
│  2. Open TestFlight                                     │
│  3. Accept invitation (if you added yourself)          │
│  4. Tap "Install" next to your app                      │
│  5. Wait for installation                               │
│  6. Open and test the app                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Reference

### Xcode Keyboard Shortcuts

```
Clean Build Folder:    Shift + Command + K
Archive:               Control + Command + B
Build:                 Command + B
Run:                   Command + R
```

### Essential Commands

```bash
# Open Xcode workspace
cd ios
open littleai.xcworkspace

# Install CocoaPods (if needed)
cd ios
pod install
```

---

## Troubleshooting

### Common Issues After Build

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Issue: Archive fails                                   │
│  Fix: Clean build folder (Shift+Cmd+K) → Archive again │
│                                                         │
│  Issue: Validation fails                                │
│  Fix: Check signing certificates in Xcode Preferences  │
│                                                         │
│  Issue: Upload fails                                    │
│  Fix: Check internet, try again                         │
│                                                         │
│  Issue: Build processing stuck                           │
│  Fix: Wait 30+ minutes, check App Store Connect status │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Version Tracking

**Current Build:** Version 1.0.1, Build 2

**For next build:** Increment build number to 3, keep version 1.0.1 (or bump to 1.0.2)
