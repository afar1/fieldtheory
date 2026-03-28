import { loadDatasetManifest } from './manifest.js';
import { listOpenClawCronJobs, runOpenClaw } from './openclaw.js';

export function buildDatasetJobName(id: string): string {
  return `ft:${id}`;
}

export function buildDatasetJobPrompt(id: string): string {
  return [
    `Read automation/datasets/${id}.yaml.`,
    '',
    `Then read the corresponding state folder under automation/dataset-state/${id}/:`,
    '- state.json if present',
    '- latest.md if present',
    '- a small number of recent artifacts if useful',
    '',
    'Inspect the dataset described in the manifest.',
    '',
    'Perform one bounded continuous-improvement pass over this dataset.',
    'Look for worthwhile improvements, useful questions, novel ideas, meaningful risks, or small reversible prototypes.',
    '',
    'Do not produce routine status updates.',
    'Do not notify just because you found something mildly interesting.',
    'Only surface something if it is genuinely worth the user’s attention.',
    '',
    `If you produce a worthwhile result:`,
    `1. write/update durable outputs in automation/dataset-state/${id}/`,
    '2. summarize concisely what is worth attention',
    '',
    'If nothing worthwhile is found, update state minimally if needed and otherwise stay quiet.',
  ].join('\n');
}

export interface OpenClawCommandSummary {
  stdout: string;
  stderr: string;
}

export interface OpenClawEnableResult extends OpenClawCommandSummary {
  prompt: string;
}

export interface DatasetJobStatus {
  datasetId: string;
  jobName: string;
  found: boolean;
  cronJobId?: string;
  enabled?: boolean;
  raw?: unknown;
}

export async function enableDatasetJob(id: string, cronExpr: string, cwd = process.cwd()): Promise<OpenClawEnableResult> {
  await loadDatasetManifest(id, cwd);
  const prompt = buildDatasetJobPrompt(id);
  const result = await runOpenClaw(
    [
      'cron',
      'add',
      '--name',
      buildDatasetJobName(id),
      '--cron',
      cronExpr,
      '--session',
      'isolated',
      '--message',
      prompt,
      '--no-deliver',
    ],
    cwd
  );
  return {
    prompt,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function getDatasetJobStatus(id: string, cwd = process.cwd()): Promise<DatasetJobStatus> {
  const jobs = await listOpenClawCronJobs(cwd);
  const jobName = buildDatasetJobName(id);
  const match = jobs.find((job) => job.name === jobName);

  if (!match) {
    return {
      datasetId: id,
      jobName,
      found: false,
    };
  }

  return {
    datasetId: id,
    jobName,
    found: true,
    cronJobId: String(match.jobId ?? match.id ?? ''),
    enabled: match.enabled,
    raw: match,
  };
}

export async function listDatasetJobs(cwd = process.cwd()): Promise<DatasetJobStatus[]> {
  const jobs = await listOpenClawCronJobs(cwd);
  return jobs
    .filter((job) => typeof job.name === 'string' && job.name.startsWith('ft:'))
    .map((job) => ({
      datasetId: String(job.name).replace(/^ft:/, ''),
      jobName: String(job.name),
      found: true,
      cronJobId: String(job.jobId ?? job.id ?? ''),
      enabled: job.enabled,
      raw: job,
    }));
}

export async function runDatasetJob(id: string, cwd = process.cwd()): Promise<OpenClawCommandSummary> {
  const status = await getDatasetJobStatus(id, cwd);
  if (!status.found || !status.cronJobId) {
    throw new Error(`No OpenClaw cron job found for dataset ${id}. Run: ft job enable --id ${id} --cron "0 7 * * *"`);
  }

  const result = await runOpenClaw(['cron', 'run', status.cronJobId], cwd);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
