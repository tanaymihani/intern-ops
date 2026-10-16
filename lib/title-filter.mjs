/**
 * portals.yml title_filter — same matchers the scanner uses.
 * Board-dumps (JobRight → whole Workday/GH board) must use the positive
 * list so a GM software req does not pull in pipefitters and production.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { titlePasses } from './classify.mjs';

export function compileKeyword(kw) {
  if (/^[a-z]{2,3}$/.test(kw)) {
    const re = new RegExp(`\\b${kw}\\b`);
    return (lower) => re.test(lower);
  }
  return (lower) => lower.includes(kw);
}

/**
 * `mode: classify` hands the decision to lib/classify.mjs (AI/ML + Quant
 * internships), which needs the posting's company and the board's category
 * — hence the optional second argument. `positive` then acts as an extra
 * allow-list and `negative` still vetoes.
 *
 * @returns {(title: string, ctx?: { company?: string, category?: string }) => boolean}
 */
export function buildTitleFilter(titleFilter) {
  const normalize = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((k) => typeof k === 'string')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
    .map(compileKeyword);
  const positive = normalize(titleFilter?.positive);
  const negative = normalize(titleFilter?.negative);

  if (titleFilter?.mode === 'classify') {
    return (title, ctx = {}) => {
      const lower = (title || '').toLowerCase();
      if (negative.some((m) => m(lower))) return false;
      return titlePasses(title, ctx) || (positive.length > 0 && positive.some((m) => m(lower)));
    };
  }

  return (title) => {
    const lower = (title || '').toLowerCase();
    const hasPositive = positive.length === 0 || positive.some((m) => m(lower));
    const hasNegative = negative.some((m) => m(lower));
    return hasPositive && !hasNegative;
  };
}

/**
 * @param {string} [root]
 * @param {{ includeNegative?: boolean }} [opts] includeNegative=false for the
 *   jobs list: keep "Senior Software Engineer" even if scan excludes Senior.
 */
export function loadPortalsTitleFilter(root = process.cwd(), { includeNegative = false } = {}) {
  const path = resolve(root, process.env.CAREER_OPS_PORTALS || 'portals.yml');
  if (!existsSync(path)) return () => true;
  try {
    const config = yaml.load(readFileSync(path, 'utf8')) || {};
    const tf = config.title_filter || {};
    return buildTitleFilter(includeNegative ? tf : { mode: tf.mode, positive: tf.positive, negative: [] });
  } catch {
    return () => true;
  }
}
