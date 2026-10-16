/**
 * Drop roles that require US security clearance (Secret / TS/SCI / polygraph / etc.).
 *
 * HC search already sets securityClearances: ['None']. Scan/Workday rows often
 * have empty summaries, so JD lines like "able to obtain a U.S. Government
 * security clearance" never appear in our fields — we also gate on title,
 * company slug, Workday host, and known cleared-contractor employers.
 */

const CLEARANCE_RE = /\b(?:(?:active|current|existing|must\s+hold|must\s+have|requires?|required|need(?:s|ed)?)\s+(?:an?\s+)?(?:active\s+)?(?:secret|top\s*secret|ts\/?\s*sci|doe\s*[ql]|q\s+clearance|l\s+clearance)|(?:secret|top\s*secret|ts\/?\s*sci)\s+clearance|security\s+clearance|clearance\s+required|u\.?\s*s\.?\s*government\s+security\s+clearance|government\s+security\s+clearance|able\s+to\s+obtain\s+(?:an?\s+)?(?:u\.?\s*s\.?\s*government\s+)?(?:secret|top\s*secret|ts\/?\s*sci|security)\s*clearance|obtain\s+(?:and\s+maintain\s+)?(?:a\s+)?(?:u\.?\s*s\.?\s*government\s+)?(?:secret|top\s*secret|ts\/?\s*sci|security)\s*clearance|polygraph|ts\/?\s*sci|top\s*secret(?:\s+cleared)?|dod\s+clearance|doe\s+[ql]\s+clearance|public\s+trust\s+(?:clearance|required)|us\s+federal|\(aht\))\b/i;

/** Employers / board tokens that are overwhelmingly clearance-gated for SWE. */
const CLEARED_COMPANY_RE = /\b(?:ngc|northrop(?:\s*grumman)?|northropgrumman|northrop_grumman|lockheed|lmco|\brtx\b|raytheon|general\s*dynamics|gdit|booz\s*allen|leidos|\bsaic\b|\bcaci\b|parsons|peraton|mantech|wyetech(?:llc)?|accenturefederal(?:services)?|l3harris|mitre)\b/i;

/** Locations that almost always imply cleared intel/defense work. */
const CLEARED_LOCATION_RE = /\b(?:ft\.?\s*meade|fort\s*meade|annapolis\s*junction|quantico)\b/i;

/** @param {{ title?: string, summary?: string, company_tagline?: string, location?: string, company?: string, url?: string, portal?: string }} job */
export function requiresClearance(job = {}) {
  const blob = [job.title, job.summary, job.company_tagline, job.location]
    .filter(Boolean)
    .join(' \n ');
  if (blob && CLEARANCE_RE.test(blob)) return true;

  const who = [job.company, job.portal, job.url].filter(Boolean).join(' ');
  if (who && CLEARED_COMPANY_RE.test(who)) return true;

  if (job.location && CLEARED_LOCATION_RE.test(job.location)) return true;

  return false;
}
