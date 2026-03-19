import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeStubCommand(dir: string, name: string, output: string): void {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `#!/usr/bin/env bash\ncat <<'OUT'\n${output}\nOUT\n`);
  fs.chmodSync(filePath, 0o755);
}

function writeStubScript(dir: string, name: string, body: string): void {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  fs.chmodSync(filePath, 0o755);
}

function runCouncil(
  args: string[],
  fakeBinDir: string,
  extraEnv: Record<string, string> = {}
) {
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'council.sh');
  return spawnSync('bash', [scriptPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

function runCouncilWithStubbedProviders(
  claudeOutput: string,
  codexOutput: string,
  extraEnv: Record<string, string> = {},
  extraArgs: string[] = []
) {
  const fakeBinDir = makeTempDir('council-fake-bin-');
  const transcriptDir = makeTempDir('council-transcript-');

  writeStubCommand(fakeBinDir, 'claude', claudeOutput);
  writeStubCommand(fakeBinDir, 'codex', codexOutput);

  const result = runCouncil(
    [
      '--json-events',
      '--max-turns',
      '1',
      '--matchup',
      'opus-vs-codex',
      '--transcript-dir',
      transcriptDir,
      ...extraArgs,
      'stub debate',
    ],
    fakeBinDir,
    extraEnv
  );

  const transcriptFile = fs.readdirSync(transcriptDir).find(
    (name) => name.endsWith('.md') && !name.endsWith('_consensus.md')
  );

  return {
    ...result,
    fakeBinDir,
    transcriptDir,
    transcriptPath: transcriptFile ? path.join(transcriptDir, transcriptFile) : null,
  };
}

describe('council.sh', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('does not crash when a turn has no token usage lines', () => {
    const result = runCouncilWithStubbedProviders(
      [
        'Opus stub response.',
        '<<<COUNCIL_SIGNAL>>>',
        'convergence: high',
        'action: finalize',
        '<<<END_SIGNAL>>>',
      ].join('\n'),
      [
        'Codex stub response.',
        '<<<COUNCIL_SIGNAL>>>',
        'convergence: high',
        'action: finalize',
        '<<<END_SIGNAL>>>',
      ].join('\n')
    );

    cleanupDirs.push(result.fakeBinDir, result.transcriptDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"type": "turn_end"');
    expect(result.transcriptPath).not.toBeNull();

    const transcript = fs.readFileSync(result.transcriptPath!, 'utf8');
    expect(transcript).toContain('## Opus — Turn 1');
    expect(transcript).toContain('## Codex — Turn 1');
    expect(transcript).not.toContain('*Tokens*:');
  });

  it('records parsed token usage in events and transcript summaries', () => {
    const result = runCouncilWithStubbedProviders(
      [
        'Opus stub response.',
        'input: 120',
        'output: 45',
        'total: 165',
        '<<<COUNCIL_SIGNAL>>>',
        'convergence: high',
        'action: finalize',
        '<<<END_SIGNAL>>>',
      ].join('\n'),
      [
        'Codex stub response.',
        'tokens used',
        'input: 80',
        'output: 20',
        'total: 100',
        '<<<COUNCIL_SIGNAL>>>',
        'convergence: high',
        'action: finalize',
        '<<<END_SIGNAL>>>',
      ].join('\n')
    );

    cleanupDirs.push(result.fakeBinDir, result.transcriptDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"inputTokens": "120"');
    expect(result.stdout).toContain('"totalTokens": "165"');
    expect(result.stdout).toContain('"inputTokens": "80"');
    expect(result.stdout).toContain('"totalTokens": "100"');
    expect(result.transcriptPath).not.toBeNull();

    const transcript = fs.readFileSync(result.transcriptPath!, 'utf8');
    expect(transcript).toContain('*Tokens*: input 120 · output 45 · total 165');
    expect(transcript).toContain('*Tokens*: input 80 · output 20 · total 100');
    expect(transcript).toContain('## Token Summary');
  });

  it('retries a signal-only response and records the successful retry output', () => {
    const fakeBinDir = makeTempDir('council-fake-bin-');
    const transcriptDir = makeTempDir('council-transcript-');
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'council.sh');
    const codexCountPath = path.join(fakeBinDir, 'codex-count.txt');

    writeStubCommand(fakeBinDir, 'claude', [
      'Opus stub response.',
      '<<<COUNCIL_SIGNAL>>>',
      'convergence: medium',
      'action: continue',
      '<<<END_SIGNAL>>>',
    ].join('\n'));

    writeStubScript(fakeBinDir, 'codex', `
count=0
if [[ -f "${codexCountPath}" ]]; then
  count=$(cat "${codexCountPath}")
fi
count=$((count + 1))
printf '%s' "$count" > "${codexCountPath}"
if [[ "$count" -eq 1 ]]; then
  cat <<'OUT'
<<<COUNCIL_SIGNAL>>>
convergence: medium
action: continue
<<<END_SIGNAL>>>
OUT
else
  cat <<'OUT'
Codex retry produced real content.
<<<COUNCIL_SIGNAL>>>
convergence: high
action: finalize
<<<END_SIGNAL>>>
OUT
fi
`);

    const result = spawnSync(
      'bash',
      [
        scriptPath,
        '--json-events',
        '--max-turns',
        '1',
        '--matchup',
        'opus-vs-codex',
        '--transcript-dir',
        transcriptDir,
        'stub debate',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
          COUNCIL_TURN_EMPTY_RETRY_LIMIT: '1',
        },
        encoding: 'utf8',
      }
    );

    cleanupDirs.push(fakeBinDir, transcriptDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"type": "turn_status"');
    expect(result.stdout).toContain('"phase": "retrying"');

    const transcriptFile = fs.readdirSync(transcriptDir).find(
      (name) => name.endsWith('.md') && !name.endsWith('_consensus.md')
    );
    expect(transcriptFile).toBeTruthy();
    const transcript = fs.readFileSync(path.join(transcriptDir, transcriptFile!), 'utf8');
    expect(transcript).toContain('Codex retry produced real content.');
    expect(transcript).not.toContain('[Failed to produce a substantive response.]');
  });

  it('emits heartbeat status events while waiting for first output', { timeout: 10_000 }, () => {
    const fakeBinDir = makeTempDir('council-fake-bin-');
    const transcriptDir = makeTempDir('council-transcript-');
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'council.sh');

    writeStubCommand(fakeBinDir, 'claude', [
      'Opus stub response.',
      '<<<COUNCIL_SIGNAL>>>',
      'convergence: medium',
      'action: continue',
      '<<<END_SIGNAL>>>',
    ].join('\n'));

    writeStubScript(fakeBinDir, 'codex', `
sleep 2
cat <<'OUT'
Codex eventual output.
<<<COUNCIL_SIGNAL>>>
convergence: high
action: finalize
<<<END_SIGNAL>>>
OUT
`);

    const result = spawnSync(
      'bash',
      [
        scriptPath,
        '--json-events',
        '--max-turns',
        '1',
        '--matchup',
        'opus-vs-codex',
        '--transcript-dir',
        transcriptDir,
        'stub debate',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
          COUNCIL_TURN_HEARTBEAT_INTERVAL: '1',
        },
        encoding: 'utf8',
      }
    );

    cleanupDirs.push(fakeBinDir, transcriptDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"type": "turn_status"');
    expect(result.stdout).toContain('"phase": "waiting"');
    expect(result.stdout).toContain('still active and working');
  });

  it('starts with side B when --start-side b is provided for a fresh run', () => {
    const result = runCouncilWithStubbedProviders(
      [
        'Opus responds second.',
        '<<<COUNCIL_SIGNAL>>>',
        'convergence: high',
        'action: finalize',
        '<<<END_SIGNAL>>>',
      ].join('\n'),
      [
        'Codex opens first.',
        '<<<COUNCIL_SIGNAL>>>',
        'convergence: high',
        'action: finalize',
        '<<<END_SIGNAL>>>',
      ].join('\n'),
      {},
      ['--start-side', 'b'],
    );

    cleanupDirs.push(result.fakeBinDir, result.transcriptDir);

    expect(result.status).toBe(0);
    expect(result.transcriptPath).not.toBeNull();

    const transcript = fs.readFileSync(result.transcriptPath!, 'utf8');
    expect(transcript.indexOf('## Codex — Turn 1')).toBeGreaterThanOrEqual(0);
    expect(transcript.indexOf('## Opus — Turn 1')).toBeGreaterThan(transcript.indexOf('## Codex — Turn 1'));
  });

  it('writes a resume state file and exits paused when both models request human input in JSON mode', () => {
    const fakeBinDir = makeTempDir('council-fake-bin-');
    const transcriptDir = makeTempDir('council-transcript-');
    const stateFilePath = path.join(transcriptDir, 'paused.state.json');

    writeStubCommand(fakeBinDir, 'claude', [
      'Opus asks for input.',
      '<<<COUNCIL_SIGNAL>>>',
      'convergence: medium',
      'action: pause',
      '<<<END_SIGNAL>>>',
    ].join('\n'));
    writeStubCommand(fakeBinDir, 'codex', [
      'Codex also asks for input.',
      '<<<COUNCIL_SIGNAL>>>',
      'convergence: medium',
      'action: pause',
      '<<<END_SIGNAL>>>',
    ].join('\n'));

    const result = runCouncil(
      [
        '--json-events',
        '--max-turns',
        '1',
        '--matchup',
        'opus-vs-codex',
        '--transcript-dir',
        transcriptDir,
        '--state-file',
        stateFilePath,
        'stub debate',
      ],
      fakeBinDir
    );

    cleanupDirs.push(fakeBinDir, transcriptDir);

    expect(result.status).toBe(42);
    expect(result.stdout).toContain('"type": "pause_requested"');
    expect(fs.existsSync(stateFilePath)).toBe(true);

    const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    expect(state.state).toBe('PAUSED');
    expect(state.round).toBe(1);
    expect(state.topic).toBe('stub debate');

    const transcript = fs.readFileSync(state.transcript, 'utf8');
    expect(transcript).toContain('Both models requested human input at turn 1');
  });

  it('resumes from a saved state file and injects human guidance before continuing', () => {
    const fakeBinDir = makeTempDir('council-fake-bin-');
    const transcriptDir = makeTempDir('council-transcript-');
    const stateFilePath = path.join(transcriptDir, 'paused.state.json');
    const humanInputPath = path.join(transcriptDir, 'human-input.txt');

    writeStubCommand(fakeBinDir, 'claude', [
      'Opus asks for input.',
      '<<<COUNCIL_SIGNAL>>>',
      'convergence: medium',
      'action: pause',
      '<<<END_SIGNAL>>>',
    ].join('\n'));
    writeStubCommand(fakeBinDir, 'codex', [
      'Codex also asks for input.',
      '<<<COUNCIL_SIGNAL>>>',
      'convergence: medium',
      'action: pause',
      '<<<END_SIGNAL>>>',
    ].join('\n'));

    const firstRun = runCouncil(
      [
        '--json-events',
        '--max-turns',
        '1',
        '--matchup',
        'opus-vs-codex',
        '--transcript-dir',
        transcriptDir,
        '--state-file',
        stateFilePath,
        'stub debate',
      ],
      fakeBinDir
    );

    expect(firstRun.status).toBe(42);

    writeStubCommand(fakeBinDir, 'claude', [
      'Resume final output from Opus.',
      '<<<COUNCIL_SIGNAL>>>',
      'convergence: high',
      'action: finalize',
      '<<<END_SIGNAL>>>',
    ].join('\n'));
    writeStubCommand(fakeBinDir, 'codex', [
      'Resume final output from Codex.',
      '<<<COUNCIL_SIGNAL>>>',
      'convergence: high',
      'action: finalize',
      '<<<END_SIGNAL>>>',
    ].join('\n'));
    fs.writeFileSync(humanInputPath, 'Please continue with a concrete implementation plan.', 'utf8');

    const resumed = runCouncil(
      [
        '--json-events',
        '--resume-state',
        stateFilePath,
        '--human-input-file',
        humanInputPath,
      ],
      fakeBinDir
    );

    cleanupDirs.push(fakeBinDir, transcriptDir);

    expect(resumed.status).toBe(0);
    expect(resumed.stdout).toContain('"type": "resume_started"');
    expect(resumed.stdout).toContain('"type": "debate_complete"');

    const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    const transcript = fs.readFileSync(state.transcript, 'utf8');
    expect(transcript).toContain('Opus asks for input.');
    expect(transcript).toContain('Human guidance');
    expect(transcript).toContain('Please continue with a concrete implementation plan.');
    expect(transcript).toContain('Resume final output from Opus.');
    expect(transcript).toContain('Resume final output from Codex.');
  });
});
