export type DatasetKind = 'repo' | 'files' | 'mixed' | 'bookmarks';
export type InitiativeLevel = 'observe' | 'suggest' | 'prototype' | 'improve';
export type BudgetEffort = 'low' | 'medium' | 'high';

export interface DeliveryPolicy {
  onlyWhenWorthwhile?: boolean;
  channel?: 'email';
}

export interface BudgetPolicy {
  effort?: BudgetEffort;
}

export interface RepoSource {
  path: string;
}

export interface FilesSource {
  path: string;
  include?: string[];
}

export interface MixedSourceItem {
  kind: 'repo' | 'files';
  path: string;
}

export interface MixedSource {
  items: MixedSourceItem[];
}

export interface BookmarksSource {
  provider: 'twitter';
  path: string;
}

export type DatasetSource = RepoSource | FilesSource | MixedSource | BookmarksSource;

export interface DatasetManifest {
  id: string;
  kind: DatasetKind;
  source: DatasetSource;
  schedule?: { cron?: string };
  context?: string;
  initiative?: InitiativeLevel;
  budget?: BudgetPolicy;
  delivery?: DeliveryPolicy;
  gitNotes?: boolean;
}

export interface BookmarkRecord {
  id: string;
  tweetId: string;
  authorHandle?: string;
  authorName?: string;
  url: string;
  text: string;
  bookmarkedAt?: string;
  syncedAt: string;
  media?: string[];
  links?: string[];
  tags?: string[];
}

export interface BookmarkCacheMeta {
  provider: 'twitter';
  schemaVersion: number;
  lastFullSyncAt?: string;
  lastIncrementalSyncAt?: string;
  totalBookmarks: number;
}

export interface XOAuthTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  obtained_at: string;
}
