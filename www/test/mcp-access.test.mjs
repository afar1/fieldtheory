import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bearerToken,
  issueMcpAccess,
  loadMcpAccessConfig,
  randomMcpToken,
  tokenHash,
} from '../lib/mcp-access.mjs';

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'publishable',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  COMMONS_MCP_URL: 'https://project.supabase.co/functions/v1/commons-mcp/mcp',
};

test('configuration requires both public and private Supabase credentials', () => {
  assert.equal(loadMcpAccessConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }), null);
  assert.equal(loadMcpAccessConfig({ ...env, COMMONS_MCP_URL: `${env.COMMONS_MCP_URL}?token=secret` }), null);
  assert.deepEqual(loadMcpAccessConfig(env), {
    supabaseUrl: env.SUPABASE_URL,
    mcpUrl: env.COMMONS_MCP_URL,
    publishableKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
});

test('tokens are random bearer values and only their SHA-256 hash is provisioned', async () => {
  const token = randomMcpToken(() => Buffer.alloc(32, 7));
  assert.match(token, /^ftm_[A-Za-z0-9_-]{43}$/);
  assert.match(tokenHash(token), /^[0-9a-f]{64}$/);

  let provisioned;
  const result = await issueMcpAccess({
    accessToken: 'supabase-user-token',
    publicClient: {
      auth: { async getUser() { return { data: { user: { id: 'user-1', email: 'colleague@example.com' } }, error: null }; } },
    },
    serviceClient: {
      rpc(name, params) {
        provisioned = { name, params };
        return { async maybeSingle() { return { data: { access_account_id: 'account-1' }, error: null }; } };
      },
    },
    generateToken: () => token,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.token, token);
  assert.deepEqual(result.body.user, { id: 'user-1', email: 'colleague@example.com' });
  assert.equal(provisioned.name, 'commons_mcp_provision_access_account');
  assert.equal(provisioned.params.p_auth_user_id, 'user-1');
  assert.equal(provisioned.params.p_label, 'colleague@example.com');
  assert.equal(provisioned.params.p_token_hash, tokenHash(token));
  assert.notEqual(provisioned.params.p_token_hash, token);
});

test('invalid Supabase sessions cannot provision an MCP token', async () => {
  let called = false;
  const result = await issueMcpAccess({
    accessToken: 'expired',
    publicClient: { auth: { async getUser() { return { data: { user: null }, error: new Error('expired') }; } } },
    serviceClient: { rpc() { called = true; } },
  });
  assert.deepEqual(result, { status: 401, body: { error: 'invalid_user_session' } });
  assert.equal(called, false);
});

test('bearer parser accepts one exact bearer value', () => {
  assert.equal(bearerToken({ headers: { authorization: 'Bearer user-token' } }), 'user-token');
  assert.equal(bearerToken({ headers: { authorization: 'Basic user-token' } }), null);
  assert.equal(bearerToken({ headers: { authorization: 'Bearer two tokens' } }), null);
});
