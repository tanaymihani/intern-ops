import { classifyJob, seasonIsPast } from './classify.mjs';

// One HiringCafe search per role family. HC's search is semantic enough that
// "… intern" mostly returns internships; classifyJob (with HC's own
// `commitment` field as a hint) makes the final call.
export const DEFAULT_HIRINGCAFE_QUERIES = Object.freeze([
  'machine learning intern',
  'artificial intelligence intern',
  'AI engineer intern',
  'data science intern',
  'research scientist intern',
  'deep learning intern',
  'computer vision intern',
  'quantitative research intern',
  'quantitative trading intern',
  'quantitative developer intern',
]);

export function parseHiringCafeQueries(value) {
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

/** Classify an HC hit; null when it isn't an AI/ML or quant internship. */
export function classifyHiringCafeJob(job) {
  const cls = classifyJob({ title: job?.title, company: job?.company, commitment: job?.commitment });
  if (!cls || (cls.season && seasonIsPast(cls.season))) return null;
  return cls;
}
