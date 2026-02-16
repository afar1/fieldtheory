#!/bin/bash
# Hot Mic hook for Claude Code.
# Triggers Field Theory to start a Hot Mic listening cycle when Claude goes idle.
# Register in ~/.claude/settings.json under hooks.Notification with matcher: "idle_prompt"
curl -s http://127.0.0.1:19847/hotmic/start > /dev/null 2>&1
