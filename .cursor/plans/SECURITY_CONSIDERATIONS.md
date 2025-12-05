# Oscar Security Considerations

> A focused analysis of security concerns for a voice transcription and clipboard management app.

---

## Data Classification

### Local-Only Data (Never Leaves Device)
| Data Type | Storage | Encryption | Retention |
|-----------|---------|------------|-----------|
| Clipboard history | SQLite (`~/Library/Application Support/Oscar/clipboard.db`) | None (file system permissions only) | Configurable, default unlimited |
| Screenshots | SQLite (blob) | None | Same as clipboard |
| Continuous Context captures | SQLite (blob) | None | Same as clipboard |
| Audio recordings | Not stored (streaming to Whisper) | N/A | Never persisted |
| Preferences | JSON file | None | Permanent |
| Anthropic API key | JSON file (`preferences.json`) | **None - INSECURE** | Permanent |

**Risk Assessment**: Low for most data. **Medium for API key** - stored in plain text.

**Recommendation**: 
- Document local storage clearly
- **Migrate API key to Electron safeStorage (OS keychain)**
- Consider SQLCipher for v1.1+ if users request it

---

### Cloud-Synced Data (Supabase)
| Data Type | When Synced | Encryption In Transit | Encryption At Rest |
|-----------|-------------|----------------------|-------------------|
| Transcripts (iOS) | Auto (30s interval) | HTTPS/TLS | Supabase default (PostgreSQL) |
| Tasks/Observations | On "Separate into Tasks" action | HTTPS/TLS | Supabase default |
| User profiles | On account creation | HTTPS/TLS | Supabase default |

**Risk Assessment**: Medium. Data is readable by anyone with database access (you as developer, Supabase staff). RLS prevents cross-user access.

**Recommendation**: Document clearly. Consider client-side encryption for v1.1+.

### External API Data (Anthropic)
| Data Type | When Sent | Encryption In Transit | Retention |
|-----------|-----------|----------------------|-----------|
| Prompt stack content | On "Engineer" action | HTTPS/TLS | Per Anthropic's policies |
| Screenshots (in stacks) | On "Engineer" action | HTTPS/TLS | Per Anthropic's policies |

**Risk Assessment**: Medium. User explicitly triggers action. Content subject to Anthropic's data policies.

**Recommendation**: 
- Document that Engineer feature sends data to Anthropic
- Users should review Anthropic's privacy policy
- Consider adding confirmation dialog for sensitive content

---

## Current Security Controls

### 1. Row-Level Security (RLS)

**Status**: ✅ Implemented in `003_rls_policies.sql`

```sql
-- Each user can only access their own rows
create policy "transcripts owner" on public.transcripts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**Verification**: 
- All tables have RLS enabled
- All CRUD operations require `auth.uid() = user_id`
- No service role key exposed to client

### 2. Authentication

**Status**: ✅ Using Supabase Auth

- Email/password authentication
- JWT tokens with short expiry
- Refresh token rotation enabled
- No anonymous access to sensitive tables

### 3. Input Sanitization

**Status**: ⚠️ Review Needed

- AppleScript calls use `execFile` (good for command injection protection)
- User input in transcripts stored as-is (acceptable for text)
- Bundle ID validation exists for paste targets

---

## Threat Model

### Threat 1: Clipboard Contains Sensitive Data
**Scenario**: User copies password, API key, or sensitive document content.

**Current Mitigation**:
- Clipboard data is LOCAL ONLY - never synced to cloud
- Data visible only to user's Mac user account
- Password manager exclusion list implemented (1Password, LastPass, Dashlane)

**Enhanced Mitigation (P1)**:
- [ ] Add "sensitive content" detection for known patterns (API keys, passwords)
- [ ] Configurable auto-delete for sensitive items
- [x] Password manager app exclusion list ✓ Already implemented

### Threat 2: Transcription Contains Private Information
**Scenario**: User dictates sensitive info that syncs to cloud.

**Current Mitigation**:
- RLS prevents other users from seeing data
- User explicitly initiates "Separate into Tasks"

**Enhanced Mitigation (Future)**:
- Client-side encryption before sync
- Local-only mode option

### Threat 3: Man-in-the-Middle Attack
**Scenario**: Attacker intercepts sync traffic.

**Current Mitigation**:
- HTTPS/TLS for all Supabase communication
- Certificate pinning via Supabase SDK

**Status**: ✅ Adequately protected

### Threat 4: Stolen Device
**Scenario**: Mac/iPhone with app data is stolen.

**Current Mitigation (Mac)**:
- FileVault (if enabled by user) encrypts disk
- App follows standard macOS permissions

**Current Mitigation (iOS)**:
- iOS Data Protection encrypts at rest when locked
- Keychain for sensitive tokens

**Status**: ✅ Relying on OS-level protection (industry standard)

### Threat 5: Malicious App Update
**Scenario**: Compromised update pushes malicious code.

**Current Mitigation**:
- GitHub Releases for distribution (requires GitHub account access)
- electron-updater verifies signatures

**Enhanced Mitigation**:
- [ ] Enable macOS code signature verification in updater
- [ ] Implement update hash verification

### Threat 6: Supabase Account Compromise
**Scenario**: Your Supabase account or project is compromised.

**Impact**: All user data exposed.

**Mitigation**:
- Enable MFA on Supabase account
- Limit team access
- Regular access audits
- For sensitive users: document that E2E encryption would prevent this

### Threat 7: Engineer Feature Exposes Sensitive Content
**Scenario**: User triggers "Engineer" on a prompt stack containing sensitive data.

**Data Flow**:
1. User selects items in clipboard history
2. Clicks "Engineer" button
3. `promptEngineer.ts` sends content to Anthropic API
4. Anthropic processes and returns refined prompt

**Current Mitigation**:
- User explicitly initiates action (not automatic)
- Content sent only to Anthropic, not stored elsewhere
- User provides their own API key (controls their own costs/access)

**Risks**:
- Sensitive clipboard content could be sent to Anthropic
- Anthropic's data retention policies apply

**Enhanced Mitigation (P1)**:
- [ ] Add warning before engineering content with detected sensitive patterns
- [ ] Document that Engineer feature sends data to Anthropic

### Threat 8: Continuous Context Captures Sensitive Screen Content
**Scenario**: Continuous Context mode captures screenshots containing passwords, financial data, etc.

**Data Flow**:
1. User activates Continuous Context mode
2. App captures region screenshots at intervals
3. Screenshots stored in local clipboard history (SQLite blob)
4. Screenshots can be included in prompt stacks

**Current Mitigation**:
- Screenshots are LOCAL ONLY - never synced to cloud
- User must explicitly activate the mode
- User controls which region is captured

**Risks**:
- Sensitive screen content stored in unencrypted SQLite
- If user engineers a stack with screenshots, content goes to Anthropic

**Enhanced Mitigation (P1)**:
- [ ] Add clear indicator when Continuous Context is active
- [ ] Auto-pause on password manager windows (if detectable)

### Threat 9: Vision Model Processes Sensitive Images
**Scenario**: Vision processor analyzes screenshots containing sensitive data.

**Current State**: Vision model support exists (`visionModelManager.ts`, `visionProcessor.ts`) but usage unclear.

**Mitigation**:
- Vision processing should be local-only
- Document what vision model does with images

---

## API Key Handling

### Supabase Anon Key
**Status**: ✅ Safe to Bundle

The anon key is designed to be public. RLS policies protect data, not the key.

```javascript
// This is safe - key is in bundled app
const supabase = createClient(url, anonKey);
```

### Anthropic API Key (for LLM features)
**Status**: ⚠️ Implemented but INSECURE

**Current Implementation**:
- API key stored in `preferences.ts` as `anthropicApiKey`
- Storage location: `~/Library/Application Support/Oscar/preferences.json` (plain JSON)
- Used by: `promptEngineer.ts` for Engineer feature (prompt refinement)
- Fallback: `process.env.ANTHROPIC_API_KEY`

**Security Issue**: Key stored in plain text, readable by any process with file access.

**Required Fix** - Migrate to safeStorage:
```typescript
// Store in Electron safeStorage (OS keychain)
import { safeStorage } from 'electron';

const encryptedKey = safeStorage.encryptString(apiKey);
// Store encryptedKey (as base64) in preferences
const decryptedKey = safeStorage.decryptString(encryptedKey);
```

**Additional Issue**: No Settings UI exists for users to set their API key.

**Backend Proxy Option** (Post-v1):
- Authenticated requests through your server
- Server makes API calls with your key
- Requires usage tracking and rate limits

---

## Security Checklist for Release

### P0 (Must Have)
- [ ] Verify DMG is code-signed with valid Developer ID
- [ ] Verify notarization is complete (no Gatekeeper blocks)
- [x] Review all RLS policies work correctly ✓
- [x] Ensure no hardcoded API keys in source ✓ (user provides key)
- [x] Verify clipboard data NEVER syncs to cloud ✓
- [ ] **Migrate API key from JSON to safeStorage**
- [ ] **Add API key input in Settings UI**
- [ ] Document security model in privacy policy

### P1 (Should Have)
- [ ] Add sensitive content detection for clipboard
- [x] ~~Implement API key storage via safeStorage~~ (moved to P0)
- [ ] Add "Clear All Data" option in settings
- [ ] Document data retention and deletion policies
- [ ] Document that Engineer feature sends data to Anthropic

### P2 (Future)
- [ ] Client-side encryption for synced transcripts
- [ ] Optional SQLCipher for local database
- [ ] Security audit by third party
- [ ] Confirmation dialog before engineering sensitive content

---

## Privacy Policy Requirements

Your privacy policy must clearly state:

1. **What data is collected**:
   - Transcription text (stored locally and optionally synced)
   - Clipboard history (LOCAL ONLY - never transmitted)
   - Usage analytics (if implemented - describe what)

2. **Where data is stored**:
   - Local: User's device only
   - Cloud: Supabase (US-based hosting, specify region)

3. **Who can access data**:
   - Local data: Only the user
   - Synced data: User via authentication, no admin access to content

4. **Data retention**:
   - Local: User-controlled
   - Cloud: Until user deletes account

5. **Third-party services**:
   - Supabase for cloud sync (optional)
   - Anthropic for LLM features (optional, user's own key)
     - Engineer feature sends prompt content to Anthropic API
     - Screenshots in prompt stacks may be sent if engineered

---

## Secure Development Practices

### For Code Reviews

1. **Never log sensitive data**:
```typescript
// BAD
console.log('Transcript:', transcriptText);

// GOOD
console.log('[Transcription] Processing complete, length:', transcriptText.length);
```

2. **Validate external input**:
```typescript
// Validate bundle IDs before using in AppleScript
if (bundleId.includes('"') || bundleId.includes("'")) {
  console.error('Invalid bundleId');
  return false;
}
```

3. **Use parameterized queries** (SQLite):
```typescript
// GOOD - parameterized
db.prepare('SELECT * FROM clipboard_items WHERE id = ?').get(id);

// BAD - string interpolation
db.prepare(`SELECT * FROM clipboard_items WHERE id = ${id}`);
```

---

## Summary: What You Need to Know

### Things That Are Already Secure
1. RLS policies properly isolate user data
2. Clipboard history is local-only by design
3. Supabase uses HTTPS for all communication
4. Audio is not stored (streamed to Whisper)
5. Password manager apps excluded from clipboard capture

### Things That Need Attention for v1
1. DMG must be signed and notarized (trust issue, not security)
2. **Anthropic API key stored insecurely** - migrate to safeStorage
3. **No Settings UI for API key** - users can't easily configure
4. Document the security model clearly in privacy policy
5. Document that Engineer feature sends data to Anthropic

### Things You Can Defer
1. Client-side encryption for synced data
2. SQLCipher for local database
3. Advanced audit logging
4. Third-party security audit
5. Sensitive content detection in clipboard

---

*This document should be reviewed by someone with security expertise before making public claims about security properties.*
