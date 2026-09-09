# Field Theory App Store preparation

This directory contains local submission drafts. Nothing here has been uploaded
to App Store Connect. App Store Connect CLI (`asc`) is installed; API and web
credentials still need configuration before remote account state can be checked.

## Candidate and phone acceptance

`../scripts/prepare-phone-candidate.sh /absolute/new-output-directory` builds a
Release archive using existing local signing credentials. It records version,
build, source commit, executable hashes, and signature verification. It does not
install on a device, request new provisioning, export for App Store distribution,
upload, or submit. The next candidate must be **1.0 (3)** or later; the earlier
1.0 (2) candidate does not represent the Voice-only launch scope.

After the user is home and requests installation, install that exact app through
Xcode or `xcrun devicectl device install app --device <device-id> <app-path>`.
Confirm Settings shows the candidate's version/build and short source commit.

Phone acceptance:

1. Fresh launch: email sign-in and clearly labeled Reviewer Demo are accessible;
   Privacy Policy opens the published site. Voice opens directly, with Settings;
   Library, River, and Goals are absent from public navigation.
2. Demo: inspect, edit, select, stack, separate, and copy sample Voice
   transcripts; record after model download. Exit demo and confirm its sample
   Voice data never appears in the real account.
3. Real account: sign in by email, record/edit a Voice transcript, and verify the
   Voice upload acknowledgement and retry behavior agreed for this release; account acknowledgement does not prove another client received it.
4. Voice: record, lock/unlock, resume, and stop. Confirm transcript text and any
   explicitly enabled clipboard copy. Deny microphone access once and verify the
   error and retry path. Background audio needs this physical-device test.
5. Sign out with a recording/transcription queued. Reopen and sign in again;
   queued audio must not return or deliver a late transcript into another account.
6. Delete Account only on a disposable test account after the backend deployment
   and cleanup canary are approved. Failure must remain visible; sign-out is not
   proof of server deletion.

## Submission drafts

- `metadata/`: canonical `asc metadata` JSON for English app info/version 1.0.
  Validate with `asc metadata validate --dir ios-native/app-store/metadata --check-urls`.
  The support URL is the published policy/contact page, which contains the
  support email. A dedicated support page can replace it later.
- `privacy-answers.md`: proposed App Privacy answers, distinct from the binary's
  `PrivacyInfo.xcprivacy`; confirm the production services before saving to Apple.
- `../../docs/IOS_REVIEWER_ACCESS_AND_ACCOUNT_DELETION.md`: reviewer instructions
  and the backend deletion release dependency.

Before submission, configure the App Store Connect app record and verify bundle
ID `com.afar1.fieldtheory`, current version/build availability, developer
agreements, distribution signing, category, age rating, pricing/territories,
export compliance, review contact, and full reviewer access to live account/sync
functions. A local demo helps review but does not prove Apple will waive live
account access.

Screenshots must show the actual Voice-only app. Supply iPhone 6.9-inch and iPad
13-inch sets. Current accepted sizes include 1320×2868 for iPhone 17 Pro Max and
2064×2752 for 13-inch iPad Pro, without alpha channels. Do not describe
simulator screenshots as physical-device testing.

Sources checked September 6, 2026:

- [Apple submission requirements](https://developer.apple.com/app-store/submitting/)
- [Review guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
