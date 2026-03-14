import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateCursorBeforeSubmitHookScript,
  generateCursorPreToolHookScript,
  hasCursorCommandHook,
  removeCursorCommandHook,
  upsertCursorCommandHook,
} from './librarianManager';

function withTempHome(run: (homeDir: string) => void): void {
  const homeDir = mkdtempSync(join(tmpdir(), 'cursor-hooks-test-'));
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

function runHook(script: string, homeDir: string, inputData: unknown, cwd: string): string {
  const scriptPath = join(homeDir, 'hook.py');
  writeFileSync(scriptPath, script);
  try {
    return execFileSync('python3', [scriptPath], {
      cwd,
      env: { ...process.env, HOME: homeDir, CURSOR_PROJECT_DIR: cwd },
      input: JSON.stringify(inputData),
      encoding: 'utf8',
    });
  } catch (error) {
    const stdout = (error as { stdout?: string | Buffer }).stdout;
    if (typeof stdout === 'string') {
      return stdout;
    }
    if (stdout) {
      return stdout.toString();
    }
    throw error;
  }
}

describe('Cursor hook helpers', () => {
  it('migrates our hook into the nested hooks shape and preserves unrelated legacy entries', () => {
    const config: {
      hooks?: { preToolUse?: Array<{ command: string }> };
      preToolUse?: Array<{ matcher: string; command: string }>;
    } = {
      preToolUse: [
        {
          matcher: 'read_file',
          command: 'python3 "/tmp/fieldtheory-read-permission-hook.py"',
        },
        {
          matcher: 'read_file',
          command: 'python3 "/tmp/unrelated.py"',
        },
      ],
    };

    upsertCursorCommandHook(
      config,
      'preToolUse',
      {
        matcher: 'read_file|write_new_file|file_str_replace|edit_file',
        command: 'python3 "/tmp/fieldtheory-read-permission-hook.py"',
      },
      'fieldtheory-read-permission-hook.py',
    );

    expect(hasCursorCommandHook(config, 'preToolUse', 'fieldtheory-read-permission-hook.py')).toBe(true);
    expect((config.hooks as { preToolUse: Array<{ command: string }> }).preToolUse).toHaveLength(1);
    expect((config.preToolUse as Array<{ command: string }>)).toHaveLength(1);
    expect((config.preToolUse as Array<{ command: string }>)[0].command).toContain('unrelated.py');

    removeCursorCommandHook(config, 'preToolUse', 'fieldtheory-read-permission-hook.py');

    expect(hasCursorCommandHook(config, 'preToolUse', 'fieldtheory-read-permission-hook.py')).toBe(false);
    expect((config.preToolUse as Array<{ command: string }>)).toHaveLength(1);
    expect((config.preToolUse as Array<{ command: string }>)[0].command).toContain('unrelated.py');
  });
});

describe('generateCursorBeforeSubmitHookScript', () => {
  it('blocks immediately when the current project already has a pending job', () => {
    withTempHome((homeDir) => {
      const projectRoot = join(homeDir, 'workspace', 'app');
      const outputPath = join(homeDir, '.fieldtheory', 'librarian', 'artifacts', 'app-artifact.md');
      mkdirSync(projectRoot, { recursive: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'config.json'), { enabled: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'jobs', 'job_1.json'), {
        status: 'pending',
        project_path: projectRoot,
        output: outputPath,
      });

      const output = runHook(
        generateCursorBeforeSubmitHookScript(),
        homeDir,
        { workspace_roots: [projectRoot] },
        projectRoot,
      );
      const payload = JSON.parse(output);

      expect(payload.continue).toBe(false);
      expect(payload.user_message).toContain(outputPath);
      expect(payload.user_message).toContain('Retry your original prompt');
    });
  });

  it('ignores pending jobs from a different project', () => {
    withTempHome((homeDir) => {
      const currentProject = join(homeDir, 'workspace', 'current');
      const otherProject = join(homeDir, 'workspace', 'other');
      mkdirSync(currentProject, { recursive: true });
      mkdirSync(otherProject, { recursive: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'config.json'), { enabled: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'state.json'), { count: 0, threshold: 3 });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'jobs', 'job_1.json'), {
        status: 'pending',
        project_path: otherProject,
        output: join(homeDir, '.fieldtheory', 'librarian', 'artifacts', 'other-artifact.md'),
      });

      const output = runHook(
        generateCursorBeforeSubmitHookScript(),
        homeDir,
        { workspace_roots: [currentProject] },
        currentProject,
      );

      expect(output).toBe('');
      const state = JSON.parse(readFileSync(join(homeDir, '.fieldtheory', 'librarian', 'state.json'), 'utf8'));
      expect(state.count).toBe(1);
    });
  });

  it('creates a pending job for the current project and blocks the prompt when threshold is reached', () => {
    withTempHome((homeDir) => {
      const projectRoot = join(homeDir, 'workspace', 'app');
      mkdirSync(projectRoot, { recursive: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'config.json'), { enabled: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'state.json'), { count: 0, threshold: 1 });

      const output = runHook(
        generateCursorBeforeSubmitHookScript(),
        homeDir,
        { workspace_roots: [projectRoot] },
        projectRoot,
      );
      const payload = JSON.parse(output);
      const job = JSON.parse(readFileSync(join(homeDir, '.fieldtheory', 'librarian', 'jobs', 'job_1.json'), 'utf8'));

      expect(payload.continue).toBe(false);
      expect(job.status).toBe('pending');
      expect(job.project_path).toBe(realpathSync(projectRoot));
      expect(job.output).toContain('/artifacts/app-');
    });
  });
});

describe('generateCursorPreToolHookScript', () => {
  it('denies tool use only for the current project pending job', () => {
    withTempHome((homeDir) => {
      const projectRoot = join(homeDir, 'workspace', 'app');
      mkdirSync(projectRoot, { recursive: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'config.json'), { enabled: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'jobs', 'job_1.json'), {
        status: 'pending',
        project_path: projectRoot,
        output: join(homeDir, '.fieldtheory', 'librarian', 'artifacts', 'app-artifact.md'),
      });

      const output = runHook(
        generateCursorPreToolHookScript(),
        homeDir,
        { arguments: { file_path: join(projectRoot, 'src', 'file.ts') } },
        projectRoot,
      );
      const payload = JSON.parse(output);

      expect(payload.decision).toBe('deny');
      expect(payload.reason).toContain('app-artifact.md');
    });
  });

  it('allows tool use when only another project has a pending job', () => {
    withTempHome((homeDir) => {
      const currentProject = join(homeDir, 'workspace', 'current');
      const otherProject = join(homeDir, 'workspace', 'other');
      mkdirSync(currentProject, { recursive: true });
      mkdirSync(otherProject, { recursive: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'config.json'), { enabled: true });
      writeJson(join(homeDir, '.fieldtheory', 'librarian', 'jobs', 'job_1.json'), {
        status: 'pending',
        project_path: otherProject,
        output: join(homeDir, '.fieldtheory', 'librarian', 'artifacts', 'other-artifact.md'),
      });

      const output = runHook(
        generateCursorPreToolHookScript(),
        homeDir,
        { arguments: { file_path: join(currentProject, 'src', 'file.ts') } },
        currentProject,
      );
      const payload = JSON.parse(output);

      expect(payload.decision).toBe('allow');
    });
  });
});
