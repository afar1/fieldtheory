import { ImageResponse } from '@vercel/og';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://FIELD_THEORY_SUPABASE_URL.example';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  const { slug } = req.query;

  if (!slug) {
    return res.status(404).send('Not found');
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data } = await supabase
    .from('shared_readings')
    .select('title')
    .eq('slug', slug)
    .eq('is_public', true)
    .single();

  const title = data?.title || 'Untitled';

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
