import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from './logger';
import type { AgentTool } from './types/agentAttention';

const log = createLogger('AgentHookInstaller');

// =============================================================================
// AgentHookInstaller - Installs Stop / UserPromptSubmit / SessionEnd hooks into
// the user's Claude Code (~/.claude/settings.json) and Codex (~/.codex/hooks.json)
// configs. The hook scripts write/delete JSON snapshots under
// ~/.fieldtheory/agents/state/ which the AgentAttentionManager watches.
//
// Coexists with any existing hooks (notably the Librarian Stop hook). Matches
// only on the Field Theory hook script paths when installing/removing.
// =============================================================================

type HookEntry = {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout_sec?: number }>;
};

type HookConfig = {
  hooks?: Record<string, HookEntry[]>;
};

const HOOKS_DIR = path.join(os.homedir(), '.fieldtheory', 'agents', 'hooks');
const STATE_DIR = path.join(os.homedir(), '.fieldtheory', 'agents', 'state');

const HOOK_EVENTS = ['Stop', 'UserPromptSubmit', 'SessionEnd'] as const;
type HookEvent = typeof HOOK_EVENTS[number];

export interface InstallTargets {
  claude?: boolean;
  codex?: boolean;
}

export interface InstallStatus {
  claude: boolean;
  codex: boolean;
}

export interface InstallResult {
  success: boolean;
  message: string;
  claude: boolean;
  codex: boolean;
}

// ---------------------------------------------------------------------------
// Script generators
// ---------------------------------------------------------------------------

export function generateAgentStopScript(tool: AgentTool): string {
  return `#!/usr/bin/env python3
"""Field Theory agent Stop hook for ${tool}.
Writes a snapshot JSON so the Dynamic Island can show a waiting-agent glyph.
"""
import json, os, sys, time
from pathlib import Path

STATE_DIR = Path.home() / ".fieldtheory" / "agents" / "state"
TOOL = "${tool}"

def map_terminal(term_program):
    mapping = {
        "iTerm.app": "iTerm2",
        "Apple_Terminal": "Terminal",
        "ghostty": "Ghostty",
        "WarpTerminal": "Warp",
        "vscode": "Code",
        "Cursor": "Cursor",
    }
    return mapping.get(term_program, term_program or "Terminal")

def main():
    try:
        payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    except Exception:
        payload = {}

    session_id = payload.get("session_id") or f"{TOOL}-{os.getppid()}"
    agent_id = f"{TOOL}-{session_id}"
    cwd = payload.get("cwd") or os.getcwd()
    term_program = os.environ.get("TERM_PROGRAM", "")
    terminal_app = map_terminal(term_program)
    tty_title = f"{TOOL} \u2014 {os.path.basename(cwd) or '/'}"

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_file = STATE_DIR / f"{agent_id}.json"
    tmp_file = STATE_DIR / f".{agent_id}.tmp"
    data = {
        "agentId": agent_id,
        "tool": TOOL,
        "pid": os.getppid(),
        "cwd": cwd,
        "ttyTitle": tty_title,
        "terminalApp": terminal_app,
        "waitingSince": int(time.time() * 1000),
    }
    tmp_file.write_text(json.dumps(data))
    tmp_file.replace(state_file)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
`;
}

export function generateAgentClearScript(tool: AgentTool): string {
  return `#!/usr/bin/env python3
"""Field Theory agent clear hook for ${tool}.
Removes the waiting-agent snapshot when the user resumes or the session ends.
"""
import json, os, sys
from pathlib import Path

STATE_DIR = Path.home() / ".fieldtheory" / "agents" / "state"
TOOL = "${tool}"

def main():
    try:
        payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    except Exception:
        payload = {}
    session_id = payload.get("session_id") or f"{TOOL}-{os.getppid()}"
    agent_id = f"{TOOL}-{session_id}"
    state_file = STATE_DIR / f"{agent_id}.json"
    try:
        state_file.unlink()
    except FileNotFoundError:
        pass

if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
`;
}

// ---------------------------------------------------------------------------
// Hook config merging (shared between Claude and Codex — same schema)
// ---------------------------------------------------------------------------

function hookEntryMatchesCommand(entry: HookEntry, commandSubstring: string): boolean {
  return !!entry.hooks?.some(h => typeof h.command === 'string' && h.command.includes(commandSubstring));
}

export function upsertHook(
  config: HookConfig,
  event: HookEvent,
  command: string,
  matchSubstring: string
): void {
  if (!config.hooks) config.hooks = {};
  const hooks = config.hooks;
  const list = Array.isArray(hooks[event]) ? hooks[event] : [];
  const filtered = list.filter(entry => !hookEntryMatchesCommand(entry, matchSubstring));
  filtered.push({ hooks: [{ type: 'command', command }] });
  hooks[event] = filtered;
}

export function removeHook(
  config: HookConfig,
  event: HookEvent,
  matchSubstring: string
): void {
  if (!config.hooks || !Array.isArray(config.hooks[event])) return;
  const filtered = config.hooks[event].filter(
    entry => !hookEntryMatchesCommand(entry, matchSubstring)
  );
  if (filtered.length > 0) {
    config.hooks[event] = filtered;
  } else {
    delete config.hooks[event];
  }
  if (Object.keys(config.hooks).length === 0) {
    delete config.hooks;
  }
}

export function hookInstalled(
  config: HookConfig,
  event: HookEvent,
  matchSubstring: string
): boolean {
  return !!config.hooks?.[event]?.some(entry => hookEntryMatchesCommand(entry, matchSubstring));
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

export class AgentHookInstaller {
  private readonly claudeSettingsPath: string;
  private readonly codexHooksPath: string;
  private readonly hooksDir: string;

  constructor(options?: { home?: string }) {
    const home = options?.home ?? os.homedir();
    this.claudeSettingsPath = path.join(home, '.claude', 'settings.json');
    this.codexHooksPath = path.join(home, '.codex', 'hooks.json');
    this.hooksDir = options?.home
      ? path.join(options.home, '.fieldtheory', 'agents', 'hooks')
      : HOOKS_DIR;
  }

  install(targets: InstallTargets): InstallResult {
    const result: InstallResult = {
      success: true,
      message: '',
      claude: false,
      codex: false,
    };

    try {
      this.writeScripts();
      if (targets.claude) {
        this.registerForTool('claude');
        result.claude = true;
      }
      if (targets.codex) {
        this.registerForTool('codex');
        result.codex = true;
      }
      result.message = this.buildMessage(result.claude, result.codex, 'installed');
      return result;
    } catch (err) {
      log.error('install failed:', err);
      return {
        success: false,
        message: `Install failed: ${(err as Error).message}`,
        claude: result.claude,
        codex: result.codex,
      };
    }
  }

  uninstall(targets: InstallTargets): InstallResult {
    const result: InstallResult = {
      success: true,
      message: '',
      claude: false,
      codex: false,
    };

    try {
      if (targets.claude) {
        this.unregisterForTool('claude');
        result.claude = true;
      }
      if (targets.codex) {
        this.unregisterForTool('codex');
        result.codex = true;
      }
      result.message = this.buildMessage(result.claude, result.codex, 'removed');
      return result;
    } catch (err) {
      log.error('uninstall failed:', err);
      return {
        success: false,
        message: `Uninstall failed: ${(err as Error).message}`,
        claude: result.claude,
        codex: result.codex,
      };
    }
  }

  getStatus(): InstallStatus {
    return {
      claude: this.isToolInstalled('claude'),
      codex: this.isToolInstalled('codex'),
    };
  }

  writeScripts(): void {
    fs.mkdirSync(this.hooksDir, { recursive: true });
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const scripts: Array<[string, string]> = [
      ['claude-stop.py', generateAgentStopScript('claude')],
      ['claude-clear.py', generateAgentClearScript('claude')],
      ['codex-stop.py', generateAgentStopScript('codex')],
      ['codex-clear.py', generateAgentClearScript('codex')],
    ];
    for (const [filename, contents] of scripts) {
      const dest = path.join(this.hooksDir, filename);
      fs.writeFileSync(dest, contents, { mode: 0o755 });
    }
  }

  private registerForTool(tool: AgentTool): void {
    const configPath = tool === 'claude' ? this.claudeSettingsPath : this.codexHooksPath;
    const config = this.readConfig(configPath);
    const stopCmd = `python3 "${path.join(this.hooksDir, `${tool}-stop.py`)}"`;
    const clearCmd = `python3 "${path.join(this.hooksDir, `${tool}-clear.py`)}"`;

    upsertHook(config, 'Stop', stopCmd, `${tool}-stop.py`);
    upsertHook(config, 'UserPromptSubmit', clearCmd, `${tool}-clear.py`);
    upsertHook(config, 'SessionEnd', clearCmd, `${tool}-clear.py`);

    this.writeConfig(configPath, config);
  }

  private unregisterForTool(tool: AgentTool): void {
    const configPath = tool === 'claude' ? this.claudeSettingsPath : this.codexHooksPath;
    if (!fs.existsSync(configPath)) return;

    const config = this.readConfig(configPath);
    removeHook(config, 'Stop', `${tool}-stop.py`);
    removeHook(config, 'UserPromptSubmit', `${tool}-clear.py`);
    removeHook(config, 'SessionEnd', `${tool}-clear.py`);
    this.writeConfig(configPath, config);
  }

  private isToolInstalled(tool: AgentTool): boolean {
    const configPath = tool === 'claude' ? this.claudeSettingsPath : this.codexHooksPath;
    if (!fs.existsSync(configPath)) return false;
    const config = this.readConfig(configPath);
    return hookInstalled(config, 'Stop', `${tool}-stop.py`);
  }

  private readConfig(configPath: string): HookConfig {
    if (!fs.existsSync(configPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return (parsed && typeof parsed === 'object' ? parsed : {}) as HookConfig;
    } catch (err) {
      log.warn('failed to parse %s, starting fresh:', configPath, err);
      return {};
    }
  }

  private writeConfig(configPath: string, config: HookConfig): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  private buildMessage(claude: boolean, codex: boolean, verb: string): string {
    const touched: string[] = [];
    if (claude) touched.push('Claude Code');
    if (codex) touched.push('Codex');
    if (touched.length === 0) return 'No targets selected';
    return `Agent hooks ${verb} for ${touched.join(' + ')}`;
  }
}
