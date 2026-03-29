import { ensureDir, pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from './fs.js';
import { sourcesDir, twitterBookmarksCachePath, twitterBookmarksMetaPath } from './paths.js';
import type { BookmarkCacheMeta, BookmarkRecord } from './types.js';
import { loadXApiConfig } from './config.js';
import { loadTwitterOAuthToken } from './xauth.js';

export interface BookmarkSyncResult {
  mode: 'full' | 'incremental';
  totalBookmarks: number;
  added: number;
  cachePath: string;
  metaPath: string;
}

export interface BookmarkProbeResult {
  ok: boolean;
  mode: 'api-bearer-probe' | 'oauth-user-probe';
  endpoint: string;
  status?: number;
  detail: string;
  sampleCount?: number;
}

export interface BookmarkPaginationDebugResult {
  ok: boolean;
  userId?: string;
  pages: Array<{
    page: number;
    resultCount: number;
    hasNextToken: boolean;
    nextTokenPreview?: string;
  }>;
  detail: string;
}

type BookmarkApiTweet = {
  id: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  entities?: {
    urls?: Array<{ expanded_url?: string; url?: string }>;
  };
};

type BookmarkApiResponse = {
  data?: BookmarkApiTweet[];
  includes?: {
    users?: Array<{ id: string; username?: string; name?: string }>;
  };
  meta?: {
    next_token?: string;
    result_count?: number;
  };
};

function makeBookmark(record: Partial<BookmarkRecord> & Pick<BookmarkRecord, 'id' | 'tweetId' | 'url' | 'text'>): BookmarkRecord {
  return {
    id: record.id,
    tweetId: record.tweetId,
    url: record.url,
    text: record.text,
    authorHandle: record.authorHandle,
    authorName: record.authorName,
    bookmarkedAt: record.bookmarkedAt,
    syncedAt: record.syncedAt ?? new Date().toISOString(),
    media: record.media ?? [],
    links: record.links ?? [],
    tags: record.tags ?? [],
  };
}

export async function probeTwitterBookmarksApi(cwd = process.cwd()): Promise<BookmarkProbeResult> {
  const config = loadXApiConfig(cwd);
  if (!config.bearerToken) {
    return {
      ok: false,
      mode: 'api-bearer-probe',
      endpoint: 'GET /2/users/me/bookmarks',
      detail: 'Missing X_BEARER_TOKEN; cannot run API bearer probe.',
    };
  }

  const endpoint = 'https://api.x.com/2/users/me/bookmarks?max_results=5&tweet.fields=created_at,author_id';
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${config.bearerToken}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      mode: 'api-bearer-probe',
      endpoint: 'GET /2/users/me/bookmarks',
      status: response.status,
      detail: parsed ? JSON.stringify(parsed) : text,
    };
  }

  return {
    ok: true,
    mode: 'api-bearer-probe',
    endpoint: 'GET /2/users/me/bookmarks',
    status: response.status,
    detail: 'Bookmark endpoint responded successfully.',
    sampleCount: Array.isArray(parsed?.data) ? parsed.data.length : 0,
  };
}

async function fetchJsonWithUserToken(url: string, accessToken: string): Promise<{ ok: boolean; status: number; parsed: any; text: string }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    parsed,
    text,
  };
}

async function fetchCurrentUserId(accessToken: string): Promise<{ ok: boolean; id?: string; status: number; detail: string }> {
  const result = await fetchJsonWithUserToken('https://api.x.com/2/users/me', accessToken);
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      detail: result.parsed ? JSON.stringify(result.parsed) : result.text,
    };
  }

  const id = result.parsed?.data?.id;
  if (!id) {
    return {
      ok: false,
      status: result.status,
      detail: 'Could not find user id in /2/users/me response',
    };
  }

  return {
    ok: true,
    id: String(id),
    status: result.status,
    detail: 'Resolved current user id',
  };
}

function normalizeBookmarkPage(page: BookmarkApiResponse, syncedAt: string): BookmarkRecord[] {
  const userMap = new Map<string, { username?: string; name?: string }>();
  for (const user of page.includes?.users ?? []) {
    userMap.set(String(user.id), { username: user.username, name: user.name });
  }

  return (page.data ?? []).map((tweet) => {
    const user = tweet.author_id ? userMap.get(String(tweet.author_id)) : undefined;
    const tweetId = String(tweet.id);
    return makeBookmark({
      id: tweetId,
      tweetId,
      url: `https://x.com/${user?.username ?? 'i'}/status/${tweetId}`,
      text: tweet.text ?? '',
      authorHandle: user?.username,
      authorName: user?.name,
      bookmarkedAt: tweet.created_at,
      syncedAt,
      links: (tweet.entities?.urls ?? []).map((u) => u.expanded_url ?? u.url ?? '').filter(Boolean),
    });
  });
}

async function fetchBookmarksPage(accessToken: string, userId: string, nextToken?: string): Promise<{ ok: boolean; status: number; detail: string; page?: BookmarkApiResponse; requestUrl: string }> {
  const url = new URL(`https://api.x.com/2/users/${userId}/bookmarks`);
  url.searchParams.set('max_results', '100');
  url.searchParams.set('tweet.fields', 'created_at,author_id,entities');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username,name');
  if (nextToken) url.searchParams.set('pagination_token', nextToken);

  const result = await fetchJsonWithUserToken(url.toString(), accessToken);
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      detail: result.parsed ? JSON.stringify(result.parsed) : result.text,
      requestUrl: url.toString(),
    };
  }

  return {
    ok: true,
    status: result.status,
    detail: 'ok',
    page: result.parsed as BookmarkApiResponse,
    requestUrl: url.toString(),
  };
}

export async function debugTwitterBookmarkPagination(cwd = process.cwd(), maxPages = 5): Promise<BookmarkPaginationDebugResult> {
  const token = await loadTwitterOAuthToken(cwd);
  if (!token?.access_token) {
    return {
      ok: false,
      pages: [],
      detail: 'Missing user-context OAuth token. Run: ft bookmarks auth',
    };
  }

  const me = await fetchCurrentUserId(token.access_token);
  if (!me.ok || !me.id) {
    return {
      ok: false,
      pages: [],
      detail: me.detail,
    };
  }

  const pages: BookmarkPaginationDebugResult['pages'] = [];
  let nextToken: string | undefined;

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const result = await fetchBookmarksPage(token.access_token, me.id, nextToken);
    if (!result.ok || !result.page) {
      return {
        ok: false,
        userId: me.id,
        pages,
        detail: `Failed on page ${pageNum}: ${result.detail}`,
      };
    }

    const tokenValue = result.page.meta?.next_token;
    pages.push({
      page: pageNum,
      resultCount: result.page.meta?.result_count ?? (result.page.data?.length ?? 0),
      hasNextToken: Boolean(tokenValue),
      nextTokenPreview: tokenValue ? `${String(tokenValue).slice(0, 12)}...` : undefined,
    });

    if (!tokenValue) {
      return {
        ok: true,
        userId: me.id,
        pages,
        detail: 'No next_token returned; pagination appears to end here.',
      };
    }

    nextToken = tokenValue;
  }

  return {
    ok: true,
    userId: me.id,
    pages,
    detail: `Collected ${pages.length} pages and still have more pagination token(s).`,
  };
}

export async function probeTwitterBookmarksOAuth(cwd = process.cwd()): Promise<BookmarkProbeResult> {
  const token = await loadTwitterOAuthToken(cwd);
  if (!token?.access_token) {
    return {
      ok: false,
      mode: 'oauth-user-probe',
      endpoint: 'GET /2/users/:id/bookmarks',
      detail: 'Missing user-context OAuth token. Run: ft bookmarks auth',
    };
  }

  const me = await fetchCurrentUserId(token.access_token);
  if (!me.ok || !me.id) {
    return {
      ok: false,
      mode: 'oauth-user-probe',
      endpoint: 'GET /2/users/me',
      status: me.status,
      detail: me.detail,
    };
  }

  const result = await fetchBookmarksPage(token.access_token, me.id);
  if (!result.ok || !result.page) {
    return {
      ok: false,
      mode: 'oauth-user-probe',
      endpoint: `GET /2/users/${me.id}/bookmarks`,
      status: result.status,
      detail: result.detail,
    };
  }

  return {
    ok: true,
    mode: 'oauth-user-probe',
    endpoint: `GET /2/users/${me.id}/bookmarks`,
    status: result.status,
    detail: 'Bookmark endpoint responded successfully with user-context token.',
    sampleCount: Array.isArray(result.page.data) ? result.page.data.length : 0,
  };
}

export async function syncTwitterBookmarks(
  mode: 'full' | 'incremental',
  cwd = process.cwd(),
  options: { targetAdds?: number } = {}
): Promise<BookmarkSyncResult> {
  const token = await loadTwitterOAuthToken(cwd);
  if (!token?.access_token) {
    throw new Error('Missing user-context OAuth token. Run: ft bookmarks auth');
  }

  const me = await fetchCurrentUserId(token.access_token);
  if (!me.ok || !me.id) {
    throw new Error(`Could not resolve current user id: ${me.detail}`);
  }

  await ensureDir(sourcesDir(cwd));
  const cachePath = twitterBookmarksCachePath(cwd);
  const metaPath = twitterBookmarksMetaPath(cwd);
  const now = new Date().toISOString();
  const existing = await readJsonLines<BookmarkRecord>(cachePath);
  const existingById = new Map(existing.map((item) => [item.id, item]));

  const allFetched: BookmarkRecord[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  const maxPages = mode === 'full' ? 20 : 2;

  while (pages < maxPages) {
    const pageResult = await fetchBookmarksPage(token.access_token, me.id, nextToken);
    if (!pageResult.ok || !pageResult.page) {
      throw new Error(`Bookmark fetch failed (${pageResult.status}): ${pageResult.detail}`);
    }

    const normalized = normalizeBookmarkPage(pageResult.page, now);
    allFetched.push(...normalized);
    nextToken = pageResult.page.meta?.next_token;
    pages += 1;

    if (!nextToken) break;
    if (mode === 'incremental' && normalized.every((item) => existingById.has(item.id))) break;
    if (typeof options.targetAdds === 'number') {
      const uniqueAddsSoFar = allFetched.filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index).filter((item) => !existingById.has(item.id)).length;
      if (uniqueAddsSoFar >= options.targetAdds) break;
    }
  }

  const merged = [...existing];
  let added = 0;
  for (const record of allFetched) {
    if (!existingById.has(record.id)) {
      merged.push(record);
      existingById.set(record.id, record);
      added += 1;
      if (typeof options.targetAdds === 'number' && added >= options.targetAdds) break;
    }
  }

  merged.sort((a, b) => String(b.bookmarkedAt ?? b.syncedAt).localeCompare(String(a.bookmarkedAt ?? a.syncedAt)));
  await writeJsonLines(cachePath, merged);

  const previousMeta = (await pathExists(metaPath)) ? await readJson<BookmarkCacheMeta>(metaPath) : undefined;
  const meta: BookmarkCacheMeta = {
    provider: 'twitter',
    schemaVersion: 1,
    lastFullSyncAt: mode === 'full' ? now : previousMeta?.lastFullSyncAt,
    lastIncrementalSyncAt: mode === 'incremental' ? now : previousMeta?.lastIncrementalSyncAt,
    totalBookmarks: merged.length,
  };
  await writeJson(metaPath, meta);

  return {
    mode,
    totalBookmarks: merged.length,
    added,
    cachePath,
    metaPath,
  };
}

export async function getTwitterBookmarksStatus(cwd = process.cwd()): Promise<BookmarkCacheMeta & { cachePath: string; metaPath: string }> {
  const cachePath = twitterBookmarksCachePath(cwd);
  const metaPath = twitterBookmarksMetaPath(cwd);
  const meta: BookmarkCacheMeta = (await pathExists(metaPath))
    ? await readJson<BookmarkCacheMeta>(metaPath)
    : { provider: 'twitter', schemaVersion: 1, totalBookmarks: 0 };

  return {
    ...meta,
    cachePath,
    metaPath,
  };
}
