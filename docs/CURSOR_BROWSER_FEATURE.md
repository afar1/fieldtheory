# Cursor Browser Integration

This feature adds a persistent browser view to the Oscar iOS app, allowing you to send transcribed voice notes directly to Cursor's agent dashboard.

## Overview

The integration works by embedding a WebView that stays logged into Cursor's agent dashboard. After transcribing audio locally, you can tap "Send to Cursor" to:
1. Paste the transcription into Cursor's input field
2. Switch to the browser view where you can select a model and hit go

This creates a powerful workflow: **local transcription → cloud AI agent**.

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Oscar iOS App                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐│
│  │ Transcripts │  │   Tasks     │  │   Observations        ││
│  └─────────────┘  └─────────────┘  └───────────────────────┘│
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Cursor Browser (WebView)                  │  │
│  │   - Persistent session (stays logged in)               │  │
│  │   - Desktop user agent for full UI                     │  │
│  │   - JavaScript injection for text paste                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

1. **CursorBrowser Component** (`components/CursorBrowser.tsx`)
   - Persistent WebView with session storage
   - Exposes `pasteText(text)` method via ref
   - Navigation bar with back/forward/reload/home
   - Error handling and retry UI

2. **Send to Cursor Action** (in transcript cards)
   - Each transcription has a "Send to Cursor" button
   - Tapping it pastes text and switches to browser tab

### Session Persistence

The WebView maintains cookies and localStorage between app sessions, so:
- You only need to log into Cursor once
- Sessions persist until Cursor's auth tokens expire
- No need to re-authenticate each time you open the app

## Usage

### First-Time Setup

1. Open the Oscar app
2. Tap the terminal icon in the bottom nav to open Cursor browser
3. Log in to your Cursor account (if not already logged in)
4. The session will be saved automatically

### Sending Transcriptions to Cursor

1. Record audio using the mic button
2. Wait for local transcription to complete
3. On any transcript card, tap **"Send to Cursor"**
4. The app switches to the Cursor browser with your text pasted
5. Select your model and tap send

### Navigation

The bottom nav now includes:
- **File icon**: Transcripts
- **Check icon**: Tasks
- **Eye icon**: Observations
- **Terminal icon**: Cursor browser
- **Settings icon**: Settings

## Technical Notes

### Why Not BrowserBase?

We initially considered BrowserBase for spinning up browser instances, but decided against it because:

1. **Simpler architecture**: A native WebView is lighter weight
2. **Better session persistence**: WebView cookies persist locally
3. **No external dependencies**: Works offline after login
4. **Faster**: No need to spin up cloud browsers

### WebView Configuration

The WebView uses several important settings:
- `sharedCookiesEnabled`: Shares cookies with system for OAuth
- `thirdPartyCookiesEnabled`: Required for auth flows
- `domStorageEnabled`: Persists localStorage
- Desktop user agent: Shows full Cursor UI (not mobile)

### JavaScript Injection

Text is pasted into Cursor's input via JavaScript injection:
```javascript
// Find the chat input (textarea or contenteditable)
const input = document.querySelector('textarea, [contenteditable="true"]');
input.value = transcribedText;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.focus();
```

## Troubleshooting

### "Unable to load Cursor" error
- Check your internet connection
- Tap "Retry" to reload the page
- Try the external link button to open in Safari

### Session expired / logged out
- This happens when Cursor's auth tokens expire
- Simply log in again - the new session will persist

### Text not pasting correctly
- The paste relies on finding Cursor's input field
- If Cursor updates their UI, the selectors may need updating
- Report issues so we can update the injection script

## Future Improvements

Potential enhancements:
- Add "auto-send" option to automatically submit after paste
- Support for other AI agent dashboards (Claude, ChatGPT)
- Deep linking to specific Cursor conversations
- Offline queue for pending sends
