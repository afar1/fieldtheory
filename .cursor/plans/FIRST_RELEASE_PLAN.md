# Oscar First Release Plan

> A comprehensive checklist and roadmap to ensure a high-quality, professional first release of Oscar (macOS + iOS) that instills user confidence, protects privacy, and delivers a polished experience.

**Last Updated**: December 5, 2025  
**Status**: Updated after codebase audit - reflects actual implementation state

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Priority Definitions](#priority-definitions)
3. [P0: Must-Have for Release (Blockers)](#p0-must-have-for-release-blockers)
4. [P1: Should-Have (Polish & Trust)](#p1-should-have-polish--trust)
5. [P2: Nice-to-Have (Post-Launch)](#p2-nice-to-have-post-launch)
6. [Distribution Strategy](#distribution-strategy)
7. [What You Can Safely Ignore for v1](#what-you-can-safely-ignore-for-v1)
8. [Risk Analysis](#risk-analysis)
9. [Implementation Buckets](#implementation-buckets)

---

## Executive Summary

Oscar is a privacy-first voice transcription and clipboard management tool for macOS and iOS. The first release must achieve:

1. **Professional Trust**: Users downloading a tool that requests microphone access and handles clipboard data must feel the app is legitimate and secure.
2. **Smooth Onboarding**: Step-by-step permission grants with clear explanations.
3. **Stability**: Core features work reliably across display configurations and system states.
4. **Multi-User Ready**: Supabase backend properly isolates user data.
5. **Distribution Polish**: Signed DMG for macOS website distribution, App Store-ready iOS build.

The goal is **not perfection** but **confidence-inspiring competence**. Users should feel:
- "This looks professional"
- "I understand what permissions I'm granting and why"
- "My data is handled responsibly"

---

## Priority Definitions

| Priority | Definition | Action |
|----------|------------|--------|
| **P0** | Must fix before release. Blocks distribution or creates security/trust issues. | Complete before any public release. |
| **P1** | Should have. Significantly improves first impression and user confidence. | Complete if time permits, defer to v1.1 if necessary. |
| **P2** | Nice to have. Quality of life improvements for power users. | Defer to post-launch. |

---

## P0: Must-Have for Release (Blockers)

### 🔐 1. Code Signing & Notarization (macOS)

**Current State**: Partially complete. Entitlements file exists, but notarization script is missing.

**What's Done**:
- [x] **Entitlements file**: `mac-app/build/entitlements.mac.plist` exists with required permissions
- [x] **electron-builder config**: `hardenedRuntime: true`, entitlements paths configured
- [x] **GitHub Releases**: Auto-updater configured for `electron-updater`

**What's Missing**:

- [ ] **Apple Developer Account**: Ensure active Apple Developer Program membership ($99/year)
- [ ] **Developer ID Certificate**: Generate "Developer ID Application" certificate
- [ ] **Create `scripts/notarize.js`**: Notarization script does not exist yet
- [ ] **Add `identity` field**: Add Developer ID to `mac-app/package.json` build config
- [ ] **Notarization**: Submit app to Apple's notarization service
- [ ] **Staple Notarization**: Attach notarization ticket to DMG

**Current `mac-app/package.json` build config** (already in place):

```json
{
  "mac": {
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  }
}
```

**Still needed** - add to config:

```json
{
  "mac": {
    "identity": "Developer ID Application: Your Name (TEAMID)"
  },
  "afterSign": "scripts/notarize.js"
}
```

**Current `build/entitlements.mac.plist`** (already exists):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

**Estimated Time**: 2-4 hours (mostly waiting for Apple notarization)

---

### 🎯 2. Onboarding Flow (Permissions Wizard)

**Current State**: App shows permissions warnings inline but doesn't guide users through setup step-by-step.

**What SuperWhisper Does Right**:
- Small modal that stays in front
- One permission at a time
- Clear explanation of WHY each permission is needed
- Visual checkmark when complete
- Doesn't overwhelm with all settings at once

**Required Actions**:

- [ ] **Create OnboardingWizard component** with steps:
  1. Welcome screen with app overview
  2. Microphone permission (with "Why we need this" explanation)
  3. Accessibility permission (for paste functionality)
  4. Optional: Model download progress
  5. Success screen with quick-start tips

- [ ] **Store onboarding completion** in preferences
- [ ] **Re-show on permission revocation** (already polling exists)
- [ ] **Skip option** for power users who know what they're doing

**UI Pattern**:
```
┌─────────────────────────────────────────────┐
│  Step 2 of 4: Microphone Access             │
│                                             │
│  🎤                                         │
│                                             │
│  Oscar needs microphone access to           │
│  transcribe your voice.                     │
│                                             │
│  Your audio is processed locally on your    │
│  Mac using Whisper. Nothing is sent to      │
│  the cloud.                                 │
│                                             │
│  [ Grant Access ]                           │
│                                             │
│  ○ ● ○ ○                                   │
└─────────────────────────────────────────────┘
```

**Estimated Time**: 4-6 hours

---

### 🖥️ 3. Multi-Monitor Window Positioning Fix

**Current State**: Needs Testing. Code appears to handle multi-monitor correctly, but reported bug needs verification.

**Code Review**: `clipboardHistoryWindow.ts` lines 140-180 properly:
- Uses `screen.getAllDisplays()` to calculate union bounds
- Uses `screen.getCursorScreenPoint()` and `screen.getDisplayNearestPoint()` for active display
- Calculates dialog position relative to the active display
- Clamps position to ensure window stays within bounds

**Required Actions**:

- [ ] **Test with common configurations** to verify bug:
  - Single monitor
  - Dual monitors (side-by-side)
  - Dual monitors (stacked)
  - Laptop with external monitor
  - External monitor only
- [ ] **If bug confirmed**: Fix coordinate translation
- [ ] **If bug not reproduced**: Close this item

**Files Reviewed**:
- `mac-app/electron/main/clipboardHistoryWindow.ts` lines 140-180 (looks correct)
- `mac-app/electron/main/recordingOverlay.ts` (if similar issues)

**Estimated Time**: 1-2 hours (testing), additional 1-2 hours if fix needed

---

### 🔒 4. Security Audit: Clipboard Data Storage

**Current State**: Clipboard history stored in local SQLite. Mobile sync sends data to Supabase.

**Required Actions**:

- [ ] **Review local storage encryption**:
  - SQLite database is unencrypted on disk
  - Acceptable for local-only data with proper file permissions
  - Document this in security.md

- [ ] **Review Supabase RLS policies** (already in place ✓):
  - `003_rls_policies.sql` looks correct
  - Each user can only access their own rows
  - Verify policies cover all CRUD operations

- [ ] **Ensure clipboard items NEVER sync to cloud**:
  - Current architecture: ✓ Clipboard is local-only
  - Only explicit "Separate into Tasks" goes to cloud
  - Add code comment making this explicit

- [ ] **API Token Security**:
  - Supabase anon key is safe to bundle (RLS protects data)
  - If using Anthropic API: **DO NOT bundle API key**
  - User should provide their own API key OR use a proxy

- [ ] **Sensitive Data Handling**:
  - Password manager detection (ignore list) - already mentioned in plan
  - Clipboard retention limits - implement if not exists
  - Clear data option in settings

**Estimated Time**: 2-4 hours (audit + documentation + minor fixes)

---

### 🔑 5. API Key Architecture for LLM Features

**Current State**: Partially implemented but **insecure**. API key is stored in plain JSON, not system keychain.

**What's Done**:
- [x] **Preferences field**: `anthropicApiKey` exists in `preferences.ts`
- [x] **API calls work**: `promptEngineer.ts` uses the key for Engineer feature
- [x] **Environment fallback**: Falls back to `ANTHROPIC_API_KEY` env var
- [x] **Error handling**: Shows clear error when API key missing

**Security Issue**:
- API key stored in plain JSON at `~/Library/Application Support/Oscar/preferences.json`
- Should use Electron's `safeStorage` API for OS keychain storage

**What's Missing**:

- [ ] **Add API key input in Settings UI** (no UI exists to set key)
- [ ] **Migrate to safeStorage API** for secure storage
- [ ] **Document key usage** in settings tooltip

**Current Implementation** (`mac-app/electron/main/preferences.ts`):
```typescript
interface AppPreferences {
  anthropicApiKey?: string; // Currently stored in plain JSON - INSECURE
}
```

**Recommended Fix**:
```typescript
import { safeStorage } from 'electron';

// Encrypt before storing
const encryptedKey = safeStorage.encryptString(apiKey);
// Store encryptedKey in preferences (as base64)

// Decrypt when reading
const decryptedKey = safeStorage.decryptString(encryptedKey);
```

**Estimated Time**: 2-3 hours (including Settings UI)

---

### 📱 6. iOS App Store Readiness

**Current State**: iOS app exists with basic structure. Privacy manifest exists. Naming is inconsistent.

**What's Done**:
- [x] **Info.plist**: Complete with `NSMicrophoneUsageDescription`
- [x] **PrivacyInfo.xcprivacy**: Exists with required API declarations
- [x] **Basic app structure**: React Native app functional

**Naming Inconsistency Issue**:
- macOS app: `productName: "Oscar"` (in `mac-app/package.json`)
- iOS app: `CFBundleDisplayName: "littleai"` (in `ios/littleai/Info.plist`)
- **Action needed**: Rename iOS app to "Oscar" for brand consistency

**Required Actions**:

- [ ] **Fix naming**: Change iOS `CFBundleDisplayName` from "littleai" to "Oscar"
- [ ] **Privacy Policy**: Create and host at accessible URL
- [ ] **App Store Connect Setup**:
  - App description and keywords
  - Screenshots for all device sizes
  - App preview video (optional but recommended)
  
- [ ] **Info.plist Review**:
  - NSMicrophoneUsageDescription ✓ (already present)
  - Privacy manifest (PrivacyInfo.xcprivacy) ✓ (already present)
  - Ensure all usage descriptions are user-friendly

- [ ] **App Functionality Audit**:
  - Core transcription works offline
  - Sync requires account (clearly communicated)
  - No broken/stub features visible to users

**Estimated Time**: 4-6 hours (mostly content creation)

---

## P1: Should-Have (Polish & Trust)

### 🎨 7. Settings Panel Standardization

**Current State**: Settings work but could be more polished and consistent.

**Required Actions**:

- [ ] **Consistent section styling**:
  - All sections use same card pattern
  - Consistent spacing and typography
  - Clear section headers with icons

- [ ] **Group related settings**:
  - Audio → Microphone settings
  - Transcription → Model selection, hotkeys
  - Clipboard → History settings, hotkeys
  - Account → Sync settings (if logged in)

- [ ] **Add section descriptions** explaining what each group does

- [ ] **Visual indicator** for active/changed settings

**Estimated Time**: 2-3 hours

---

### 💡 8. Tooltips & Contextual Help

**Current State**: No tooltips, limited inline help.

**Required Actions**:

- [ ] **Add tooltips to key UI elements**:
  - Hotkey buttons: "Click to change, then press new key combination"
  - Model selection: "Larger models are more accurate but slower"
  - Sync button: "Fetches new transcriptions from iOS"

- [ ] **"Did You Know" Tips System**:
  - Show occasional tips in clipboard history footer
  - Tips rotate or appear contextually
  - Example: "Did you know? Hold Shift+Enter to select multiple items"

- [ ] **First-time hints** for key features:
  - First screenshot: "Screenshots are added to your prompt stack"
  - First paste: "Tab cycles through target apps"

**Estimated Time**: 3-4 hours

---

### ⌨️ 9. Keyboard Shortcuts Viewer

**Current State**: No way to see all shortcuts at a glance.

**Required Actions**:

- [ ] **Create ShortcutsPanel component**
- [ ] **Trigger via Shift+?** (like Notion, Figma)
- [ ] **Modal overlay** showing all available shortcuts:

```
┌─────────────────────────────────────────────┐
│  Keyboard Shortcuts                    ✕    │
├─────────────────────────────────────────────┤
│  Clipboard History                          │
│  ────────────────────                       │
│  ⌃⌥Space       Open clipboard history       │
│  ↑/↓           Navigate items               │
│  Enter         Paste selected item          │
│  ⇧Enter        Toggle multi-select          │
│  Tab           Cycle target app             │
│  ⌘⌫            Delete selected              │
│  Escape        Close window                 │
│                                             │
│  Transcription                              │
│  ────────────────────                       │
│  ⌥Space        Start/stop recording         │
│                                             │
│  Screenshots                                │
│  ────────────────────                       │
│  ⌥1            Capture region screenshot    │
└─────────────────────────────────────────────┘
```

**Estimated Time**: 2-3 hours

---

### 📊 10. Basic Analytics

**Current State**: No analytics.

**Required Actions**:

- [ ] **Choose minimal analytics solution**:
  - PostHog (privacy-friendly, self-hostable)
  - Simple custom solution with Supabase

- [ ] **Track key metrics only**:
  - Daily active users (anonymous counter)
  - Transcription count (not content)
  - Feature usage: "Send to Cursor" taps, screenshot captures
  - Error rates

- [ ] **Privacy-respecting implementation**:
  - Anonymous device IDs
  - No personal data
  - Clear opt-out in settings
  - Document what's collected

- [ ] **Minimum viable dashboard**:
  - Daily/weekly active users
  - Feature adoption rates
  - Error alerts

**Estimated Time**: 4-6 hours

---

### 📝 11. Feedback Mechanism

**Current State**: No in-app way to report issues.

**Required Actions**:

- [ ] **Add "Send Feedback" option** in tray menu
- [ ] **Simple modal with**:
  - Type: Bug / Feature Request / Other
  - Description text area
  - Optional: Include system info (OS version, app version)
  - Optional: Include diagnostic logs

- [ ] **Backend**: Simple Supabase table or email integration

**Estimated Time**: 2-3 hours

---

### 🔐 12. Mobile Sync Security Enhancement

**Current State**: Sync uses standard Supabase auth with RLS. Data is visible in Supabase.

**Options** (in order of complexity):

1. **Document current security model** (v1 - Recommended)
   - RLS ensures user can only see own data
   - Data is encrypted in transit (HTTPS)
   - Data at rest uses Supabase's encryption
   - Clear privacy policy explaining this

2. **Client-side encryption** (v1.1+)
   - Encrypt transcript text before sync
   - Key derived from user's password
   - Supabase stores ciphertext only
   - Requires careful key management

3. **End-to-end encryption** (v2+)
   - Full E2E with device-specific keys
   - More complex key exchange
   - Recovery mechanism needed

**Recommended for v1**:
- [ ] Document security model clearly
- [ ] Ensure HTTPS only
- [ ] Review Supabase project settings for additional encryption options
- [ ] Add note that clipboard data never syncs (local only)

**Estimated Time**: 2-3 hours (documentation and review)

---

## P2: Nice-to-Have (Post-Launch)

### 🧪 13. Experimental Features Section

**Current State**: Vision model exists but may not be production-ready.

**Action**: Move to "Experimental" section with clear labeling.

### 🔗 14. Invite System

**Decision**: Defer. Start with open access. If overwhelmed, add simple invite codes.

### 💰 15. Monetization

**Decision**: Keep free for v1. Gather usage data to inform future pricing.

**Potential Future Models**:
- Freemium (local features free, sync requires subscription)
- Pay-once for Mac app
- Subscription for cloud features

---

## Distribution Strategy

### macOS Distribution (Website)

1. **Signed & Notarized DMG** via website download
2. **Auto-updater** using `electron-updater` (already configured for GitHub releases)
3. **Landing page** with:
   - Clear value proposition
   - Privacy-first messaging
   - Download button
   - Screenshot gallery
   - FAQ

### iOS Distribution (App Store)

1. **TestFlight** for beta testing
2. **App Store submission** with full metadata
3. **Privacy labels** accurately reflecting data usage

### Marketing Site (Minimal)

- [ ] **Single-page landing** explaining:
  - What Oscar does
  - Privacy-first approach (local transcription)
  - Download links
  - Feature highlights with screenshots

- [ ] **Blog post** explaining:
  - Why privacy matters for voice tools
  - Technical decisions (Whisper, local processing)
  - Roadmap hints

**Estimated Time**: 6-8 hours for basic site

---

## What You Can Safely Ignore for v1

Based on "senior developer perspective" - these can wait:

1. **Perfect multi-language support**: English-first is fine
2. **Advanced model customization**: Base/Small/Medium is enough
3. **Complex sync conflict resolution**: Last-write-wins is acceptable
4. **Dark mode perfection**: Light mode working is sufficient
5. **Keyboard shortcut customization beyond basics**: Current system works
6. **Offline-first architecture for iOS**: Connected mode is fine
7. **Advanced clipboard rules** (auto-delete after X days): Simple retention works
8. **Plugin/extension system**: Not needed for v1
9. **Multiple accounts on same device**: Single account is fine
10. **Comprehensive undo system**: Basic functionality is enough

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| DMG blocked by macOS | High (if unsigned) | Critical | Complete P0 #1 first |
| User confused by permissions | Medium | High | Complete P0 #2 (onboarding) |
| Clipboard data leak | Low (RLS protects) | Critical | Complete P0 #4 audit |
| API key exposed in plain file | Low | Medium | Migrate to safeStorage (P0 #5) |
| Multi-monitor bugs | Medium | Medium | Complete P0 #3 |
| iOS App Store rejection | Low | High | Follow guidelines, clear descriptions |
| Negative first impression | Medium | High | Complete P1 polish items |

---

## Implementation Buckets

### Bucket A: Security & Distribution (P0)
**Assignee**: One focused agent or engineer  
**Time**: ~6-10 hours

1. Create `scripts/notarize.js` for DMG notarization
2. Add Developer ID to electron-builder config
3. ~~Entitlements file creation~~ ✓ Already done
4. Migrate API key from preferences.json to safeStorage
5. Add API key input field to Settings UI
6. Security audit documentation

### Bucket B: Onboarding & UX (P0/P1)
**Assignee**: One focused agent or engineer  
**Time**: ~8-10 hours

1. Onboarding wizard component
2. Multi-monitor fix
3. Settings panel cleanup
4. Tooltips implementation

### Bucket C: iOS & App Store (P0)
**Assignee**: One focused agent or engineer  
**Time**: ~4-6 hours

1. Fix iOS naming (littleai → Oscar)
2. Privacy policy creation
3. App Store metadata
4. Info.plist review
5. Screenshot preparation

### Bucket D: Analytics & Feedback (P1)
**Assignee**: One focused agent or engineer  
**Time**: ~6-8 hours

1. Analytics integration
2. Feedback mechanism
3. Error tracking
4. Basic dashboard

### Bucket E: Marketing & Documentation (P1)
**Assignee**: One focused agent or engineer  
**Time**: ~6-8 hours

1. Landing page
2. Blog post
3. Help documentation
4. Privacy policy

---

## Quick Reference: Pre-Launch Checklist

```
□ P0 BLOCKERS (Must complete)
├── ◐ DMG signed and notarized (entitlements done, need notarize.js)
├── □ Onboarding wizard implemented (not started)
├── ? Multi-monitor positioning (needs testing to verify bug)
├── ◐ Security audit complete (RLS done, API key storage insecure)
├── ◐ API key handling (works but insecure storage, no Settings UI)
└── ◐ iOS App Store metadata ready (structure done, naming inconsistent)

□ P1 POLISH (Should complete)
├── □ Settings panel standardized
├── □ Tooltips added
├── □ Keyboard shortcuts viewer
├── □ Analytics implemented
├── □ Feedback mechanism
└── □ Sync security documented

□ DISTRIBUTION
├── □ macOS: Signed DMG on website
├── □ iOS: TestFlight → App Store
├── □ Landing page live
└── □ Blog post published

Legend: □ = Not started, ◐ = Partial, ✓ = Done, ? = Needs verification
```

---

## Appendix: Current Codebase State Summary

**What Already Works Well**:
- Local clipboard history with SQLite + FTS5 full-text search
- Whisper transcription integration with push-to-talk
- Mobile sync via Supabase (iOS transcripts appear in Mac clipboard history)
- Prompt stacking feature (group items by stackId, batch paste)
- Audio device priority management (Swift helper)
- Auto-updater configuration (electron-updater + GitHub Releases)
- Engineer feature (refine prompts using Anthropic API)
- Continuous Context mode (multi-screenshot capture sessions)
- Vision model support (visionModelManager.ts, visionProcessor.ts)
- Tab cycling through target apps for paste
- Password manager exclusion list (1Password, LastPass, Dashlane)
- Entitlements file with hardened runtime

**What Needs Attention**:
- Notarization script (P0 blocker - script doesn't exist)
- Onboarding flow (P0 - no implementation)
- Multi-monitor positioning (P0 - needs testing to verify bug)
- API key secure storage (P0 - currently in plain JSON, not safeStorage)
- API key Settings UI (P0 - no way for users to set their key)
- iOS naming (P0 - "littleai" should be "Oscar")
- Tooltips and discoverability (P1)
- Analytics (P1)

**Security Posture**:
- RLS policies: ✓ In place (`003_rls_policies.sql`)
- Clipboard data: ✓ Local-only (never synced to cloud)
- Mobile sync: ✓ Standard Supabase encryption with RLS
- Supabase anon key: ✓ Safe to bundle (RLS protects data)
- Anthropic API key: ⚠️ Stored insecurely in plain JSON preferences

---

*This document should be reviewed and updated as implementation progresses. Create separate task tickets or agent prompts for each bucket.*
