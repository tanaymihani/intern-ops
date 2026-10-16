// Data-role equivalent of lib/hiringcafe-query.mjs — same shape, different
// role universe. Separated rather than merged into the software list so the
// two tracks (software.jobs.manavmalavia.org vs jobs-da.manavmalavia.org)
// can be queried, filtered, and deployed independently.

export const DEFAULT_DATA_QUERIES = Object.freeze([
  'data engineer',
  'data analyst',
  'data scientist',
  'etl developer',
  'power bi developer',
  'database administrator',
  'business intelligence engineer',
  'business intelligence analyst',
  'analytics engineer',
  'machine learning engineer',
  'ai ml engineer',
  'data warehouse engineer',
  'product analyst',
  'python engineer',
]);

const DATA_SIGNAL = /\b(data engineer|data analyst|data scientist|data warehouse|etl|elt|power\s?bi|tableau|database administrator|\bdba\b|business intelligence|\bbi\b analyst|analytics engineer|analytics|machine learning|ml engineer|\bai[\/\s-]?ml\b|ai engineer|python engineer|product analyst|data pipeline|data platform)\b/i;
const SENIOR_OR_MANAGEMENT = /\b(senior|sr\.?|staff|principal|lead|manager|director|head|architect|vice president|vp)\b/i;
const PHYSICAL_ENGINEERING = /\b(civil|structural|mechanical|manufacturing|electrical|construction|roadway|bridge|chemical|process|controls|plumbing|hvac)\b/i;

export function parseDataQueries(value) {
  const input = Array.isArray(value) ? value : String(value || '').split('|');
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const query = String(item || '').trim();
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    out.push(query);
  }
  return out;
}

export function acceptDataJob(job, { baseline = false } = {}) {
  if (baseline) return true;
  const title = String(job?.title || '').trim();
  if (!title || SENIOR_OR_MANAGEMENT.test(title) || PHYSICAL_ENGINEERING.test(title)) return false;
  return DATA_SIGNAL.test(title);
}
