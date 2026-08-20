import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'mcp', 'index.html'), 'utf8');

test('unlisted page explains remote access and configures the hosted MCP', () => {
  assert.match(page, /noindex, nofollow/);
  assert.match(page, /frame-ancestors 'none'/);
  assert.match(page, /Nothing to install or sync/);
  assert.match(page, /Remote and read-only/);
  assert.match(page, /human-curated bookmarks/);
  assert.match(page, /There is no account to set up/);
  assert.match(page, /turn it off without affecting anyone else/);
  assert.match(page, /\/api\/mcp-access/);
  assert.match(page, /codex mcp add fieldtheory-commons/);
  assert.match(page, /bearer-token-env-var FIELD_THEORY_COMMONS_TOKEN/);
});

test('page contains no founder credential or sitewide MCP navigation link', () => {
  assert.doesNotMatch(page, /fieldtheory-commons-mcp-access-token/);
  assert.doesNotMatch(page, /COMMONS_MCP_ACCESS_TOKEN/);
  assert.doesNotMatch(page, /Andrew/i);
  assert.doesNotMatch(page, /<nav[\s>]/i);
  assert.doesNotMatch(page, /<footer[\s>]/i);
});
