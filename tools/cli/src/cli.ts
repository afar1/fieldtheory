#!/usr/bin/env node
import { Command } from 'commander';
import { createDatasetManifest, loadDatasetManifest } from './manifest.js';
import { listFiles } from './fs.js';
import { datasetLatestPath, datasetManifestPath, datasetsDir, twitterBookmarksCachePath } from './paths.js';
import type { DatasetManifest } from './types.js';
import { enableDatasetJob, getDatasetJobStatus, listDatasetJobs, runDatasetJob } from './jobs.js';
import { syncTwitterBookmarks } from './bookmarks.js';
import { getBookmarkStatusView, buildBookmarksDatasetManifest, enableBookmarks, formatBookmarkStatus, formatBookmarkSummary } from './bookmarks-service.js';
import { loadTwitterOAuthToken, runTwitterOAuthFlow } from './xauth.js';
import { syncBookmarksGraphQL, formatSyncResult } from './graphql-bookmarks.js';
import { fetchBookmarkMediaBatch } from './bookmark-media.js';
import { buildIndex, searchBookmarks, formatSearchResults, getStats, classifyAndRebuild, getCategoryCounts, sampleByCategory, getDomainCounts } from './bookmarks-db.js';
import { formatClassificationSummary } from './bookmark-classify.js';
import { classifyWithLlm, classifyDomainsWithLlm } from './bookmark-classify-llm.js';
import { loadTheoriesConfig, saveTheoriesConfig, setTheoriesConfigValue, theoriesConfigPath, DEFAULTS as THEORIES_DEFAULTS, loadLenses, addLens, removeLens, BUILT_IN_LENSES } from './theories-config.js';
import type { Lens } from './theories-config.js';
import { renderViz } from './bookmarks-viz.js';

export function buildCli() {
  const program = new Command();

  program
    .name('ft')
    .description('Field Theory CLI for recurring dataset review and improvement, powered by OpenClaw.')
    .showHelpAfterError();

  // ── dataset commands ────────────────────────────────────────────────────

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
    .action(async () => {
      const manifest = buildBookmarksDatasetManifest();
      const out = await createDatasetManifest(manifest);
      console.log(`Created ${out}`);
      console.log('Next step: ft bookmarks sync');
    });

  dataset.command('list').description('List datasets').action(async () => {
    const files = (await listFiles(datasetsDir())).filter((name) => name.endsWith('.yaml'));
    if (files.length === 0) { console.log('No datasets found.'); return; }
    for (const file of files) console.log(file.replace(/\.yaml$/, ''));
  });

  dataset
    .command('show')
    .description('Show a dataset manifest')
    .requiredOption('--id <id>', 'Dataset id')
    .action(async (options) => {
      const id = String(options.id);
      const manifest = await loadDatasetManifest(id);
      console.log(datasetManifestPath(id));
      console.log(JSON.stringify(manifest, null, 2));
    });

  // ── job commands ────────────────────────────────────────────────────────

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

  job.command('list').description('List installed ft-managed OpenClaw cron jobs').action(async () => {
    const jobs = await listDatasetJobs();
    if (jobs.length === 0) { console.log('No ft-managed jobs found.'); return; }
    for (const j of jobs) {
      console.log(`${j.datasetId}\t${j.enabled ? 'enabled' : 'disabled'}\t${j.cronJobId ?? ''}`);
    }
  });

  job
    .command('run')
    .description('Run a dataset job manually')
    .requiredOption('--id <id>', 'Dataset id')
    .action(async (options) => {
      const result = await runDatasetJob(String(options.id));
      if (result.stdout.trim()) console.log(result.stdout.trim());
      if (result.stderr.trim()) console.error(result.stderr.trim());
    });

  // ── artifacts commands ──────────────────────────────────────────────────

  const artifacts = program.command('artifacts').description('Inspect dataset artifacts');
  artifacts
    .command('latest')
    .description('Show latest artifact summary path')
    .requiredOption('--id <id>', 'Dataset id')
    .action(async (options) => { console.log(datasetLatestPath(String(options.id))); });

  // ── bookmarks commands ─────────────────────────────────────────────────
  //
  //   ft bookmarks enable           → one-step: full sync + dataset init
  //   ft bookmarks sync             → full sync via GraphQL (Chrome session)
  //   ft bookmarks sync --incremental → incremental via OAuth v2 API (for cron)
  //   ft bookmarks auth             → OAuth setup (needed for --incremental)
  //   ft bookmarks status / summary → cache info
  //   ft bookmarks path             → print cache path

  const bookmarks = program.command('bookmarks').description('Manage local X bookmark cache');

  bookmarks
    .command('enable')
    .description('One-step setup: full sync + dataset initialization')
    .action(async () => {
      const result = await enableBookmarks();
      for (const line of result.messageLines) console.log(line);
    });

  bookmarks
    .command('sync')
    .description('Sync bookmarks into the local cache')
    .option('--incremental', 'Use OAuth v2 API for lightweight incremental sync (requires: ft bookmarks auth)', false)
    .option('--max-pages <n>', 'Max pages to fetch', (v) => Number(v), 500)
    .option('--target-adds <n>', 'Stop after this many new bookmarks', (v) => Number(v))
    .option('--delay-ms <n>', 'Delay between requests in ms', (v) => Number(v), 600)
    .option('--max-minutes <n>', 'Max runtime in minutes', (v) => Number(v), 30)
    .option('--chrome-user-data-dir <path>', 'Chrome user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome profile name (e.g. Default)')
    .action(async (options) => {
      if (options.incremental) {
        // Incremental via official OAuth v2 API — no browser needed, great for cron
        const result = await syncTwitterBookmarks('incremental', process.cwd(), {
          targetAdds: typeof options.targetAdds === 'number' && !Number.isNaN(options.targetAdds) ? options.targetAdds : undefined,
        });
        console.log(`Synced ${result.totalBookmarks} bookmarks (${result.added} new)`);
        console.log(`Cache: ${result.cachePath}`);
        if (result.added > 0) {
          process.stderr.write('Rebuilding search index...\n');
          const idx = await buildIndex();
          console.log(`Index: ${idx.dbPath} (${idx.recordCount} records)`);
        }
      } else {
        // Full sync via GraphQL — needs Chrome with active X session
        const result = await syncBookmarksGraphQL(process.cwd(), {
          maxPages: Number(options.maxPages) || 500,
          targetAdds: typeof options.targetAdds === 'number' && !Number.isNaN(options.targetAdds) ? options.targetAdds : undefined,
          delayMs: Number(options.delayMs) || 600,
          maxMinutes: Number(options.maxMinutes) || 30,
          chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
          chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
          onProgress: (status) => {
            if (status.page % 10 === 0 || status.done) {
              process.stderr.write(
                `\r[sync] page ${status.page} | fetched ${status.totalFetched} | new ${status.newAdded}${status.done ? ` | ${status.stopReason}\n` : ''}`
              );
            }
          },
        });
        console.log(formatSyncResult(result));
        if (result.added > 0) {
          process.stderr.write('Rebuilding search index...\n');
          const idx = await buildIndex();
          console.log(`Index: ${idx.dbPath} (${idx.recordCount} records)`);
        }
      }
    });

  bookmarks
    .command('auth')
    .description('Run OAuth 2.0 flow for incremental API sync (requires X API keys in .env.local)')
    .action(async () => {
      const result = await runTwitterOAuthFlow();
      console.log(`Saved token to ${result.tokenPath}`);
      if (result.scope) console.log(`Scope: ${result.scope}`);
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
    .command('status')
    .description('Show bookmark cache status')
    .action(async () => {
      const view = await getBookmarkStatusView();
      console.log(formatBookmarkStatus(view));
    });

  bookmarks
    .command('summary')
    .description('Show a concise bookmarks summary')
    .action(async () => {
      const view = await getBookmarkStatusView();
      console.log(formatBookmarkSummary(view));
    });

  bookmarks
    .command('fetch-media')
    .description('Download and store media for the first N bookmarks with media')
    .option('--limit <n>', 'How many media-bearing bookmarks to process', (v) => Number(v), 100)
    .option('--max-bytes <n>', 'Per-asset byte limit', (v) => Number(v), 50 * 1024 * 1024)
    .action(async (options) => {
      const result = await fetchBookmarkMediaBatch(process.cwd(), {
        limit: Number(options.limit) || 100,
        maxBytes: Number(options.maxBytes) || 50 * 1024 * 1024,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  bookmarks
    .command('index')
    .description('Build or rebuild the SQLite search index from the JSONL cache')
    .action(async () => {
      process.stderr.write('Building search index...\n');
      const result = await buildIndex();
      console.log(`Indexed ${result.recordCount} bookmarks → ${result.dbPath}`);
    });

  bookmarks
    .command('classify')
    .description('Classify bookmarks by type using Claude/Codex (requires Max/Pro login)')
    .option('--fast', 'Use regex-only classification (no LLM, <1s but misses ~85%)')
    .action(async (options) => {
      if (options.fast) {
        process.stderr.write('Classifying bookmarks with regex and rebuilding index...\n');
        const result = await classifyAndRebuild();
        console.log(`Indexed ${result.recordCount} bookmarks → ${result.dbPath}`);
        console.log(formatClassificationSummary(result.summary));
      } else {
        process.stderr.write('Classifying unclassified bookmarks with LLM...\n');
        const result = await classifyWithLlm(process.cwd(), {
          onBatch: (done, total) => {
            process.stderr.write(`  Processing ${done}/${total} bookmarks...\n`);
          },
        });
        console.log(`Engine: ${result.engine}`);
        console.log(`Classified ${result.classified}/${result.totalUnclassified} bookmarks (${result.batches} batches, ${result.failed} failed)`);
      }
    });

  bookmarks
    .command('sample')
    .description('Sample bookmarks by category (for debugging/previewing classification)')
    .argument('<category>', 'Category: tool, security, technique, launch, research, opinion, commerce')
    .option('--limit <n>', 'Max results', (v) => Number(v), 10)
    .action(async (category, options) => {
      const results = await sampleByCategory(category, Number(options.limit) || 10);
      if (results.length === 0) {
        console.log(`No bookmarks found with category "${category}". Run: ft bookmarks classify`);
        return;
      }
      for (const r of results) {
        const text = r.text.length > 120 ? r.text.slice(0, 120) + '...' : r.text;
        console.log(`[@${r.authorHandle ?? '?'}] ${text}`);
        console.log(`  ${r.url}  [${r.categories}]`);
        if (r.githubUrls) console.log(`  github: ${r.githubUrls}`);
        console.log();
      }
    });

  bookmarks
    .command('categories')
    .description('Show bookmark category distribution')
    .action(async () => {
      const counts = await getCategoryCounts();
      if (Object.keys(counts).length === 0) {
        console.log('No categories found. Run: ft bookmarks classify');
        return;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const [cat, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        const pct = ((count / total) * 100).toFixed(1);
        console.log(`  ${cat.padEnd(14)} ${String(count).padStart(5)}  (${pct}%)`);
      }
    });

  bookmarks
    .command('classify-domains')
    .description('Classify bookmarks by subject domain (ai, finance, devops, etc.) using LLM')
    .option('--all', 'Re-classify all bookmarks, not just ones missing domains')
    .action(async (options) => {
      process.stderr.write('Classifying bookmark domains with LLM...\n');
      const result = await classifyDomainsWithLlm(process.cwd(), {
        all: options.all ?? false,
        onBatch: (done, total) => {
          process.stderr.write(`  Processing ${done}/${total} bookmarks...\n`);
        },
      });
      console.log(`Engine: ${result.engine}`);
      console.log(`Classified ${result.classified}/${result.totalUnclassified} bookmarks (${result.batches} batches, ${result.failed} failed)`);
    });

  bookmarks
    .command('domains')
    .description('Show bookmark domain distribution')
    .action(async () => {
      const counts = await getDomainCounts();
      if (Object.keys(counts).length === 0) {
        console.log('No domains found. Run: ft bookmarks classify-domains');
        return;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const [dom, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        const pct = ((count / total) * 100).toFixed(1);
        console.log(`  ${dom.padEnd(20)} ${String(count).padStart(5)}  (${pct}%)`);
      }
    });

  bookmarks
    .command('search')
    .description('Full-text search across bookmarks')
    .argument('<query>', 'Search query (supports FTS5 syntax: AND, OR, NOT, "exact phrase")')
    .option('--author <handle>', 'Filter by author handle')
    .option('--after <date>', 'Only bookmarks posted after this date (YYYY-MM-DD)')
    .option('--before <date>', 'Only bookmarks posted before this date (YYYY-MM-DD)')
    .option('--limit <n>', 'Max results', (v) => Number(v), 20)
    .action(async (query, options) => {
      const results = await searchBookmarks({
        query,
        author: options.author ? String(options.author) : undefined,
        after: options.after ? String(options.after) : undefined,
        before: options.before ? String(options.before) : undefined,
        limit: Number(options.limit) || 20,
      });
      console.log(formatSearchResults(results));
    });

  bookmarks
    .command('stats')
    .description('Show aggregate statistics from the search index')
    .action(async () => {
      const stats = await getStats();
      console.log(`Bookmarks: ${stats.totalBookmarks}`);
      console.log(`Unique authors: ${stats.uniqueAuthors}`);
      console.log(`Date range: ${stats.dateRange.earliest?.slice(0, 10) ?? '?'} to ${stats.dateRange.latest?.slice(0, 10) ?? '?'}`);
      console.log(`\nTop authors:`);
      for (const a of stats.topAuthors) console.log(`  @${a.handle}: ${a.count}`);
      console.log(`\nLanguages:`);
      for (const l of stats.languageBreakdown) console.log(`  ${l.language}: ${l.count}`);
    });

  bookmarks
    .command('viz')
    .description('Visual dashboard of your bookmarking patterns')
    .action(async () => {
      console.log(await renderViz());
    });

  bookmarks
    .command('path')
    .description('Show bookmark cache file path')
    .action(async () => { console.log(twitterBookmarksCachePath()); });

  // ── theories commands ────────────────────────────────────────────────
  const theories = program.command('theories').description('Configure theories overnight analysis');

  theories
    .command('config')
    .description('Show or edit theories configuration')
    .option('--show', 'Display current configuration')
    .option('--set <key=value>', 'Set a config value (e.g. runtime.email=me@x.com)')
    .option('--reset', 'Reset to defaults')
    .action(async (options) => {
      if (options.set) {
        const eqIdx = options.set.indexOf('=');
        if (eqIdx < 0) { console.error('Usage: ft theories config --set key=value'); process.exitCode = 1; return; }
        const key = options.set.slice(0, eqIdx);
        const val = options.set.slice(eqIdx + 1);
        const config = await setTheoriesConfigValue(key, val);
        console.log(`Set ${key}`);
        console.log(JSON.stringify(config, null, 2));
        return;
      }
      if (options.reset) {
        const configPath = await saveTheoriesConfig(structuredClone(THEORIES_DEFAULTS));
        console.log(`Reset to defaults: ${configPath}`);
        return;
      }
      // Default: show
      const config = await loadTheoriesConfig();
      console.log(`Config: ${theoriesConfigPath()}`);
      console.log(JSON.stringify(config, null, 2));
    });

  // ── lens commands ──────────────────────────────────────────────────────
  const lens = theories.command('lens').description('Manage analysis lenses (how bookmarks are matched to repos)');

  lens
    .command('ls')
    .description('List all lenses')
    .action(async () => {
      const all = await loadLenses();
      const builtInNames = new Set(BUILT_IN_LENSES.map(l => l.name));
      for (const l of all) {
        const tag = builtInNames.has(l.name) ? '[built-in]' : '[custom]';
        const domain = l.domain_filter ? '(domain-matched)' : '';
        console.log(`  ${l.name.padEnd(12)} ${l.title.padEnd(35)} ${domain.padEnd(18)} ${tag}`);
      }
    });

  lens
    .command('add')
    .description('Add a custom lens')
    .requiredOption('--name <name>', 'Short slug (e.g. audit, accessibility)')
    .requiredOption('--title <title>', 'Display title (e.g. "Compliance & legal audit")')
    .requiredOption('--categories <cats>', 'Comma-separated bookmark categories to match (e.g. legal,opinion)')
    .requiredOption('--hint <hint>', 'Analysis prompt — what to do with these bookmarks against the repo')
    .option('--domain-filter', 'Prefer bookmarks matching the repo\'s domain', false)
    .option('--system-prompt <type>', 'analyst or explorer', 'analyst')
    .option('--limit <n>', 'Max bookmarks per job', '20')
    .action(async (options) => {
      const newLens: Lens = {
        name: options.name,
        title: options.title,
        category_filter: options.categories,
        domain_filter: options.domainFilter ?? false,
        prompt_hint: options.hint,
        system_prompt: options.systemPrompt === 'explorer' ? 'explorer' : 'analyst',
        repo_pick: 'any',
        limit: Number(options.limit) || 20,
      };
      await addLens(newLens);
      console.log(`Added lens "${newLens.name}" — ${newLens.title}`);
    });

  lens
    .command('remove')
    .description('Remove a custom lens')
    .argument('<name>', 'Lens name to remove')
    .action(async (name) => {
      try {
        const removed = await removeLens(name);
        if (removed) {
          console.log(`Removed lens "${name}"`);
        } else {
          console.log(`No custom lens named "${name}" found`);
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  lens
    .command('show')
    .description('Show details of a specific lens')
    .argument('<name>', 'Lens name')
    .action(async (name) => {
      const all = await loadLenses();
      const l = all.find(x => x.name === name);
      if (!l) { console.log(`No lens named "${name}"`); return; }
      console.log(JSON.stringify(l, null, 2));
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildCli().parseAsync(process.argv);
}
