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

export interface BookmarkMediaVariant {
  url?: string;
  contentType?: string;
  bitrate?: number;
}

export interface BookmarkMediaObject {
  mediaUrl?: string;
  previewUrl?: string;
  type?: string;
  extAltText?: string;
  width?: number;
  height?: number;
  variants?: BookmarkMediaVariant[];
}

export interface BookmarkAuthorSnapshot {
  handle?: string;
  name?: string;
  profileImageUrl?: string;
  description?: string;
  location?: string;
  url?: string;
  verified?: boolean;
  followersCount?: number;
  followingCount?: number;
  statusesCount?: number;
}

export interface BookmarkEngagementSnapshot {
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
  bookmarkCount?: number;
  viewCount?: number;
}

export interface BookmarkRecord {
  id: string;
  tweetId: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  author?: BookmarkAuthorSnapshot;
  url: string;
  text: string;
  postedAt?: string | null;
  bookmarkedAt?: string | null;
  syncedAt: string;
  conversationId?: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  quotedStatusId?: string;
  language?: string;
  sourceApp?: string;
  possiblySensitive?: boolean;
  engagement?: BookmarkEngagementSnapshot;
  media?: string[];
  mediaObjects?: BookmarkMediaObject[];
  links?: string[];
  tags?: string[];
  ingestedVia?: 'api' | 'browser' | 'graphql';
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

export interface BookmarkBackfillState {
  provider: 'twitter';
  lastRunAt?: string;
  totalRuns: number;
  totalAdded: number;
  lastAdded: number;
  lastSeenIds: string[];
  stopReason?: string;
}
