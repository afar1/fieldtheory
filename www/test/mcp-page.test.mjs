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
  assert.match(page, /remote MCP cannot access your computer or local files/);
  assert.match(page, /full bookmark collection stays in the cloud/);
  assert.match(page, /Codex receives only the records returned by MCP search and get calls/);
  assert.match(page, /human-curated bookmarks/);
  assert.match(page, /There is no account to set up/);
  assert.match(page, /turn it off without affecting anyone else/);
  assert.match(page, /\/api\/mcp-access/);
  assert.match(page, /codex mcp add fieldtheory-commons/);
  assert.match(page, /bearer-token-env-var FIELD_THEORY_COMMONS_TOKEN/);
  assert.match(page, /starts Codex in the same Terminal window/);
});

test('confirmed access shows a focused copyable prompt for the remote MCP', () => {
  assert.match(page, /id="codex-prompt"/);
  assert.match(page, /id="copy-prompt"/);
  assert.match(page, /Use only the remote `fieldtheory-commons` MCP/);
  assert.match(page, /Do not inspect local files/);
  assert.match(page, /use the shell or web/);
  assert.match(page, /Field Theory Mac app/);
  assert.match(page, /use Computer Use/);
  assert.match(page, /start subagents/);
  assert.match(page, /Run one compact search/);
  assert.match(page, /at most 1–2 results/);
  assert.match(page, /Do not mention the size of the bookmark collection unless I ask/);
  assert.match(page, /cite the original X URLs/);
  assert.match(page, /evaluating coding-agent reliability/);
  assert.match(page, /parallel coding agents help/);
  assert.match(page, /recover after losing context/);
  assert.match(page, /copyText\(event\.currentTarget, codexPrompt\.textContent\)/);
  assert.match(page, /navigator\.clipboard\?\.writeText/);
  assert.match(page, /button\.textContent = 'select text'/);
  assert.match(page, /Copy failed\. Select the text manually\./);
  assert.match(page, /button\.setAttribute\('aria-label', button\.title\)/);
});

test('page contains no founder credential or sitewide MCP navigation link', () => {
  assert.doesNotMatch(page, /fieldtheory-commons-mcp-access-token/);
  assert.doesNotMatch(page, /COMMONS_MCP_ACCESS_TOKEN/);
  assert.doesNotMatch(page, /Andrew/i);
  assert.doesNotMatch(page, /<nav[\s>]/i);
  assert.doesNotMatch(page, /<footer[\s>]/i);
});
