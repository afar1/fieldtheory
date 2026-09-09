#!/bin/bash
# Builds and archives locally. Never installs, provisions, uploads, or submits.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT_ROOT="${1:?Usage: prepare-phone-candidate.sh /absolute/new-output-directory}"
case "$OUTPUT_ROOT" in /*) ;; *) echo 'Output directory must be absolute.' >&2; exit 2;; esac
if [ -e "$OUTPUT_ROOT" ]; then
  echo 'Choose a new output directory; existing artifacts will not be overwritten.' >&2
  exit 2
fi
cd "$REPO_ROOT"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo 'Commit tracked source changes before preparing an identifiable candidate.' >&2
  exit 2
fi
mkdir -p "$OUTPUT_ROOT"
SOURCE_COMMIT="$(git rev-parse HEAD)"
SHORT_COMMIT="$(git rev-parse --short=12 HEAD)"
xcodegen generate --spec ios-native/project.yml > "$OUTPUT_ROOT/project-generation.log" 2>&1
xcodebuild -project ios-native/FieldTheory.xcodeproj -scheme FieldTheory \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath "$OUTPUT_ROOT/DerivedData" \
  -archivePath "$OUTPUT_ROOT/FieldTheory.xcarchive" \
  "FT_BUILD_COMMIT=$SHORT_COMMIT" archive > "$OUTPUT_ROOT/archive.log" 2>&1
APP_PATH="$OUTPUT_ROOT/FieldTheory.xcarchive/Products/Applications/FieldTheory.app"
codesign --verify --deep --strict "$APP_PATH"
codesign -dvv "$APP_PATH" > "$OUTPUT_ROOT/signing.txt" 2>&1
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Info.plist"
test -f "$APP_PATH/PrivacyInfo.xcprivacy"
test ! -f "$APP_PATH/goals-cards.json"
python3 - "$OUTPUT_ROOT" "$SOURCE_COMMIT" "$APP_PATH" <<'PY'
import hashlib,json,plistlib,sys
from pathlib import Path
out,commit,app=Path(sys.argv[1]),sys.argv[2],Path(sys.argv[3])
info=plistlib.loads((app/'Info.plist').read_bytes())
record={'sourceCommit':commit,'bundleID':info['CFBundleIdentifier'],'version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],'embeddedCommit':info['FTBuildCommit'],'appPath':str(app),'purpose':'Development-signed phone test candidate; not an App Store export','installed':False,'uploaded':False,'files':{}}
for p in [app/'FieldTheory',app/'PrivacyInfo.xcprivacy']:
    record['files'][str(p.relative_to(app))]=hashlib.sha256(p.read_bytes()).hexdigest()
(out/'candidate.json').write_text(json.dumps(record,indent=2)+'\n')
PY
printf 'Candidate prepared: %s\n' "$APP_PATH"
