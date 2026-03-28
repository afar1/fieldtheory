#!/usr/bin/env node
import { Command } from 'commander';
import { createDatasetManifest, loadDatasetManifest } from './manifest.js';
import { listFiles, pathExists } from './fs.js';
import { datasetLatestPath, datasetManifestPath, datasetsDir, twitterBookmarksCachePath } from './paths.js';
import type { DatasetManifest } from './types.js';
import { enableDatasetJob, getDatasetJobStatus, listDatasetJobs, runDatasetJob } from './jobs.js';
import { debugTwitterBookmarkPagination, getTwitterBookmarksStatus, probeTwitterBookmarksApi, probeTwitterBookmarksOAuth, syncTwitterBookmarks } from './bookmarks.js';
import { loadTwitterOAuthToken, runTwitterOAuthFlow } from './xauth.js';

export function buildCli() {
  const program = new Command();

  program
    .name('ft')
    .description('Field Theory CLI for recurring dataset review and improvement, powered by OpenClaw.')
    .showHelpAfterError();

  const dataset = program.command('dataset').description('Manage dataset manifests');

  dataset
    .command('add-repo')
    .description('Create a repo dataset')
    .requiredOption('--id <id>', 'Dataset id')
    .requiredOption('--path <path>', 'Path to local repo')
    .option('--git-notes', 'Enable git-notes memory for this repo dataset', false)
    .action(async (options) => {
      const manifest: DatasetManifest = {
        id: String(options.id),
        kind: 'repo',
        source: { path: String(options.path) },
        initiative: 'suggest',
        budget: { effort: 'medium' },
        delivery: { onlyWhenWorthwhile: true, channel: 'email' },
        gitNotes: Boolean(options.gitNotes),
      };
      const out = await createDatasetManifest(manifest);
      console.log(`Created ${out}`);
    });

  dataset
    .command('add-files')
    .description('Create a files dataset')
    .requiredOption('--id <id>', 'Dataset id')
    .requiredOption('--path <path>', 'Path to files/directory')
    .action(async (options) => {
      const manifest: DatasetManifest = {
        id: String(options.id),
        kind: 'files',
        source: { path: String(options.path) },
        initiative: 'suggest',
        budget: { effort: 'low' },
        delivery: { onlyWhenWorthwhile: true, channel: 'email' },
      };
      const out = await createDatasetManifest(manifest);
      console.log(`Created ${out}`);
    });

  dataset
    .command('add-bookmarks')
    .description('Create an X bookmarks dataset backed by local cache')
    .requiredOption('--id <id>', 'Dataset id')
    .option('--twitter', 'Use the X/Twitter bookmark cache source', true)
    .action(async (options) => {
      const cachePath = twitterBookmarksCachePath();
      const manifest: DatasetManifest = {
        id: String(options.id),
        kind: 'bookmarks',
        source: { provider: 'twitter', path: cachePath },
        initiative: 'suggest',
        budget: { effort: 'medium' },
        delivery: { onlyWhenWorthwhile: true, channel: 'email' },
        context:
          'Review the full bookmark corpus. Consider recency, but also surface older items when they become newly relevant, reveal durable themes, or connect strongly to active work.',
      };
      const out = await createDatasetManifest(manifest);
      console.log(`Created ${out}`);
      if (!(await pathExists(cachePath))) {
        console.log(`Note: bookmark cache not found yet at ${cachePath}`);
        console.log('Next step: ft bookmarks sync --full');
      }
    });

  dataset.command('list').description('List datasets').action(async () => {
    const files = (await listFiles(datasetsDir())).filter((name) => name.endsWith('.yaml'));
    if (files.length === 0) {
      console.log('No datasets found.');
      return;
    }
    for (const file of files) console.log(file.replace(/\.yaml$/, ''));
  });

  dataset
    .command('show')
    .description('Show a dataset manifest path and parsed summary')
    .requiredOption('--id <id>', 'Dataset id')
    .action(async (options) => {
      const id = String(options.id);
      const manifest = await loadDatasetManifest(id);
      console.log(datasetManifestPath(id));
      console.log(JSON.stringify(manifest, null, 2));
    });

  const job = program.command('job').description('Manage recurring OpenClaw-backed dataset jobs');
  job
    .command('enable')
    .description('Create or update an OpenClaw cron job for a dataset')
    .requiredOption('--id <id>', 'Dataset id')
    .requiredOption('--cron <expr>', 'Cron expression')
    .action(async (options) => {
      const result = await enableDatasetJob(String(options.id), String(options.cron));
      if (result.stdout.trim()) console.log(result.stdout.trim());
      if (result.stderr.trim()) console.error(result.stderr.trim());
      console.log(`Installed cron job for dataset ${String(options.id)}`);
    });

  job
    .command('status')
    .description('Show installed OpenClaw cron status for one dataset')
    .requiredOption('--id <id>', 'Dataset id')
    .action(async (options) => {
      const status = await getDatasetJobStatus(String(options.id));
      console.log(JSON.stringify(status, null, 2));
    });

  job
    .command('list')
    .description('List installed ft-managed OpenClaw cron jobs')
    .action(async () => {
      const jobs = await listDatasetJobs();
      if (jobs.length === 0) {
        console.log('No ft-managed jobs found.');
        return;
      }
      for (const job of jobs) {
        console.log(`${job.datasetId}\t${job.enabled ? 'enabled' : 'disabled'}\t${job.cronJobId ?? ''}`);
      }
    });

  job
    .command('run')
    .description('Run a dataset job manually via its installed OpenClaw cron job')
    .requiredOption('--id <id>', 'Dataset id')
    .action(async (options) => {
      const result = await runDatasetJob(String(options.id));
      if (result.stdout.trim()) console.log(result.stdout.trim());
      if (result.stderr.trim()) console.error(result.stderr.trim());
    });

  const artifacts = program.command('artifacts').description('Inspect dataset artifacts');
  artifacts
    .command('latest')
    .description('Show latest artifact summary path')
    .requiredOption('--id <id>', 'Dataset id')
    .action(async (options) => {
      console.log(datasetLatestPath(String(options.id)));
    });

  const source = program.command('source').description('Manage external sources');
  source
    .command('sync-twitter-bookmarks')
    .description('Compatibility alias for bookmark sync')
    .action(async () => {
      const result = await syncTwitterBookmarks('incremental');
      console.log(`Synced ${result.totalBookmarks} bookmarks (added ${result.added})`);
      console.log(result.cachePath);
    });

  const bookmarks = program.command('bookmarks').description('Manage local X bookmark cache');
  bookmarks
    .command('auth')
    .description('Run OAuth 2.0 user-context auth flow for bookmark access')
    .action(async () => {
      const result = await runTwitterOAuthFlow();
      console.log(`Saved token to ${result.tokenPath}`);
      if (result.scope) console.log(`Scope: ${result.scope}`);
    });

  bookmarks
    .command('probe')
    .description('Probe whether the current X API configuration can read bookmarks')
    .option('--oauth', 'Probe using saved OAuth user token instead of app bearer token', false)
    .action(async (options) => {
      const result = options.oauth ? await probeTwitterBookmarksOAuth() : await probeTwitterBookmarksApi();
      console.log(JSON.stringify(result, null, 2));
    });

  bookmarks
    .command('token-status')
    .description('Show whether a local OAuth user token is present')
    .action(async () => {
      const token = await loadTwitterOAuthToken();
      console.log(JSON.stringify({
        present: Boolean(token?.access_token),
        scope: token?.scope ?? null,
        obtained_at: token?.obtained_at ?? null,
      }, null, 2));
    });

  bookmarks
    .command('sync')
    .description('Sync bookmarks into the local cache')
    .option('--full', 'Run a full sync instead of incremental', false)
    .option('--target-adds <n>', 'Stop once this many new bookmarks have been added', (value) => Number(value))
    .action(async (options) => {
      const result = await syncTwitterBookmarks(options.full ? 'full' : 'incremental', process.cwd(), {
        targetAdds: typeof options.targetAdds === 'number' && !Number.isNaN(options.targetAdds) ? options.targetAdds : undefined,
      });
      console.log(`Synced ${result.totalBookmarks} bookmarks (added ${result.added})`);
      console.log(`Cache: ${result.cachePath}`);
      console.log(`Meta: ${result.metaPath}`);
    });

  bookmarks
    .command('status')
    .description('Show bookmark cache status')
    .action(async () => {
      const status = await getTwitterBookmarksStatus();
      console.log(JSON.stringify(status, null, 2));
    });

  bookmarks
    .command('debug-pagination')
    .description('Inspect bookmark pagination behavior for a few pages')
    .option('--pages <n>', 'How many pages to inspect', (value) => Number(value), 5)
    .action(async (options) => {
      const result = await debugTwitterBookmarkPagination(process.cwd(), Number(options.pages) || 5);
      console.log(JSON.stringify(result, null, 2));
    });

  bookmarks
    .command('path')
    .description('Show bookmark cache path')
    .action(async () => {
      console.log(twitterBookmarksCachePath());
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildCli().parseAsync(process.argv);
}
