// GET /api/jobs?track=ai|quant|all — merged, classified internship postings.
// Identical for every visitor (per-user applied/hidden state lives in the
// browser or Supabase), so the CDN can cache it briefly.
import { jobsForTrack } from '../lib/jobs-store.mjs';

export async function GET(request) {
  const track = new URL(request.url).searchParams.get('track') || 'all';
  const jobs = await jobsForTrack(track);
  return new Response(JSON.stringify(jobs), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
