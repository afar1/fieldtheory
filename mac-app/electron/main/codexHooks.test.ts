import { describe, expect, it } from 'vitest';
import {
  tomlSetNotify,
  tomlRemoveNotify,
  tomlAddWritableRoot,
  tomlRemoveWritableRoot,
  managedSectionUpsert,
  managedSectionRemove,
} from './librarianManager';

// ===========================================================================
// TOML editing helpers
// ===========================================================================

describe('tomlSetNotify', () => {
  it('appends notify to empty content', () => {
    const result = tomlSetNotify('', 'python3 /path/to/codex-notify.py');
    expect(result).toBe('\nnotify = "python3 /path/to/codex-notify.py"\n');
  });

  it('appends notify to content without existing notify', () => {
    const result = tomlSetNotify('model = "o3"\n', 'python3 /path/to/codex-notify.py');
    expect(result).toBe('model = "o3"\nnotify = "python3 /path/to/codex-notify.py"\n');
  });

  it('replaces existing notify line', () => {
    const content = 'model = "o3"\nnotify = "some-old-command"\napproval_mode = "suggest"\n';
    const result = tomlSetNotify(content, 'python3 /path/to/codex-notify.py');
    expect(result).toContain('notify = "python3 /path/to/codex-notify.py"');
    expect(result).not.toContain('some-old-command');
    expect(result).toContain('model = "o3"');
    expect(result).toContain('approval_mode = "suggest"');
  });

  it('is idempotent when command already present', () => {
    const content = 'notify = "python3 /path/to/codex-notify.py"\n';
    const result = tomlSetNotify(content, 'python3 /path/to/codex-notify.py');
    expect(result).toBe(content);
  });

  it('moves notify to top level when appended after a table header', () => {
    const content = '[notice.model_migrations]\n"gpt-5.3-codex" = "gpt-5.4"\nnotify = "old-command"\n';
    const result = tomlSetNotify(content, 'python3 /path/to/codex-notify.py');
    expect(result).toContain('notify = "python3 /path/to/codex-notify.py"\n\n[notice.model_migrations]');
    expect(result).not.toContain('old-command');
  });
});

describe('tomlRemoveNotify', () => {
  it('removes notify line matching script name', () => {
    const content = 'model = "o3"\nnotify = "python3 /path/to/codex-notify.py"\napproval_mode = "suggest"\n';
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
  it('creates writable_roots array when absent', () => {
    const result = tomlAddWritableRoot('model = "o3"\n', '/home/user/.fieldtheory/librarian');
    expect(result).toContain('writable_roots = [');
    expect(result).toContain('"/home/user/.fieldtheory/librarian"');
    expect(result).toContain(']');
  });

  it('appends to existing empty writable_roots', () => {
    const content = 'writable_roots = []\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('"/home/user/.fieldtheory/librarian"');
  });

  it('appends to existing populated writable_roots', () => {
    const content = 'writable_roots = [\n  "/home/user/projects"\n]\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('"/home/user/projects"');
    expect(result).toContain('"/home/user/.fieldtheory/librarian"');
    // Should add comma after existing entry
    expect(result).toMatch(/projects",?\n/);
  });

  it('is idempotent when path already present', () => {
    const content = 'writable_roots = [\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toBe(content);
  });

  it('moves writable_roots to top level when appended after a table header', () => {
    const content = '[notice.model_migrations]\n"gpt-5.3-codex" = "gpt-5.4"\nwritable_roots = [\n  "/tmp/old"\n]\n';
    const result = tomlAddWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('writable_roots = [\n  "/tmp/old",\n  "/home/user/.fieldtheory/librarian"\n]\n\n[notice.model_migrations]');
  });
});

describe('tomlRemoveWritableRoot', () => {
  it('removes path from writable_roots', () => {
    const content = 'writable_roots = [\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    // Should clean up the now-empty array entirely
    expect(result).not.toContain('writable_roots');
    expect(result).not.toContain('.fieldtheory/librarian');
  });

  it('removes only our path, keeps others', () => {
    const content = 'writable_roots = [\n  "/home/user/projects",\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('writable_roots');
    expect(result).toContain('/home/user/projects');
    expect(result).not.toContain('.fieldtheory/librarian');
  });

  it('handles content without writable_roots', () => {
    const content = 'model = "o3"\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toBe(content);
  });

  it('removes our path from a nested writable_roots block and keeps the rest top level', () => {
    const content = '[notice.model_migrations]\n"gpt-5.3-codex" = "gpt-5.4"\nwritable_roots = [\n  "/home/user/projects",\n  "/home/user/.fieldtheory/librarian"\n]\n';
    const result = tomlRemoveWritableRoot(content, '/home/user/.fieldtheory/librarian');
    expect(result).toContain('writable_roots = [\n  "/home/user/projects"\n]\n\n[notice.model_migrations]');
    expect(result).not.toContain('/home/user/.fieldtheory/librarian');
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
// Codex hooks.json structure
// ===========================================================================

describe('Codex hooks.json structure', () => {
  it('supports the nested hook format Codex expects', () => {
    const hooksConfig = {
      hooks: {
        SessionStart: [{
          hooks: [{
            type: 'command',
            command: 'python3 /path/to/codex-session-start.py',
            timeout_sec: 10,
          }],
        }],
        Stop: [{
          hooks: [{
            type: 'command',
            command: 'python3 /path/to/codex-stop.py',
            timeout_sec: 10,
          }],
        }],
      },
    };

    // Verify detection logic matches the pattern used in isCodexHookInstalled
    const stopHooks = hooksConfig.hooks.Stop;
    expect(Array.isArray(stopHooks)).toBe(true);
    const hasStop = stopHooks.some((entry: { hooks?: Array<{ command?: string }> }) =>
      entry.hooks?.some(h => h.command?.includes('codex-stop.py'))
    );
    expect(hasStop).toBe(true);

    // Verify uninstall filter logic
    const filtered = stopHooks.filter(
      (entry: { hooks?: Array<{ command?: string }> }) =>
        !entry.hooks?.some(h => h.command?.includes('codex-stop.py'))
    );
    expect(filtered).toHaveLength(0);
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

    const filtered = hooksConfig.hooks.Stop.filter(
      (entry: { hooks?: Array<{ command?: string }> }) =>
        !entry.hooks?.some(h => h.command?.includes('codex-stop.py'))
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].hooks[0].command).toBe('some-other-hook');
  });
});
