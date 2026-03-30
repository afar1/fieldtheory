import { createClient } from '@supabase/supabase-js';
import { marked } from 'marked';

const supabaseUrl = process.env.SUPABASE_URL || 'https://cighxaroptskntwbrctl.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  const { slug } = req.query;

  if (!slug) {
    return res.status(404).send(errorPage('Reading not found'));
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: reading, error } = await supabase
    .from('shared_readings')
    .select('title, content, author_name, user_id')
    .eq('slug', slug)
    .eq('is_public', true)
    .single();

  if (error || !reading) {
    return res.status(404).send(errorPage("This reading doesn't exist or has been unshared."));
  }

  // Fetch callsign from profiles (separate query since no direct FK)
  let callsignData = null;
  if (reading.user_id) {
    const { data } = await supabase
      .from('profiles')
      .select('callsign')
      .eq('id', reading.user_id)
      .single();
    callsignData = data;
  }

  // Check total count for random button
  const { count } = await supabase
    .from('shared_readings')
    .select('*', { count: 'exact', head: true })
    .eq('is_public', true);

  const showRandom = count > 10;
  // Escape raw HTML in markdown to prevent stored XSS on public pages.
  // marked v15 renders raw HTML by default — override the html renderer to escape it.
  const renderer = { html: ({ text }) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  const html = await marked(reading.content, { renderer });
  const shareUrl = `https://librarian.fieldtheory.dev/${slug}`;

  // Format author as "First L."
  let authorFormatted = '';
  if (reading.author_name) {
    const parts = reading.author_name.trim().split(/\s+/);
    if (parts.length >= 2) {
      authorFormatted = `${parts[0]} ${parts[parts.length - 1][0]}.`;
    } else {
      authorFormatted = parts[0];
    }
  }

  // Get callsign from profiles query
  const callsign = callsignData?.callsign;

  // Build attribution: callsign with hover to reveal real name
  let author = '';
  if (callsign || authorFormatted) {
    if (callsign && authorFormatted) {
      // Both: show callsign, hover reveals name
      author = `<p class="attribution">Inspired by the work of <span class="author-toggle"><span class="callsign">${esc(callsign)}</span><span class="realname">${esc(authorFormatted)}</span></span></p>`;
    } else if (callsign) {
      // Only callsign
      author = `<p class="attribution">Inspired by the work of <span class="callsign-only">${esc(callsign)}</span></p>`;
    } else {
      // Only name (legacy)
      author = `<p class="attribution">Inspired by the work of ${esc(authorFormatted)}</p>`;
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(reading.title)} – Field Theory</title>
  <meta name="description" content="An artifact from the Field Theory Librarian">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(reading.title)}">
  <meta property="og:description" content="An artifact from the Field Theory Librarian">
  <meta property="og:image" content="https://fieldtheory-og.vercel.app/api/${slug}">
  <meta property="og:url" content="${shareUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(reading.title)}">
  <meta name="twitter:description" content="An artifact from the Field Theory Librarian">
  <meta name="twitter:image" content="https://fieldtheory-og.vercel.app/api/${slug}">
  <link rel="icon" href="https://fieldtheory.dev/images/fieldtheory-icon-black.png">
  <style>
    :root {
      --bg: #faf9f7;
      --text: #1a1a1a;
      --text-secondary: #6b6b6b;
      --border: #e5e5e5;
      --accent: #4a7c23;
      --code-bg: rgba(0,0,0,0.04);
    }
    .dark {
      --bg: #1a1a1a;
      --text: #e8e8e8;
      --text-secondary: #999;
      --border: #333;
      --accent: #7cb342;
      --code-bg: rgba(255,255,255,0.08);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 18px; -webkit-font-smoothing: antialiased; }
    body {
      font-family: Charter, 'Bitstream Charter', Georgia, serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.65;
      min-height: 100vh;
      transition: background 0.2s, color 0.2s;
    }
    .page { max-width: 600px; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
    .header {
      display: flex;
      justify-content: center;
      padding-top: 0.5rem;
      padding-bottom: 2.5rem;
      margin-bottom: 2.25rem;
      border-bottom: 1px solid var(--border);
    }
    .controls {
      display: flex;
      gap: 6px;
      margin-top: 1rem;
    }
    .icon-btn {
      background: none;
      border: 1px solid var(--border);
      padding: 6px;
      cursor: pointer;
      color: var(--text-secondary);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover { color: var(--text); border-color: var(--text); }
    .icon-btn svg { width: 16px; height: 16px; }
    .icon-btn.copied { color: var(--accent); border-color: var(--accent); }
    .random-btn { margin-left: auto; }
    .content h1 {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 1.875rem;
      font-weight: 600;
      line-height: 1.25;
      margin-bottom: 2rem;
      letter-spacing: -0.02em;
    }
    .content h2 {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 1.25rem;
      font-weight: 600;
      margin-top: 2.5rem;
      margin-bottom: 1rem;
    }
    .content p { margin-bottom: 1.25rem; }
    .content a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
    .content a:hover { text-decoration: none; }
    .content code {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 0.875em;
      background: var(--code-bg);
      padding: 0.2em 0.4em;
      border-radius: 4px;
    }
    .content pre {
      background: var(--code-bg);
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      margin-bottom: 1.25rem;
    }
    .content pre code { background: none; padding: 0; }
    .content blockquote {
      border-left: 3px solid var(--border);
      padding-left: 1.25rem;
      color: var(--text-secondary);
      font-style: italic;
      margin-bottom: 1.25rem;
    }
    .content ul, .content ol { margin-bottom: 1.25rem; padding-left: 1.5rem; }
    .content li { margin-bottom: 0.5rem; }
    .footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 0.9rem;
      color: var(--text-secondary);
    }
    .attribution { font-style: italic; font-size: 0.8em; margin: 0.25rem 0 0 0; }
    .author-toggle { position: relative; cursor: default; }
    .author-toggle .callsign {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', monospace;
      letter-spacing: 0.5px;
      transition: opacity 0.2s ease;
    }
    .author-toggle .realname {
      position: absolute;
      left: 0;
      opacity: 0;
      transition: opacity 0.2s ease;
      white-space: nowrap;
    }
    .author-toggle:hover .callsign { opacity: 0; }
    .author-toggle:hover .realname { opacity: 1; }
    .callsign-only {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', monospace;
      letter-spacing: 0.5px;
    }
    .made-by { margin-bottom: 0; }
    .footer a { color: var(--text); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .logo-link { display: flex; }
    .logo { width: 36px; height: 36px; opacity: 0.6; transition: opacity 0.2s; }
    .logo:hover { opacity: 1; }
    .dark-logo { display: none; }
    .dark .light-logo { display: none; }
    .dark .dark-logo { display: inline; }
  </style>
</head>
<body>
  <div class="page">
    <header class="header">
      <a href="https://fieldtheory.dev" class="logo-link" title="Field Theory">
        <img src="https://fieldtheory.dev/images/fieldtheory-icon-black.png" alt="Field Theory" class="logo light-logo">
        <img src="https://fieldtheory.dev/images/fieldtheory-icon-white.png" alt="Field Theory" class="logo dark-logo">
      </a>
    </header>
    <article class="content">${html}</article>
    <footer class="footer">
      <p class="made-by">Made by the Librarian at <a href="https://fieldtheory.dev">fieldtheory.dev</a></p>
      ${author}
      <div class="controls">
        <button class="icon-btn" id="copyBtn" title="Copy link">
          <svg id="copyIcon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
          <svg id="checkIcon" style="display:none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </button>
        <button class="icon-btn" id="themeBtn" title="Toggle theme">
          <svg id="sunIcon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
          </svg>
          <svg id="moonIcon" style="display:none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
          </svg>
        </button>
        ${showRandom ? `<a class="icon-btn random-btn" href="/api/librarian/random?exclude=${slug}" title="Random reading">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
          </svg>
        </a>` : ''}
      </div>
    </footer>
  </div>
  <script>
    (function() {
      var body = document.body;
      var themeBtn = document.getElementById('themeBtn');
      var sunIcon = document.getElementById('sunIcon');
      var moonIcon = document.getElementById('moonIcon');
      var copyBtn = document.getElementById('copyBtn');
      var copyIcon = document.getElementById('copyIcon');
      var checkIcon = document.getElementById('checkIcon');

      function getTheme() {
        var saved = localStorage.getItem('librarian-theme');
        if (saved) return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }

      function setTheme(t) {
        if (t === 'dark') {
          body.classList.add('dark');
          sunIcon.style.display = 'block';
          moonIcon.style.display = 'none';
        } else {
          body.classList.remove('dark');
          sunIcon.style.display = 'none';
          moonIcon.style.display = 'block';
        }
        localStorage.setItem('librarian-theme', t);
      }

      setTheme(getTheme());

      themeBtn.onclick = function() {
        setTheme(body.classList.contains('dark') ? 'light' : 'dark');
      };

      copyBtn.onclick = function() {
        navigator.clipboard.writeText('${shareUrl}').then(function() {
          copyIcon.style.display = 'none';
          checkIcon.style.display = 'block';
          copyBtn.classList.add('copied');
          setTimeout(function() {
            copyIcon.style.display = 'block';
            checkIcon.style.display = 'none';
            copyBtn.classList.remove('copied');
          }, 2000);
        });
      };
    })();
  </script>
</body>
</html>`);
}

function errorPage(msg) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Found – Field Theory</title>
  <style>
    :root { --bg: #faf9f7; --text: #1a1a1a; --muted: #6b6b6b; }
    @media (prefers-color-scheme: dark) { :root { --bg: #1a1a1a; --text: #e8e8e8; --muted: #999; } }
    body { font-family: -apple-system, sans-serif; text-align: center; padding: 6rem 1.5rem; background: var(--bg); color: var(--text); min-height: 100vh; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 1rem; }
    p { color: var(--muted); }
    a { color: inherit; }
  </style>
</head>
<body>
  <h1>Reading Not Found</h1>
  <p>${esc(msg)}</p>
  <p style="margin-top: 2rem;"><a href="https://fieldtheory.dev">fieldtheory.dev</a></p>
</body>
</html>`;
}

function esc(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
}
