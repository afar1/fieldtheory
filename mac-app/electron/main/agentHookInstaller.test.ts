import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentHookInstaller,
  generateAgentStopScript,
  generateAgentClearScript,
  upsertHook,
  removeHook,
  hookInstalled,
} from './agentHookInstaller';

describe('hook config helpers', () => {
  it('upsert adds a Stop hook to empty config', () => {
    const config: { hooks?: Record<string, any> } = {};
    upsertHook(config, 'Stop', 'python3 /hooks/claude-stop.py', 'claude-stop.py');
    expect(hookInstalled(config, 'Stop', 'claude-stop.py')).toBe(true);
  });

  it('upsert is idempotent when the hook is already present', () => {
    const config: { hooks?: Record<string, any> } = {};
    upsertHook(config, 'Stop', 'python3 /hooks/claude-stop.py', 'claude-stop.py');
    upsertHook(config, 'Stop', 'python3 /hooks/claude-stop.py', 'claude-stop.py');
    expect(config.hooks?.Stop).toHaveLength(1);
  });

  it('upsert preserves other hooks on the same event', () => {
    const config = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'python3 /path/to/librarian-stop.py' }] },
        ],
      },
    };
    upsertHook(config, 'Stop', 'python3 /hooks/claude-stop.py', 'claude-stop.py');
    expect(config.hooks.Stop).toHaveLength(2);
    expect(hookInstalled(config, 'Stop', 'librarian-stop.py')).toBe(true);
    expect(hookInstalled(config, 'Stop', 'claude-stop.py')).toBe(true);
  });

  it('remove filters only the matching hook', () => {
    const config = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'python3 /path/to/librarian-stop.py' }] },
          { hooks: [{ type: 'command', command: 'python3 /hooks/claude-stop.py' }] },
        ],
      },
    };
    removeHook(config, 'Stop', 'claude-stop.py');
    expect(config.hooks.Stop).toHaveLength(1);
    expect(config.hooks.Stop[0].hooks[0].command).toContain('librarian-stop.py');
  });

  it('remove drops the event key when list goes empty', () => {
    const config = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'python3 /hooks/claude-stop.py' }] },
        ],
      },
    } as any;
    removeHook(config, 'Stop', 'claude-stop.py');
    expect(config.hooks).toBeUndefined();
  });
});

describe('script generation', () => {
  it('Stop script writes state JSON for the right tool', () => {
    const script = generateAgentStopScript('claude');
    expect(script).toContain('TOOL = "claude"');
    expect(script).toContain('.fieldtheory');
    expect(script).toContain('waitingSince');
    expect(script).toContain('terminalApp');
  });

  it('Clear script removes state JSON', () => {
    const script = generateAgentClearScript('codex');
    expect(script).toContain('TOOL = "codex"');
    expect(script).toContain('state_file.unlink');
  });

  it('maps common TERM_PROGRAM values to friendly terminal names', () => {
    const script = generateAgentStopScript('claude');
    expect(script).toContain('"iTerm.app": "iTerm2"');
    expect(script).toContain('"Apple_Terminal": "Terminal"');
    expect(script).toContain('"ghostty": "Ghostty"');
  });
});

describe('AgentHookInstaller', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agent-hook-test-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('install writes hook scripts and updates both config files', () => {
    const installer = new AgentHookInstaller({ home });
    const result = installer.install({ claude: true, codex: true });

    expect(result.success).toBe(true);
    expect(result.claude).toBe(true);
    expect(result.codex).toBe(true);
    expect(existsSync(join(home, '.fieldtheory/agents/hooks/claude-stop.py'))).toBe(true);
    expect(existsSync(join(home, '.fieldtheory/agents/hooks/codex-stop.py'))).toBe(true);

    const claude = JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8'));
    const codex = JSON.parse(readFileSync(join(home, '.codex/hooks.json'), 'utf8'));
    expect(hookInstalled(claude, 'Stop', 'claude-stop.py')).toBe(true);
    expect(hookInstalled(claude, 'UserPromptSubmit', 'claude-clear.py')).toBe(true);
    expect(hookInstalled(claude, 'SessionEnd', 'claude-clear.py')).toBe(true);
    expect(hookInstalled(codex, 'Stop', 'codex-stop.py')).toBe(true);
  });

  it('install preserves existing Librarian Stop hooks', () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const existing = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'python3 /path/to/librarian-stop.py' }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'python3 /path/to/librarian-prompt.py' }] },
        ],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(existing, null, 2));

    const installer = new AgentHookInstaller({ home });
    installer.install({ claude: true });

    const updated = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(hookInstalled(updated, 'Stop', 'librarian-stop.py')).toBe(true);
    expect(hookInstalled(updated, 'Stop', 'claude-stop.py')).toBe(true);
    expect(hookInstalled(updated, 'UserPromptSubmit', 'librarian-prompt.py')).toBe(true);
    expect(hookInstalled(updated, 'UserPromptSubmit', 'claude-clear.py')).toBe(true);
  });

  it('install is idempotent', () => {
    const installer = new AgentHookInstaller({ home });
    installer.install({ claude: true });
    installer.install({ claude: true });

    const claude = JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8'));
    expect(claude.hooks.Stop).toHaveLength(1);
  });

  it('uninstall removes our hooks but leaves Librarian hooks intact', () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              { hooks: [{ type: 'command', command: 'python3 /path/to/librarian-stop.py' }] },
            ],
          },
        },
        null,
        2
      )
    );

    const installer = new AgentHookInstaller({ home });
    installer.install({ claude: true });
    installer.uninstall({ claude: true });

    const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(hookInstalled(after, 'Stop', 'librarian-stop.py')).toBe(true);
    expect(hookInstalled(after, 'Stop', 'claude-stop.py')).toBe(false);
    expect(hookInstalled(after, 'UserPromptSubmit', 'claude-clear.py')).toBe(false);
  });

  it('getStatus reports installed state accurately', () => {
    const installer = new AgentHookInstaller({ home });
    expect(installer.getStatus()).toEqual({ claude: false, codex: false });
    installer.install({ claude: true });
    expect(installer.getStatus()).toEqual({ claude: true, codex: false });
    installer.install({ codex: true });
    expect(installer.getStatus()).toEqual({ claude: true, codex: true });
    installer.uninstall({ claude: true, codex: true });
    expect(installer.getStatus()).toEqual({ claude: false, codex: false });
  });

  it('install without targets is a no-op', () => {
    const installer = new AgentHookInstaller({ home });
    const result = installer.install({});
    expect(result.success).toBe(true);
    expect(result.claude).toBe(false);
    expect(result.codex).toBe(false);
    expect(existsSync(join(home, '.claude/settings.json'))).toBe(false);
  });
});
