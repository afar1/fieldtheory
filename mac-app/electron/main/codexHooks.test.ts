import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  tomlSetNotify,
  tomlRemoveNotify,
  tomlAddWritableRoot,
  tomlRemoveWritableRoot,
  managedSectionUpsert,
  managedSectionRemove,
  generateCodexNotifyHookScript,
  generateCodexStopScript,
  hasCodexCommandHook,
  upsertCodexCommandHook,
  removeCodexCommandHook,
} from './librarianManager';

function withTempHome(run: (homeDir: string) => void): void {
  const homeDir = mkdtempSync(join(tmpdir(), 'codex-hooks-test-'));
  try {
    run(homeDir);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function runHook(script: string, homeDir: string): string {
  const scriptPath = join(homeDir, 'hook.py');
  writeFileSync(scriptPath, script);
  return execFileSync('python3', [scriptPath], {
    cwd: homeDir,
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf8',
  });
}

// ===========================================================================
// TOML editing helpers
// ===========================================================================

describe('tomlSetNotify', () => {
  it('appends notify to empty content', () => {
    const result = tomlSetNotify('', ['python3', '/path/to/codex-notify.py']);
    expect(result).toBe('\nnotify = ["python3", "/path/to/codex-notify.py"]\n');
  });

  it('appends notify to content without existing notify', () => {
    const result = tomlSetNotify('model = "o3"\n', ['python3', '/path/to/codex-notify.py']);
    expect(result).toBe('model = "o3"\nnotify = ["python3", "/path/to/codex-notify.py"]\n');
  });

  it('replaces existing legacy notify line', () => {
    const content = 'model = "o3"\nnotify = "some-old-command"\napproval_mode = "suggest"\n';
    const result = tomlSetNotify(content, ['python3', '/path/to/codex-notify.py']);
    expect(result).toContain('notify = ["python3", "/path/to/codex-notify.py"]');
    expect(result).not.toContain('some-old-command');
    expect(result).toContain('model = "o3"');
    expect(result).toContain('approval_mode = "suggest"');
  });

  it('is idempotent when command array is already present', () => {
    const content = 'notify = ["python3", "/path/to/codex-notify.py"]\n';
    const result = tomlSetNotify(content, ['python3', '/path/to/codex-notify.py']);
    expect(result).toBe(content);
  });

  it('moves notify to top level when appended after a table header', () => {
    const content = '[notice.model_migrations]\n"gpt-5.3-codex" = "gpt-5.4"\nnotify = "old-command"\n';
    const result = tomlSetNotify(content, ['python3', '/path/to/codex-notify.py']);
    expect(result).toContain('notify = ["python3", "/path/to/codex-notify.py"]\n\n[notice.model_migrations]');
    expect(result).not.toContain('old-command');
  });
});

describe('tomlRemoveNotify', () => {
  it('removes notify line matching script name', () => {
    const content = 'model = "o3"\nnotify = ["python3", "/path/to/codex-notify.py"]\napproval_mode = "suggest"\n';
    const result = tomlRemoveNotify(content, 'codex-notify.py');
    expect(result).not.toContain('notify');
    expect(result).toContain('model = "o3"');
    expect(result).toContain('approval_mode = "suggest"');
  });

  it('leaves content unchanged if script not found', () => {
    const content = 'notify = "some-other-script"\n';
    const result = tomlRemoveNotify(content, 'codex-notify.py');
    expect(result).toBe(content);
  });

  it('handles content with no notify line', () => {
    const content = 'model = "o3"\n';
    const result = tomlRemoveNotify(content, 'codex-notify.py');
    expect(result).toBe(content);
  });
});

describe('tomlAddWritableRoot', () => {
  it('creates sandbox_workspace_write table when writable_roots are absent', () => {
    const result = tomlAddWritableRoot('model = "o3"\n', '/home/user/.fieldtheory/librarian');
    expect(result).toContain('[sandbox_workspace_write]');
    expect(result).toContain('writable_roots = [');
    expect(result).toContain('"/home/user/.fieldtheory/librarian"');
    expect(result).not.toContain('\nwritable_roots = [\n  "/home/user/.fieldtheory/librarian"\n]\n\n[notice');
  });

  it('appends to existing empty writable_roots in sandbox_workspace_write', () => {
    const content = '[sandbox_workspace_write]\nwritable_roots = []\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('"/home/user/.fieldtheory/librarian"');
  });

  it('appends to existing populated writable_roots', () => {
    const content = '[sandbox_workspace_write]\nwritable_roots = [\n  "/home/user/projects"\n]\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('"/home/user/projects"');
    expect(result).toContain('"/home/user/.fieldtheory/librarian"');
    expect(result).toContain('[sandbox_workspace_write]');
  });

  it('is idempotent when path already present', () => {
    const content = '[sandbox_workspace_write]\nwritable_roots = [\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toBe(content);
  });

  it('moves legacy writable_roots into sandbox_workspace_write before other tables', () => {
    const content = '[notice.model_migrations]\n"gpt-5.3-codex" = "gpt-5.4"\nwritable_roots = [\n  "/tmp/old"\n]\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('[sandbox_workspace_write]\nwritable_roots = [\n  "/tmp/old",\n  "/home/user/.fieldtheory/librarian"\n]\n\n[notice.model_migrations]');
  });

  it('preserves other sandbox_workspace_write settings', () => {
    const content = '[sandbox_workspace_write]\nnetwork_access = false\n\n[notice.model_migrations]\n"gpt-5.3-codex" = "gpt-5.4"\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('[sandbox_workspace_write]\nnetwork_access = false\n\nwritable_roots = [\n  "/home/user/.fieldtheory/librarian"\n]');
  });
});

describe('tomlRemoveWritableRoot', () => {
  it('removes path from writable_roots', () => {
    const content = '[sandbox_workspace_write]\nwritable_roots = [\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).not.toContain('writable_roots');
    expect(result).not.toContain('[sandbox_workspace_write]');
  });

  it('removes only our path, keeps others', () => {
    const content = '[sandbox_workspace_write]\nwritable_roots = [\n  "/home/user/projects",\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('writable_roots');
    expect(result).toContain('/home/user/projects');
    expect(result).not.toContain('.fieldtheory/librarian');
    expect(result).toContain('[sandbox_workspace_write]');
  });

  it('handles content without writable_roots', () => {
    const content = 'model = "o3"\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toBe(content);
  });

  it('removes our path from a legacy nested writable_roots block and keeps the rest in sandbox_workspace_write', () => {
    const content = '[notice.model_migrations]\n"gpt-5.3-codex" = "gpt-5.4"\nwritable_roots = [\n  "/home/user/projects",\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('[sandbox_workspace_write]\nwritable_roots = [\n  "/home/user/projects"\n]\n\n[notice.model_migrations]');
    expect(result).not.toContain('/home/user/.fieldtheory/librarian');
  });

  it('preserves other sandbox_workspace_write settings when removing the last root', () => {
    const content = '[sandbox_workspace_write]\nnetwork_access = false\nwritable_roots = [\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('[sandbox_workspace_write]\nnetwork_access = false\n');
    expect(result).not.toContain('writable_roots');
  });
});

// ===========================================================================
// Managed section helpers
// ===========================================================================

describe('managedSectionUpsert', () => {
  it('appends section to empty content', () => {
    const section = '<!-- start -->\nHello\n<!-- end -->\n';
    const result = managedSectionUpsert('', 'start', section);
    expect(result).toContain('Hello');
  });

  it('appends section to existing content', () => {
    const section = '<!-- start -->\nHello\n<!-- end -->\n';
    const result = managedSectionUpsert('# Existing\n', 'start', section);
    expect(result).toContain('# Existing');
    expect(result).toContain('Hello');
  });

  it('does not duplicate if marker already present', () => {
    const content = '# Existing\n<!-- start -->\nHello\n<!-- end -->\n';
    const section = '<!-- start -->\nHello\n<!-- end -->\n';
    const result = managedSectionUpsert(content, 'start', section);
    expect(result).toBe(content);
  });
});

describe('managedSectionRemove', () => {
  it('removes managed section', () => {
    const content = '# Existing\n<!-- start -->\nHello\n<!-- end -->\nAfter';
    const result = managedSectionRemove(content, '<!-- start -->', '<!-- end -->');
    expect(result).toContain('# Existing');
    expect(result).toContain('After');
    expect(result).not.toContain('Hello');
  });

  it('handles content without the section', () => {
    const content = '# Just markdown\n';
    const result = managedSectionRemove(content, '<!-- start -->', '<!-- end -->');
    expect(result).toBe(content);
  });

  it('removes full librarian managed section', () => {
    const content = `# My AGENTS.md

Some existing instructions.

<!-- Field Theory Librarian - managed section, do not edit -->
## Field Theory Librarian
When you receive instructions prefixed with [STATE-ENFORCED] or [LIBRARIAN],
follow them before proceeding.
<!-- End Field Theory Librarian -->
`;
    const result = managedSectionRemove(
      content,
      '<!-- Field Theory Librarian - managed section, do not edit -->',
      '<!-- End Field Theory Librarian -->'
    );
    expect(result).toContain('My AGENTS.md');
    expect(result).toContain('Some existing instructions');
    expect(result).not.toContain('Field Theory Librarian');
    expect(result).not.toContain('STATE-ENFORCED');
  });
});

// ===========================================================================
// Codex hooks.json structure (librarian hooks)
// ===========================================================================

describe('Codex hooks.json structure', () => {
  it('supports the nested hook format Codex expects', () => {
    const hooksConfig = {
      hooks: {
        Stop: [{
          hooks: [{
            type: 'command',
            command: 'python3 /path/to/codex-stop.py',
            timeout_sec: 10,
          }],
        }],
      },
    };

    expect(hasCodexCommandHook(hooksConfig, 'Stop', 'codex-stop.py')).toBe(true);
    removeCodexCommandHook(hooksConfig, 'Stop', 'codex-stop.py');
    expect(hooksConfig.hooks?.Stop).toBeUndefined();
  });

  it('upserts our Stop hook without duplicating it', () => {
    const hooksConfig = {
      hooks: {
        Stop: [{
          hooks: [{ type: 'command', command: 'python3 /path/to/codex-stop.py', timeout_sec: 10 }],
        }],
      },
    };

    upsertCodexCommandHook(
      hooksConfig,
      'Stop',
      {
        hooks: [{ type: 'command', command: 'python3 /path/to/codex-stop.py', timeout_sec: 10 }],
      },
      'codex-stop.py',
    );

    expect(hooksConfig.hooks?.Stop).toHaveLength(1);
  });

  it('preserves other hooks during uninstall', () => {
    const hooksConfig = {
      hooks: {
        Stop: [
          {
            hooks: [{ type: 'command', command: 'some-other-hook' }],
          },
          {
            hooks: [{ type: 'command', command: 'python3 /path/to/codex-stop.py' }],
          },
        ],
      },
    };

    removeCodexCommandHook(hooksConfig, 'Stop', 'codex-stop.py');
    expect(hooksConfig.hooks?.Stop).toHaveLength(1);
    expect((hooksConfig.hooks?.Stop as Array<{ hooks: Array<{ command: string }> }>)[0].hooks[0].command).toBe('some-other-hook');
  });

  it('removes legacy SessionStart hooks without touching Stop', () => {
    const hooksConfig = {
      hooks: {
        SessionStart: [{
          hooks: [{ type: 'command', command: 'python3 /path/to/codex-session-start.py' }],
        }],
        Stop: [{
          hooks: [{ type: 'command', command: 'python3 /path/to/codex-stop.py' }],
        }],
      },
    };

    removeCodexCommandHook(hooksConfig, 'SessionStart', 'codex-session-start.py');
    expect(hooksConfig.hooks?.SessionStart).toBeUndefined();
    expect(hasCodexCommandHook(hooksConfig, 'Stop', 'codex-stop.py')).toBe(true);
  });
});

describe('Codex hook script generation', () => {
  it('generates a notify hook that dynamically syncs Stop registration', () => {
    const script = generateCodexNotifyHookScript();
    expect(script).toContain('def sync_stop_hook(enabled):');
    expect(script).toContain('sync_stop_hook(True)');
    expect(script).toContain('sync_stop_hook(False)');
  });

  it('generates a Stop hook that blocks on any pending global job and clears stale sentinel state', () => {
    const script = generateCodexStopScript();
    expect(script).toContain('def find_pending_job():');
    expect(script).toContain('pending_job = find_pending_job()');
    expect(script).toContain('SENTINEL_FILE.unlink(missing_ok=True)');
    expect(script).toContain('sync_stop_hook(False)');
    expect(script).toContain('SENTINEL_FILE.write_text');
    expect(script).toContain('sync_stop_hook(True)');
    expect(script).toContain('def build_stop_reason(job_file, job):');
    expect(script).toContain('"decision": "block"');
  });

  it('notify creates a pending job and installs Stop only when threshold is reached', () => {
    withTempHome(homeDir => {
      const librarianDir = join(homeDir, '.fieldtheory', 'librarian');
      writeJson(join(librarianDir, 'config.json'), { enabled: true });
      writeJson(join(librarianDir, 'state.json'), { count: 0, threshold: 1 });

      const stdout = runHook(generateCodexNotifyHookScript(), homeDir);
      const hooksConfig = JSON.parse(readFileSync(join(homeDir, '.codex', 'hooks.json'), 'utf8'));
      const sentinel = JSON.parse(readFileSync(join(librarianDir, '.codex-pending'), 'utf8'));
      const job = JSON.parse(readFileSync(join(librarianDir, 'jobs', 'job_1.json'), 'utf8'));

      expect(stdout).toBe('');
      expect(hasCodexCommandHook(hooksConfig, 'Stop', 'codex-stop.py')).toBe(true);
      expect(sentinel.job_file).toContain('job_1.json');
      expect(job.status).toBe('pending');
    });
  });

  it('notify removes Stop when there is no pending job and the threshold is not reached', () => {
    withTempHome(homeDir => {
      const librarianDir = join(homeDir, '.fieldtheory', 'librarian');
      writeJson(join(librarianDir, 'config.json'), { enabled: true });
      writeJson(join(librarianDir, 'state.json'), { count: 0, threshold: 99 });
      writeJson(join(librarianDir, '.codex-pending'), { job_file: 'stale', output: 'stale' });
      writeJson(join(homeDir, '.codex', 'hooks.json'), {
        hooks: {
          Stop: [{
            hooks: [{ type: 'command', command: `python3 ${join(homeDir, '.fieldtheory', 'librarian', 'codex-stop.py')}`, timeout_sec: 10 }],
          }],
        },
      });

      runHook(generateCodexNotifyHookScript(), homeDir);
      const hooksConfig = JSON.parse(readFileSync(join(homeDir, '.codex', 'hooks.json'), 'utf8'));

      expect(hasCodexCommandHook(hooksConfig, 'Stop', 'codex-stop.py')).toBe(false);
      expect(existsSync(join(librarianDir, '.codex-pending'))).toBe(false);
    });
  });

  it('Stop blocks on a pending job and writes the sentinel for same-session flow', () => {
    withTempHome(homeDir => {
      const librarianDir = join(homeDir, '.fieldtheory', 'librarian');
      writeJson(join(librarianDir, 'config.json'), {
        enabled: true,
        rule_content: 'Write the artifact.',
      });
      writeJson(join(librarianDir, 'jobs', 'job_3.json'), {
        schema_version: 1,
        id: 3,
        status: 'pending',
        output: '/tmp/pending.md',
        rule_file: '/tmp/history_reading.md',
      });

      const stdout = runHook(generateCodexStopScript(), homeDir);
      const output = JSON.parse(stdout);
      const sentinelPath = join(librarianDir, '.codex-pending');
      const sentinel = JSON.parse(readFileSync(sentinelPath, 'utf8'));

      expect(output.decision).toBe('block');
      expect(output.reason).toContain('job_3.json');
      expect(output.reason).toContain('/tmp/pending.md');
      expect(output.reason).toContain('/tmp/history_reading.md');
      expect(output.reason).not.toContain('Write the artifact.');
      expect(sentinel.job_file).toContain('job_3.json');
      expect(sentinel.output).toBe('/tmp/pending.md');
    });
  });

  it('Stop clears stale sentinel state when no pending jobs remain', () => {
    withTempHome(homeDir => {
      const librarianDir = join(homeDir, '.fieldtheory', 'librarian');
      writeJson(join(librarianDir, 'config.json'), { enabled: true });
      writeJson(join(librarianDir, 'jobs', 'job_4.json'), {
        schema_version: 1,
        id: 4,
        status: 'done',
        output: '/tmp/done.md',
      });
      const sentinelPath = join(librarianDir, '.codex-pending');
      writeJson(sentinelPath, { job_file: 'stale', output: 'stale' });
      writeJson(join(homeDir, '.codex', 'hooks.json'), {
        hooks: {
          Stop: [{
            hooks: [{ type: 'command', command: `python3 ${join(homeDir, '.fieldtheory', 'librarian', 'codex-stop.py')}`, timeout_sec: 10 }],
          }],
        },
      });

      const stdout = runHook(generateCodexStopScript(), homeDir);
      const hooksConfig = JSON.parse(readFileSync(join(homeDir, '.codex', 'hooks.json'), 'utf8'));

      expect(stdout).toBe('');
      expect(existsSync(sentinelPath)).toBe(false);
      expect(hasCodexCommandHook(hooksConfig, 'Stop', 'codex-stop.py')).toBe(false);
    });
  });
});

// ===========================================================================
// Codex read permission hooks (PreToolUse)
// ===========================================================================

describe('Codex read permission hook detection', () => {
  const command = 'python3 "/Users/test/.codex/fieldtheory-read-permission-hook.py"';

  type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

  it('detects installed PreToolUse hook', () => {
    const config = {
      hooks: {
        PreToolUse: [{
          matcher: 'Read|Write|Edit',
          hooks: [{ type: 'command', command }],
        }],
      },
    };
    const found = (config.hooks.PreToolUse as HookEntry[]).some(
      h => h.hooks?.some(hh => hh.command === command)
    );
    expect(found).toBe(true);
  });

  it('returns false when PreToolUse is empty', () => {
    const config = { hooks: { PreToolUse: [] as HookEntry[] } };
    const found = config.hooks.PreToolUse.some(
      h => h.hooks?.some(hh => hh.command === command)
    );
    expect(found).toBe(false);
  });

  it('returns false when PreToolUse contains other hooks', () => {
    const config = {
      hooks: {
        PreToolUse: [{
          matcher: 'Read',
          hooks: [{ type: 'command', command: 'python3 /other/hook.py' }],
        }],
      },
    };
    const found = (config.hooks.PreToolUse as HookEntry[]).some(
      h => h.hooks?.some(hh => hh.command === command)
    );
    expect(found).toBe(false);
  });

  it('uninstall filter removes only our hook', () => {
    const config = {
      hooks: {
        PreToolUse: [
          { matcher: 'Read', hooks: [{ type: 'command', command: 'python3 /other/hook.py' }] },
          { matcher: 'Read|Write|Edit', hooks: [{ type: 'command', command }] },
        ],
      },
    };
    const filtered = (config.hooks.PreToolUse as HookEntry[]).filter(
      h => !h.hooks?.some(hh => hh.command === command)
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].hooks![0].command).toBe('python3 /other/hook.py');
  });

  it('install skips if already present', () => {
    const preToolUse: HookEntry[] = [
      { matcher: 'Read|Write|Edit', hooks: [{ type: 'command', command }] },
    ];
    const exists = preToolUse.some(h => h.hooks?.some(hh => hh.command === command));
    expect(exists).toBe(true);
    // Should not push a duplicate
  });

  it('coexists with librarian Stop hooks', () => {
    const config = {
      hooks: {
        Stop: [{
          hooks: [{ type: 'command', command: 'python3 /path/to/codex-stop.py' }],
        }],
        PreToolUse: [{
          matcher: 'Read|Write|Edit',
          hooks: [{ type: 'command', command }],
        }],
      },
    };
    // Both should be detectable independently
    const hasStop = config.hooks.Stop.some(
      (e: { hooks?: Array<{ command?: string }> }) => e.hooks?.some(h => h.command?.includes('codex-stop.py'))
    );
    const hasPreTool = (config.hooks.PreToolUse as HookEntry[]).some(
      h => h.hooks?.some(hh => hh.command === command)
    );
    expect(hasStop).toBe(true);
    expect(hasPreTool).toBe(true);
  });
});
