import { ImageResponse } from '@vercel/og';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

const supabaseUrl = 'https://cighxaroptskntwbrctl.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export async function GET(request, { params }) {
  const slug = params.slug;

  if (!slug) {
    return new Response('Not found', { status: 404 });
  }

  let title = 'Untitled';
  let reading = null;

  // Only fetch from Supabase if we have the key
  if (supabaseAnonKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { data, error } = await supabase
        .from('shared_readings')
        .select('title, content')
        .eq('slug', slug)
        .eq('is_public', true)
        .single();

      if (!error && data) {
        reading = data;
        title = data.title || 'Untitled';
      }
    } catch (e) {
      // Supabase fetch failed, continue with defaults
    }
  }

  // Strip markdown and get plain text preview
  let contentPreview = '';
  if (reading && reading.content) {
    // Remove markdown syntax
    let text = reading.content
      .replace(/^#{1,6}\s+.*$/gm, '') // Remove headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
      .replace(/\*([^*]+)\*/g, '$1') // Italic
      .replace(/`[^`]+`/g, '') // Inline code
      .replace(/```[\s\S]*?```/g, '') // Code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
      .replace(/^[-*+]\s+/gm, '') // List items
      .replace(/^\d+\.\s+/gm, '') // Numbered lists
      .replace(/^>\s+/gm, '') // Blockquotes
      .replace(/\n{2,}/g, ' ') // Multiple newlines to space
      .replace(/\n/g, ' ') // Single newlines to space
      .trim();

    // Get first ~200 chars, ending at word boundary
    if (text.length > 200) {
      text = text.substring(0, 200);
      const lastSpace = text.lastIndexOf(' ');
      if (lastSpace > 150) {
        text = text.substring(0, lastSpace);
      }
      text += '...';
    }
    contentPreview = text;
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: '#1a1a1a',
          padding: '48px 64px',
          fontFamily: 'Georgia, serif',
          position: 'relative',
        }}
      >
        {/* Subtle border */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            left: '24px',
            right: '24px',
            bottom: '24px',
            border: '1px solid #333',
            borderRadius: '8px',
          }}
        />

        {/* Top: Logo left, "Field Theory" right */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            marginBottom: '32px',
          }}
        >
          {/* Logo icon */}
          <img
            src="https://fieldtheory.dev/images/fieldtheory-icon-white.png"
            width={32}
            height={32}
            style={{ opacity: 0.6 }}
          />
          {/* Brand name */}
          <div
            style={{
              fontSize: 18,
              color: '#666',
              fontFamily: 'system-ui, sans-serif',
              fontWeight: 500,
            }}
          >
            Field Theory
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            padding: '0 24px',
          }}
        >
          <div
            style={{
              fontSize: 56,
              fontWeight: 600,
              color: '#e8e8e8',
              lineHeight: 1.2,
              maxWidth: '1000px',
              letterSpacing: '-0.02em',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {title}
          </div>
        </div>

        {/* Content preview */}
        {contentPreview && (
          <div
            style={{
              display: 'flex',
              flex: 1,
              padding: '24px 24px 0',
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                fontSize: 24,
                color: '#888',
                lineHeight: 1.5,
                fontFamily: 'Georgia, serif',
                maxWidth: '1000px',
              }}
            >
              {contentPreview}
            </div>
          </div>
        )}

        {/* Bottom spacer to avoid Twitter's overlay area */}
        <div style={{ height: '80px' }} />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    }
  );
}
