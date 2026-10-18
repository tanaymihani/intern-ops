// GET /api/heartbeat — last-run status of every scraper (drives the Sources panel).
import { loadHeartbeats } from '../lib/jobs-store.mjs';

export async function GET() {
  return new Response(JSON.stringify(await loadHeartbeats()), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=30',
    },
  });
}
