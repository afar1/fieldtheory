export type FieldTheoryBuildChannel = 'production' | 'experimental';

export const FIELD_THEORY_PRODUCTION_RELEASE_REPO = 'field-releases';
export const FIELD_THEORY_EXPERIMENTAL_RELEASE_REPO = 'oscar';
export const FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN_ENV = 'FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN';

export type FieldTheoryUpdaterFeedOptions = {
  provider: 'github';
  owner: 'afar1';
  repo: string;
  private?: boolean;
  token?: string;
};

export function resolveFieldTheoryBuildChannel(options: {
  env?: NodeJS.ProcessEnv;
  appName?: string;
  metadataChannel?: string;
} = {}): FieldTheoryBuildChannel {
  const env = options.env ?? process.env;
  const channel = env.FIELD_THEORY_BUILD_CHANNEL?.toLowerCase();
  const metadataChannel = options.metadataChannel?.toLowerCase();

  if (channel === 'experimental' || channel === 'production') {
    return channel;
  }

  if (metadataChannel === 'experimental' || metadataChannel === 'production') {
    return metadataChannel;
  }

  if (env.EXPERIMENTAL === 'true') {
    return 'experimental';
  }

  if (options.appName === 'Field Theory Experimental') {
    return 'experimental';
  }

  return 'production';
}

export function releaseRepoForBuildChannel(channel: FieldTheoryBuildChannel): string {
  return channel === 'experimental'
    ? FIELD_THEORY_EXPERIMENTAL_RELEASE_REPO
    : FIELD_THEORY_PRODUCTION_RELEASE_REPO;
}

export function isAutoUpdaterEnabledForBuildChannel(channel: FieldTheoryBuildChannel): boolean {
  return channel === 'production' || channel === 'experimental';
}

export function autoUpdaterReleaseRepoForBuildChannel(channel: FieldTheoryBuildChannel): string | null {
  return isAutoUpdaterEnabledForBuildChannel(channel)
    ? releaseRepoForBuildChannel(channel)
    : null;
}

export function autoUpdaterAllowsPrereleaseForBuildChannel(channel: FieldTheoryBuildChannel): boolean {
  return channel === 'experimental';
}

export function autoUpdaterAuthTokenForBuildChannel(
  channel: FieldTheoryBuildChannel,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (channel !== 'experimental') return null;
  const token = env[FIELD_THEORY_EXPERIMENTAL_UPDATE_TOKEN_ENV]?.trim();
  if (!token) return null;
  return normalizeGitHubToken(token);
}

export function autoUpdaterGitHubCliPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = [
    env.FIELD_THEORY_GITHUB_CLI_PATH,
    'gh',
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
  ];

  return candidates.filter((candidate, index): candidate is string => (
    Boolean(candidate) && candidates.indexOf(candidate) === index
  ));
}

export function normalizeGitHubToken(token: string): string {
  const trimmed = token.trim();
  return trimmed.replace(/^(token|bearer)\s+/i, '').trim();
}

export function autoUpdaterFeedOptionsForBuildChannel(
  channel: FieldTheoryBuildChannel,
  token: string | null = null,
): FieldTheoryUpdaterFeedOptions | null {
  const repo = autoUpdaterReleaseRepoForBuildChannel(channel);
  if (!repo) return null;

  const feed: FieldTheoryUpdaterFeedOptions = {
    provider: 'github',
    owner: 'afar1',
    repo,
  };

  if (channel === 'experimental' && token) {
    feed.private = true;
    feed.token = token;
  }

  return feed;
}
