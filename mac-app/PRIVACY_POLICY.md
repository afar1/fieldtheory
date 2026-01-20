# Field Theory Privacy Policy

**Last Updated:** January 19, 2026

Field Theory is a privacy-first voice transcription and clipboard management application. This policy explains how your data is handled.

---

## Our Core Principle

**Your data stays on your device by default.** We built Field Theory to be useful without requiring cloud accounts, internet connectivity, or data collection.

---

## Data That Never Leaves Your Device

The following data is stored locally and processed entirely on your device:

| Data Type | Storage | Purpose |
|-----------|---------|---------|
| Voice recordings | Processed in memory, not saved | Transcription via local Whisper AI model |
| Clipboard history | Local SQLite database | Quick access to recent copies |
| Screenshots (Continuous Context) | Local SQLite database | Context capture for AI features |
| Transcriptions | Local SQLite database | Your transcribed text |
| Preferences | Local JSON file | App settings |

**We do not have access to this data. It never leaves your Mac.**

---

## Optional Cloud Features

### iOS Sync (Optional)

If you choose to create an account and enable sync on iOS:

- Transcriptions, tasks, and observations sync via Supabase (our backend provider)
- Data is encrypted in transit (TLS) and at rest
- You can delete your account and all synced data at any time
- Sync is **off by default** and requires explicit opt-in

### Engineer Feature (Optional)

If you use the "Engineer" feature to refine prompts:

- The text you select is sent to Anthropic's Claude API
- This requires you to provide your own Anthropic API key
- Anthropic's privacy policy applies to data sent to their service
- This feature is **opt-in** and only activates when you explicitly invoke it

---

## Usage Metrics (Visible to You)

If you have an account, we collect feature usage counts to understand which features provide value. **The metrics you can see in Settings are the only metrics we collect.** Nothing is hidden.

### What We Track

- **Counts only** — Number of transcriptions, pastes, screenshots, etc.
- **No content** — We never see your clipboard text, transcription audio, or screenshot images
- **Your Stats** — View your own metrics anytime in Settings → Your Stats

### What We Don't Track

| Never Collected | Stays On Your Device |
|-----------------|---------------------|
| Clipboard content | Stored locally only |
| Transcription text/audio | Processed and stored locally |
| Screenshot images | Local database only |
| Auto-improved text | Uses your API key, we never see it |
| Session timing or patterns | Not tracked |
| What you do in other apps | Not visible to us |

---

## What We Don't Do

- **No content collection** — We only see counts, never the actual content
- **No advertising** — No ads, no ad tracking, no selling data
- **No account required** — Full functionality without signing up
- **No background data collection** — The app only processes data when you actively use it
- **No third-party analytics** — No Mixpanel, Amplitude, or similar services

---

## Third-Party Services

| Service | When Used | Data Shared | Their Privacy Policy |
|---------|-----------|-------------|---------------------|
| Anthropic (Claude) | Engineer feature only | Text you explicitly send | [anthropic.com/privacy](https://www.anthropic.com/privacy) |
| Supabase | iOS sync only | Synced transcriptions/tasks | [supabase.com/privacy](https://supabase.com/privacy) |
| Apple | App distribution | Standard App Store data | [apple.com/privacy](https://www.apple.com/privacy/) |

---

## Your Rights

You have full control over your data:

- **Access**: All local data is stored in standard formats you can inspect
- **Delete**: Uninstalling the app removes all local data
- **Export**: Clipboard history and transcriptions are stored in SQLite (standard format)
- **Opt-out**: Cloud features are optional and can be disabled at any time

---

## Security

- Voice processing happens entirely on-device using the Whisper AI model
- API keys are stored in your system keychain (macOS Keychain)
- No sensitive data is logged or transmitted for debugging
- Clipboard monitoring excludes password managers by default

---

## Children's Privacy

Field Theory is not directed at children under 13. We do not knowingly collect data from children.

---

## Changes to This Policy

We'll update this policy if our data practices change. The "Last Updated" date at the top reflects the most recent revision.

---

## Contact

Questions about this privacy policy?

- **Email**: [your-email@example.com]
- **GitHub**: [github.com/afar1/field-theory](https://github.com/afar1/field-theory)

---

*Field Theory is open source. You can audit our code to verify these privacy claims.*

