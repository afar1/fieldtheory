// Edge Middleware for password protection.
// Uses HTTP Basic Auth - browser will show a native login dialog.
// Password: "brute force" (username can be anything)

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
};

export default function middleware(request) {
  const auth = request.headers.get('authorization');

  if (auth) {
    try {
      const [scheme, encoded] = auth.split(' ');
      if (scheme === 'Basic' && encoded) {
        const decoded = atob(encoded);
        const [, password] = decoded.split(':');

        if (password === 'brute force') {
          return; // Pass through to static files
        }
      }
    } catch {
      // Invalid auth header, fall through to 401
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Field Theory"',
      'Content-Type': 'text/plain',
    },
  });
}
