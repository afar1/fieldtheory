export function isLikelyGitHubAccessError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('could not resolve to a repository')
    || lowered.includes('not found')
    || lowered.includes('authentication')
    || lowered.includes('forbidden')
  );
}

export function withGitHubAccessHint(
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isLikelyGitHubAccessError(message)) {
    return message;
  }

  const envTokenName = env.GH_TOKEN
    ? 'GH_TOKEN'
    : env.GITHUB_TOKEN
      ? 'GITHUB_TOKEN'
      : null;

  if (envTokenName) {
    return `${message}\nGitHub access failed. \`${envTokenName}\` is set in the environment, and \`gh\` will prefer it over stored login. Update/remove that token or replace it with one that can see the target repo.`;
  }

  return `${message}\nGitHub access failed. Re-authenticate \`gh\` or provide a \`GH_TOKEN\`/\`GITHUB_TOKEN\` that can see the target repo.`;
}
