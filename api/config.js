// GET /api/config — public client config. Without Supabase or the private
// state repo, the dashboard keeps applied/hidden marks in this browser only.
import { storeConfigured } from '../lib/doc-store.mjs';

export function GET() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  return new Response(JSON.stringify({
    supabase: supabaseUrl && supabaseAnonKey ? { url: supabaseUrl, anonKey: supabaseAnonKey } : null,
    refreshLogin: Boolean(storeConfigured() && process.env.FEED_KEY),
    sync: storeConfigured(),
    gate: Boolean(process.env.SITE_PASSWORD),
    repo: process.env.DATA_REPO || '',
  }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}
