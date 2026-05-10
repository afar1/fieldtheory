#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run typecheck
npm run test:mobile-regressions
npx expo-doctor
npm audit --omit=dev --audit-level=high
if command -v deno >/dev/null 2>&1; then
  deno check --no-lock supabase/functions/process-transcription/index.ts
else
  npx --yes deno check --no-lock supabase/functions/process-transcription/index.ts
fi
plutil -lint ios/littleai/Info.plist ios/littleai/PrivacyInfo.xcprivacy ios/LittleAIKeyboard/Info.plist
git diff --check
