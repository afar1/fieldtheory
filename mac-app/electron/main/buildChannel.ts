export type FieldTheoryBuildChannel = 'production' | 'experimental';

export const FIELD_THEORY_PRODUCTION_RELEASE_REPO = 'field-releases';
export const FIELD_THEORY_EXPERIMENTAL_RELEASE_REPO = 'field-releases-experimental';

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
