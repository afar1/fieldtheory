#!/bin/bash
#
# Setup script for Field Theory Claude Code hooks
#
# This script:
# 1. Copies the pretool hook to ~/.claude/
# 2. Updates ~/.claude/settings.json to register the hook
#
# Run from anywhere: bash /path/to/fieldtheory/.claude/hooks/setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
HOOK_DEST="$CLAUDE_DIR/fieldtheory-pretool.py"

echo "Setting up Field Theory Claude Code hooks..."

# Ensure ~/.claude exists
mkdir -p "$CLAUDE_DIR"

# Copy the pretool hook
cp "$SCRIPT_DIR/pretool.py" "$HOOK_DEST"
chmod +x "$HOOK_DEST"
echo "Copied pretool hook to $HOOK_DEST"

# Update settings.json
if [ -f "$SETTINGS_FILE" ]; then
    # Check if hook is already registered
    if grep -q "fieldtheory-pretool.py" "$SETTINGS_FILE"; then
        echo "Hook already registered in settings.json"
    else
        echo "Updating settings.json to register hook..."
        # Use Python to safely merge JSON (jq alternative that's always available)
        python3 << 'PYTHON'
import json
import sys
from pathlib import Path

settings_file = Path.home() / ".claude" / "settings.json"
hook_path = str(Path.home() / ".claude" / "fieldtheory-pretool.py")

try:
    with open(settings_file, 'r') as f:
        settings = json.load(f)
except:
    settings = {}

# Ensure hooks structure exists
if "hooks" not in settings:
    settings["hooks"] = {}

# Add PreToolUse hook
pretool_hook = {
    "matcher": "Read|Write|Edit",
    "hooks": [{
        "type": "command",
        "command": f'python3 "{hook_path}"'
    }]
}

if "PreToolUse" not in settings["hooks"]:
    settings["hooks"]["PreToolUse"] = [pretool_hook]
else:
    # Check if our hook is already there
    existing = settings["hooks"]["PreToolUse"]
    has_our_hook = any("fieldtheory-pretool.py" in str(h) for h in existing)
    if not has_our_hook:
        existing.append(pretool_hook)

with open(settings_file, 'w') as f:
    json.dump(settings, f, indent=2)

print("Hook registered successfully")
PYTHON
    fi
else
    echo "Creating settings.json..."
    python3 << 'PYTHON'
import json
from pathlib import Path

settings_file = Path.home() / ".claude" / "settings.json"
hook_path = str(Path.home() / ".claude" / "fieldtheory-pretool.py")

settings = {
    "hooks": {
        "PreToolUse": [{
            "matcher": "Read|Write|Edit",
            "hooks": [{
                "type": "command",
                "command": f'python3 "{hook_path}"'
            }]
        }]
    }
}

with open(settings_file, 'w') as f:
    json.dump(settings, f, indent=2)

print("Created settings.json with hook")
PYTHON
fi

echo ""
echo "Setup complete! The following paths are now auto-approved for Read/Write/Edit:"
echo "  - ~/.fieldtheory/librarian/* (librarian artifacts)"
echo "  - ~/Library/Application Support/fieldtheory-mac/figures/* (screenshots)"
echo "  - .cursor/commands/* (portable commands)"
