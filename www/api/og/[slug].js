import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const slug = url.pathname.split('/').pop();

  if (!slug) {
    return new Response('Not found', { status: 404 });
  }

  // Fetch title from Supabase using fetch (Edge-compatible)
  const supabaseUrl = 'https://FIELD_THEORY_SUPABASE_URL.example';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(
    `${supabaseUrl}/rest/v1/shared_readings?slug=eq.${slug}&is_public=eq.true&select=title`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    }
  );

  const data = await response.json();
  const title = data?.[0]?.title || 'Untitled';

  return new ImageResponse(
    (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1a1a',
        padding: '60px 80px',
      }}>
        <div style={{
          fontSize: 56,
          fontWeight: 600,
          color: '#ffffff',
          lineHeight: 1.2,
          maxWidth: '900px',
        }}>
          {title}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          marginTop: 'auto',
          gap: '12px',
        }}>
          <div style={{
            fontSize: 24,
            color: '#888888',
          }}>
            Field Theory
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
