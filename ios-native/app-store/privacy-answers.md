# App Privacy draft — native iOS app

These answers describe the Voice-only native iOS build, not all Field Theory
products. Review and save them in App Store Connect separately from the bundled
privacy manifest.

| Data type | Collected | Linked to identity | Purpose | Tracking |
| --- | --- | --- | --- | --- |
| Email address | Yes, for email authentication/account support | Yes | App functionality | No |
| User ID | Yes, for the Supabase account that authenticates Voice sync | Yes | App functionality | No |
| Other user content | Yes, locally created or edited Voice transcript text and stack metadata when the user signs in | Yes | App functionality | No |
| Audio recordings | No off-device collection in the native recording path | — | On-device transcription | No |

The native app has no advertising or analytics SDK and does not request App
Tracking Transparency permission. Do not select “Data Not Collected”: account
and optional authenticated Voice sync send the listed data to Supabase.

The speech model downloads from Hugging Face over HTTPS; cached/downloaded files
are checksum-verified and excluded from backup. Queued recordings are local and
removed on explicit sign-out; raw-audio queues are excluded from backup. Verify
provider operational logs before finalizing retention claims. The website uses
Vercel Analytics separately from the native binary.

Required-reason API declaration in the app's manifest: UserDefaults, reason
CA92.1 (app-only preferences). Inspect the archived privacy report including
third-party SDK manifests before submitting. The app manifest is not a
substitute for App Store Connect's privacy questionnaire.

Published policy: [Field Theory Privacy](https://www.fieldtheory.dev/privacy.html).
Apple reference: [App privacy details](https://developer.apple.com/app-store/app-privacy-details/).
