import { createDatasetManifest } from './manifest.js';
import { getTwitterBookmarksStatus } from './bookmarks.js';
import { datasetManifestPath, twitterBookmarksCachePath } from './paths.js';
import { pathExists } from './fs.js';
import type { DatasetManifest } from './types.js';
import { loadTwitterOAuthToken } from './xauth.js';
import { syncBookmarksGraphQL } from './graphql-bookmarks.js';

export interface BookmarkEnableResult {
  synced: boolean;
  datasetCreated: boolean;
  bookmarkCount: number;
  cachePath: string;
  messageLines: string[];
}

export interface BookmarkStatusView {
  connected: boolean;
  bookmarkCount: number;
  lastUpdated: string | null;
  mode: string;
  cachePath: string;
  datasetInitialized: boolean;
}

export function buildBookmarksDatasetManifest(cwd = process.cwd()): DatasetManifest {
  return {
    id: 'x-bookmarks',
    kind: 'bookmarks',
    source: { provider: 'twitter', path: twitterBookmarksCachePath(cwd) },
    initiative: 'suggest',
    budget: { effort: 'medium' },
    delivery: { onlyWhenWorthwhile: true, channel: 'email' },
    context:
      'Review the full bookmark corpus. Consider recency, but also surface older items when they become newly relevant, reveal durable themes, or connect strongly to active work.',
  };
}

export async function enableBookmarks(cwd = process.cwd()): Promise<BookmarkEnableResult> {
  const syncResult = await syncBookmarksGraphQL(cwd, {
    onProgress: (status) => {
      if (status.page % 25 === 0 || status.done) {
        process.stderr.write(
          `\r[sync] page ${status.page} | ${status.totalFetched} fetched | ${status.newAdded} new${status.done ? ` | ${status.stopReason}\n` : ''}`
        );
      }
    },
  });

  const manifestPath = datasetManifestPath('x-bookmarks', cwd);
  let datasetCreated = false;
  if (!(await pathExists(manifestPath))) {
    await createDatasetManifest(buildBookmarksDatasetManifest(cwd), cwd);
    datasetCreated = true;
  }

  return {
    synced: true,
    datasetCreated,
    bookmarkCount: syncResult.totalBookmarks,
    cachePath: syncResult.cachePath,
    messageLines: [
      'Field Theory Bookmarks enabled.',
      `- sync completed: ${syncResult.totalBookmarks} bookmarks (${syncResult.added} new)`,
      `- dataset initialized: ${datasetCreated ? 'yes' : 'already present'}`,
      `- cache: ${syncResult.cachePath}`,
      '',
      'For API-based sync via the v2 API:',
      '  1. Set X_API_KEY, X_API_SECRET, X_CLIENT_ID, X_CLIENT_SECRET in .env.local',
      '  2. Run: ft bookmarks auth',
      '  3. Run: ft bookmarks sync --api',
      '  4. Run: ft job enable --id x-bookmarks --cron "0 7 * * *"',
    ],
  };
}

export async function getBookmarkStatusView(cwd = process.cwd()): Promise<BookmarkStatusView> {
  const token = await loadTwitterOAuthToken(cwd);
  const status = await getTwitterBookmarksStatus(cwd);
  return {
    connected: Boolean(token?.access_token),
    bookmarkCount: status.totalBookmarks,
    lastUpdated: status.lastIncrementalSyncAt ?? status.lastFullSyncAt ?? null,
    mode: token?.access_token ? 'Incremental by default (GraphQL + API available)' : 'Incremental by default (GraphQL)',
    cachePath: status.cachePath,
    datasetInitialized: await pathExists(datasetManifestPath('x-bookmarks', cwd)),
  };
}

export function formatBookmarkStatus(view: BookmarkStatusView): string {
  return [
    'Field Theory Bookmarks',
    `  bookmarks: ${view.bookmarkCount}`,
    `  last updated: ${view.lastUpdated ?? 'never'}`,
    `  sync mode: ${view.mode}`,
    `  dataset: ${view.datasetInitialized ? 'initialized' : 'not initialized'}`,
    `  cache: ${view.cachePath}`,
  ].join('\n');
}

export function formatBookmarkSummary(view: BookmarkStatusView): string {
  return `bookmarks=${view.bookmarkCount} updated=${view.lastUpdated ?? 'never'} mode="${view.mode}"`;
}
