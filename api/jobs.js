// GET /api/jobs?track=ai|quant|all — merged, classified internship postings.
// Private cache only: the site is password-protected, so responses must not
// sit in a shared CDN cache.
import { jobsForTrack } from '../lib/jobs-store.mjs';

export async function GET(request) {
  const track = new URL(request.url).searchParams.get('track') || 'all';
  const jobs = await jobsForTrack(track);
  return new Response(JSON.stringify(jobs), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=30',
    },
  });
}
