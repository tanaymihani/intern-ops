// GET /api/config — public client config. Supabase is optional: without it
// the dashboard keeps applied/hidden state in this browser's localStorage.
export function GET() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  return new Response(JSON.stringify({
    supabase: supabaseUrl && supabaseAnonKey ? { url: supabaseUrl, anonKey: supabaseAnonKey } : null,
    refreshLogin: Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.FEED_KEY),
    sync: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    gate: Boolean(process.env.SITE_PASSWORD),
    repo: process.env.DATA_REPO || '',
  }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}
