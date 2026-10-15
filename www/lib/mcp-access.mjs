import crypto from 'node:crypto';

const DEFAULT_SUPABASE_URL = 'https://cighxaroptskntwbrctl.supabase.co';
const DEFAULT_MCP_URL = `${DEFAULT_SUPABASE_URL}/functions/v1/commons-mcp/mcp`;

function safeHttpsUrl(value, fallback) {
  try {
    const url = new URL(value || fallback);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function loadMcpAccessConfig(env = process.env) {
  const supabaseUrl = safeHttpsUrl(env.SUPABASE_URL, DEFAULT_SUPABASE_URL)?.replace(/\/$/, '');
  const mcpUrl = safeHttpsUrl(env.COMMONS_MCP_URL, DEFAULT_MCP_URL);
  const publishableKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !mcpUrl || !publishableKey || !serviceRoleKey) return null;
  return { supabaseUrl, mcpUrl, publishableKey, serviceRoleKey };
}

export function randomMcpToken(randomBytes = crypto.randomBytes) {
  return `ftm_${randomBytes(32).toString('base64url')}`;
}

export function tokenHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function bearerToken(req) {
  const header = req.headers?.authorization;
  const match = typeof header === 'string' ? header.match(/^Bearer ([^\s]+)$/) : null;
  return match?.[1] || null;
}

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export async function issueMcpAccess({ accessToken, publicClient, serviceClient, generateToken = randomMcpToken }) {
  if (!accessToken) return { status: 401, body: { error: 'invalid_user_session' } };

  const { data: { user } = {}, error: userError } = await publicClient.auth.getUser(accessToken);
  if (userError || !user?.id || !user.email) {
    return { status: 401, body: { error: 'invalid_user_session' } };
  }

  const token = generateToken();
  const { data, error } = await serviceClient
    .rpc('commons_mcp_provision_access_account', {
      p_auth_user_id: user.id,
      p_label: user.email,
      p_token_hash: tokenHash(token),
      p_credits_remaining: 25,
    })
    .maybeSingle();

  if (error || !data?.access_account_id) {
    return { status: 503, body: { error: 'access_unavailable' } };
  }

  return {
    status: 200,
    body: {
      token,
      user: { id: user.id, email: user.email },
    },
  };
}
