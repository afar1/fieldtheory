import { createClient } from '@supabase/supabase-js';
import {
  bearerToken,
  issueMcpAccess,
  loadMcpAccessConfig,
  noStore,
} from '../lib/mcp-access.mjs';

function supabaseClient(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(req, res) {
  noStore(res);
  const config = loadMcpAccessConfig();
  if (!config) return res.status(503).json({ error: 'access_unavailable' });

  if (req.method === 'GET') {
    return res.status(200).json({
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey,
      mcpUrl: config.mcpUrl,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const result = await issueMcpAccess({
    accessToken: bearerToken(req),
    publicClient: supabaseClient(config.supabaseUrl, config.publishableKey),
    serviceClient: supabaseClient(config.supabaseUrl, config.serviceRoleKey),
  });
  return res.status(result.status).json(result.body);
}
