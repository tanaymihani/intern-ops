// GET /api/jobs?track=ai|quant|all — merged, classified internship postings.
// Private cache only: the site is password-protected, so responses must not
// sit in a shared CDN cache. The ETag lets the browser's next poll get a
// bodiless 304 while nothing changed (the list is ~200 KB gzipped).
import { createHash } from 'crypto';
import { jobsForTrack } from '../lib/jobs-store.mjs';

export async function GET(request) {
  const track = new URL(request.url).searchParams.get('track') || 'all';
  const body = JSON.stringify(await jobsForTrack(track));
  const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, max-age=30',
    etag,
  };
  const seen = (request.headers.get('if-none-match') || '').split(',').map((t) => t.trim().replace(/^W\//, ''));
  if (seen.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
