import { describe, expect, it } from 'vitest';

import {
  classifyParakeetPythonPreflight,
  parsePythonVersionOutput,
} from './parakeetPythonPreflight';

describe('Parakeet Python preflight', () => {
  it('parses Python version output', () => {
    expect(parsePythonVersionOutput('Python 3.12.7')).toEqual({ major: 3, minor: 12, patch: 7 });
    expect(parsePythonVersionOutput('Python 3.10')).toEqual({ major: 3, minor: 10, patch: null });
    expect(parsePythonVersionOutput('not python')).toBeNull();
  });

  it('returns missing-python when no Python candidate is found', () => {
    const result = classifyParakeetPythonPreflight([
      { command: 'python3.12', found: false },
      { command: 'python3', found: false },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.setupError.code).toBe('missing-python');
      expect(result.setupError.recoveryCommand).toBe('brew install python@3.12');
    }
  });

  it('returns unsupported-python when only Python 3.9 is found', () => {
    const result = classifyParakeetPythonPreflight([
      {
        command: 'python3',
        found: true,
        versionOutput: 'Python 3.9.6',
        version: { major: 3, minor: 9, patch: 6 },
        venvOk: false,
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.setupError.code).toBe('unsupported-python');
      expect(result.setupError.detail).toContain('3.9.6');
    }
  });

  it('returns a usable Python command for Python 3.10 or newer with venv', () => {
    const result = classifyParakeetPythonPreflight([
      {
        command: 'python3.10',
        found: true,
        versionOutput: 'Python 3.10.14',
        version: { major: 3, minor: 10, patch: 14 },
        venvOk: true,
      },
    ]);

    expect(result).toEqual({
      ok: true,
      pythonCommand: 'python3.10',
      detail: 'python3.10: Python 3.10.14',
    });
  });

  it('returns python-venv-failed when supported Python cannot create a venv', () => {
    const result = classifyParakeetPythonPreflight([
      {
        command: 'python3.12',
        found: true,
        versionOutput: 'Python 3.12.7',
        version: { major: 3, minor: 12, patch: 7 },
        venvOk: false,
        error: 'No module named venv',
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.setupError.code).toBe('python-venv-failed');
      expect(result.setupError.detail).toContain('No module named venv');
    }
  });
});
