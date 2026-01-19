import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://cighxaroptskntwbrctl.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  const { exclude } = req.query;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Get all public reading slugs
  const { data: readings, error } = await supabase
    .from('shared_readings')
    .select('slug')
    .eq('is_public', true);

  if (error || !readings || readings.length === 0) {
    return res.redirect(302, 'https://fieldtheory.dev');
  }

  // Filter out the current reading if specified
  const available = exclude
    ? readings.filter(r => r.slug !== exclude)
    : readings;

  if (available.length === 0) {
    return res.redirect(302, 'https://fieldtheory.dev');
  }

  // Pick a random one
  const random = available[Math.floor(Math.random() * available.length)];
  return res.redirect(302, `https://librarian.fieldtheory.dev/${random.slug}`);
}
