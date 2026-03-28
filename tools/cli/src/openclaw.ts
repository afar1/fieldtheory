import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface OpenClawCommandResult {
  stdout: string;
  stderr: string;
}

export async function runOpenClaw(args: string[], cwd = process.cwd()): Promise<OpenClawCommandResult> {
  const result = await execFileAsync('openclaw', args, { cwd });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export interface CronListJob {
  id?: string;
  jobId?: string;
  name?: string;
  enabled?: boolean;
  schedule?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export async function listOpenClawCronJobs(cwd = process.cwd()): Promise<CronListJob[]> {
  const result = await runOpenClaw(['cron', 'list', '--json'], cwd);
  const parsed = JSON.parse(result.stdout);
  if (Array.isArray(parsed)) return parsed as CronListJob[];
  if (Array.isArray(parsed.jobs)) return parsed.jobs as CronListJob[];
  return [];
}
