#!/usr/bin/env python3
"""
PreToolUse Auto-Approve Hook for Field Theory

Auto-approves Read/Write/Edit operations for:
- ~/.fieldtheory/librarian/* (librarian artifacts and jobs)
- ~/Library/Application Support/fieldtheory-mac/users/<id>/figures/* (screenshot figures)
- .cursor/commands/* (portable commands)

Works with both tools by handling their different tool naming conventions:
- Claude Code: Read, Write, Edit
- Cursor: read_file, write_new_file, file_str_replace, edit_file

Note: This hook runs regardless of whether librarian is enabled.
The librarian config only controls artifact creation, not this hook.

Setup: Run .claude/hooks/setup.sh to install these hooks.
"""
import json
import sys
from pathlib import Path


def main():
    try:
        input_data = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    # Claude Code: Read, Write, Edit
    # Cursor: read_file, write_new_file, file_str_replace, edit_file
    file_tools = {"Read", "Write", "Edit", "read_file", "write_new_file", "file_str_replace", "edit_file"}

    if tool_name in file_tools:
        # Get file path - different field names possible
        file_path = tool_input.get("file_path") or tool_input.get("path") or tool_input.get("target_file") or ""

        # Paths to auto-approve (absolute paths)
        approved_prefixes = [
            # Librarian directory (artifacts, jobs, config)
            str(Path.home() / ".fieldtheory" / "librarian"),
        ]

        # Patterns to match within paths
        approved_patterns = [
            # Per-user figures: .../fieldtheory-mac/users/<id>/figures/...
            ("fieldtheory-mac", "/figures/"),
            # Portable commands (any project)
            (".cursor/commands", None),
        ]

        # Check absolute prefix matches
        for prefix in approved_prefixes:
            if file_path.startswith(prefix):
                print(json.dumps({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "allow"
                    }
                }))
                sys.exit(0)

        # Check pattern matches
        for pattern in approved_patterns:
            if len(pattern) == 2 and pattern[1] is not None:
                # Must contain both parts
                if pattern[0] in file_path and pattern[1] in file_path:
                    print(json.dumps({
                        "hookSpecificOutput": {
                            "hookEventName": "PreToolUse",
                            "permissionDecision": "allow"
                        }
                    }))
                    sys.exit(0)
            else:
                # Just check first part with path segment boundaries
                segment = "/" + pattern[0] + "/"
                if segment in file_path:
                    print(json.dumps({
                        "hookSpecificOutput": {
                            "hookEventName": "PreToolUse",
                            "permissionDecision": "allow"
                        }
                    }))
                    sys.exit(0)

    # Default: don't interfere, let normal permission flow happen
    sys.exit(0)


if __name__ == "__main__":
    main()
