import { ImageResponse } from '@vercel/og';

export const runtime = 'edge';

export async function GET(request, { params }) {
  const slug = params.slug;

  // Decode the title from the slug (passed as URL-encoded title)
  const title = decodeURIComponent(slug).replace(/\.png$/, '');

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: '#0a0a0a',
          padding: '60px 80px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flex: 1,
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 600,
              color: '#ffffff',
              lineHeight: 1.2,
              maxWidth: '1000px',
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </div>
        </div>

        {/* Footer with Field Theory branding */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            {/* Simple geometric mark */}
            <div
              style={{
                width: '24px',
                height: '24px',
                backgroundColor: '#ffffff',
                borderRadius: '4px',
              }}
            />
            <div
              style={{
                fontSize: 24,
                color: '#666666',
                fontWeight: 500,
              }}
            >
              Field Theory
            </div>
          </div>
          <div
            style={{
              fontSize: 20,
              color: '#444444',
            }}
          >
            librarian.fieldtheory.dev
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
