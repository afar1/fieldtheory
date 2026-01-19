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
    .select('title, content, author_name')
    .eq('slug', slug)
    .eq('is_public', true)
    .single();

  if (error || !reading) {
    return res.status(404).send(errorPage("This reading doesn't exist or has been unshared."));
  }

  const html = await marked(reading.content);
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
  const author = authorFormatted
    ? ` and inspired by the work of <span>${esc(authorFormatted)}</span>`
    : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(reading.title)} – Field Theory</title>
  <meta name="description" content="A reading from the Field Theory Librarian">
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
      justify-content: flex-end;
      margin-bottom: 3rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .theme-toggle {
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 14px;
      color: var(--text-secondary);
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .theme-toggle:hover { border-color: var(--text); color: var(--text); }
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
      margin-top: 4rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 0.9rem;
      color: var(--text-secondary);
    }
    .made-by { margin-bottom: 1.5rem; }
    .made-by span { font-style: italic; }
    .footer a { color: var(--text); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .copy-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 0.875rem;
      color: var(--text-secondary);
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .copy-btn:hover { border-color: var(--text); color: var(--text); }
    .copy-btn.copied { border-color: var(--accent); color: var(--accent); }
  </style>
</head>
<body>
  <div class="page">
    <header class="header">
      <button class="theme-toggle" id="themeBtn">Dark</button>
    </header>
    <article class="content">${html}</article>
    <footer class="footer">
      <p class="made-by">Made by The Librarian at <a href="https://fieldtheory.dev">fieldtheory.dev</a>${author}</p>
      <button class="copy-btn" id="copyBtn">Copy link</button>
    </footer>
  </div>
  <script>
    (function() {
      var body = document.body;
      var themeBtn = document.getElementById('themeBtn');
      var copyBtn = document.getElementById('copyBtn');

      function getTheme() {
        var saved = localStorage.getItem('librarian-theme');
        if (saved) return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }

      function setTheme(t) {
        if (t === 'dark') {
          body.classList.add('dark');
          themeBtn.textContent = 'Light';
        } else {
          body.classList.remove('dark');
          themeBtn.textContent = 'Dark';
        }
        localStorage.setItem('librarian-theme', t);
      }

      setTheme(getTheme());

      themeBtn.onclick = function() {
        setTheme(body.classList.contains('dark') ? 'light' : 'dark');
      };

      copyBtn.onclick = function() {
        navigator.clipboard.writeText('${shareUrl}').then(function() {
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(function() {
            copyBtn.textContent = 'Copy link';
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
