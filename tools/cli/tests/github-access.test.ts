import test from 'node:test';
import assert from 'node:assert/strict';
import { withGitHubAccessHint } from '../src/github-access.js';

test('withGitHubAccessHint explains when GH_TOKEN overrides stored gh auth', () => {
  const message = withGitHubAccessHint(
    "GraphQL: Could not resolve to a Repository with the name 'DensityCo/routines'. (repository)",
    { GH_TOKEN: 'set' } as NodeJS.ProcessEnv,
  );

  assert.match(message, /GH_TOKEN/);
  assert.match(message, /will prefer it over stored login/i);
});

test('withGitHubAccessHint keeps the generic guidance when no env token is set', () => {
  const message = withGitHubAccessHint(
    "GraphQL: Could not resolve to a Repository with the name 'DensityCo/routines'. (repository)",
    {} as NodeJS.ProcessEnv,
  );

  assert.match(message, /Re-authenticate `gh`/);
  assert.doesNotMatch(message, /will prefer it over stored login/i);
});
