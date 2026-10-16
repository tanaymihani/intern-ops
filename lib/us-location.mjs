/**
 * US-only location gate for Jobs UI + HC feed.
 *
 * Rules (in order):
 * 1. Worldwide / anywhere-in-the-world with no specific foreign country → keep
 *    (US-remote-eligible; Hiring Cafe flexible_regions)
 * 2. Clear non-US in the *location text* with no US in that same text → drop
 * 3. US country / city / state in location text or Workday path hint → keep
 * 4. Workday/Greenhouse URL path contains USA / United-States → keep
 * 5. "2 Locations" / empty / bare Remote → allowUnknown (default true)
 *
 * Never run 2-letter state matching against the raw URL (`.co/` ≠ Colorado,
 * `MS-D365` ≠ Mississippi) — that was a second false-positive/false-negative class.
 */

const NON_US = /\b(india|indian|philippines|philippine|manila|cebu|pakistan|bangladesh|sri\s*lanka|nepal|nigeria|kenya|ghana|egypt|south\s*africa|brazil|argentina|chile|colombia|peru|mexico|canada|toronto|vancouver|montreal|ottawa|ontario|united\s*kingdom|\buk\b|london|england|scotland|wales|ireland|belfast|dublin|germany|berlin|munich|france|paris|netherlands|amsterdam|spain|madrid|barcelona|italy|portugal|poland|romania|hungary|czech|sweden|norway|denmark|finland|switzerland|austria|belgium|australia|sydney|melbourne|new\s*zealand|singapore|japan|tokyo|korea|seoul|china|shanghai|beijing|taiwan|hong\s*kong|vietnam|thailand|indonesia|malaysia|israel|tel\s*aviv|uae|dubai|saudi|emea|apac|latam|latin\s*america|\beurope\b|\basia\b|costa\s*rica|bangalore|bengaluru|hyderabad|chennai|pune|mumbai|delhi|gurgaon|gurugram|noida|armenia|kazakhstan|serbia|ukraine|belarus|tbilisi)\b/i;

/** Global-remote with no country pin — eligible for a US-remote search. */
const WORLDWIDE_REMOTE = /\b(worldwide|anywhere\s+in\s+the\s+world|work\s+from\s+anywhere|globally|global(?:\s+remote)?|remote\s+anywhere|anywhere\s+remote)\b/i;

const US_COUNTRY = /\b(united\s*states|\bu\.?\s*s\.?\s*a\.?\b|\busa\b|(?<![a-z])us(?![a-z])|remote\s*[-\s:]*(us|usa|united\s*states)|(us|usa|united\s*states)\s*[-\s:]*remote)\b/i;

const US_PLACE = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s*hampshire|new\s*jersey|new\s*mexico|new\s*york|north\s*carolina|north\s*dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s*island|south\s*carolina|south\s*dakota|tennessee|texas|utah|vermont|virginia|washington|west\s*virginia|wisconsin|wyoming|district\s*of\s*columbia|\bnyc\b|sf\s*bay|bay\s*area|los\s*angeles|san\s*francisco|seattle|austin|boston|chicago|denver|atlanta|dallas|miami|phoenix|portland|san\s*diego|san\s*jose|chantilly|milpitas|bellevue|richardson|savannah|augusta|macon|alpharetta)\b/i;

/** US state Georgia — not the country (London · Armenia · Georgia · Kazakhstan). */
const GEORGIA_US = /\b(atlanta|savannah|augusta|macon|alpharetta|marietta|\bga\b|georgia,\s*(ga|united\s*states|usa)|united\s*states.*georgia)\b/i;

/** State abbrevs — only safe on human location text, not URLs. */
const US_STATE_ABBR = /\b(a[klrz]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adehinost]|n[cdehjmvyc]|o[hkr]|pa|ri|s[cd]|t[nxi]|ut|v[at]|w[aivy]|dc)\b/i;

/** Humanize Workday path segment: USA---Missouri---St-Louis → USA · Missouri · St Louis */
export function locationHintFromUrl(url) {
  if (!url) return '';
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const m = path.match(/\/job\/([^/]+)/i);
    if (!m) return '';
    return m[1]
      .replace(/_/g, ' ')
      .split('---')
      .map((p) => p.replace(/-/g, ' ').trim())
      .filter(Boolean)
      .join(' · ');
  } catch {
    return '';
  }
}

function hasUsSignal(text) {
  const s = String(text || '');
  if (!s) return false;
  if (US_COUNTRY.test(s)) return true;
  if (GEORGIA_US.test(s)) return true;
  const forPlace = /\bgeorgia\b/i.test(s) ? s.replace(/\bgeorgia\b/gi, ' ') : s;
  return US_PLACE.test(forPlace) || US_STATE_ABBR.test(forPlace);
}

function hasNonUsSignal(text) {
  const s = String(text || '').toLowerCase().replace(/\bnew mexico\b/g, 'nm_state');
  return NON_US.test(s);
}

/** True when the pin is global-remote, not a named foreign country. */
export function isWorldwideRemoteLocation(location) {
  const raw = String(location || '').trim();
  if (!raw || !WORLDWIDE_REMOTE.test(raw)) return false;
  const rest = raw
    .replace(WORLDWIDE_REMOTE, ' ')
    .replace(/[()[\]·|,;/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rest || /^(remote|hybrid|onsite|on-?site|in\s*office)$/i.test(rest)) return true;
  // Leftover "or" is a conjunction, not Oregon — only keep if no foreign country remains.
  if (hasNonUsSignal(rest)) return false;
  return true;
}

function urlPathLooksUs(url) {
  if (!url) return false;
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    // Workday country tokens in path
    if (/(?:^|\/|---)USA(?:---|\/|$)/i.test(path)) return true;
    if (/United[_ -]?States/i.test(path)) return true;
    if (/(?:^|\/|---)US(?:---|\/|$)/i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

function urlPathLooksNonUs(url) {
  if (!url) return false;
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const hint = locationHintFromUrl(url);
    return hasNonUsSignal(path) || hasNonUsSignal(hint);
  } catch {
    return false;
  }
}

/**
 * @param {string} location
 * @param {{ allowUnknown?: boolean, url?: string }} [opts]
 */
export function isUsLocation(location, { allowUnknown = true, url = '' } = {}) {
  const raw = String(location || '').trim();
  const hint = locationHintFromUrl(url);

  // 0) Global / North America remote → keep (US-remote search)
  if (isWorldwideRemoteLocation(raw)) return true;
  if (/\bnorth\s+america\b/i.test(raw)) return true;

  // 1) Location text is explicitly foreign without a real US country/city name → drop
  //    (do not let 2-letter state abbrs override — "de la Sierra" ≠ Louisiana)
  if (raw && hasNonUsSignal(raw) && !US_COUNTRY.test(raw) && !US_PLACE.test(raw)) {
    return false;
  }

  // 2) Location text has US → keep (even if also lists Canada/EU)
  if (raw && hasUsSignal(raw)) return true;

  // 3) Workday humanized path / USA token in path
  if (hint && hasUsSignal(hint)) return true;
  if (urlPathLooksUs(url)) return true;

  // 4) Path clearly foreign (India---Remote) and no US → drop
  if (urlPathLooksNonUs(url) && !urlPathLooksUs(url)) return false;

  // 5) Generic ATS placeholders
  if (/^\d+\s+locations?$/i.test(raw)) return allowUnknown;
  if (/^(remote|hybrid|onsite|on-?site|in\s*office)([\s,/|-]*remote)?$/i.test(raw)) {
    return allowUnknown;
  }
  if (!raw) return allowUnknown;

  // 6) Unknown free-text with no signals
  return false;
}

/** Prefer a real place string when ATS says "2 Locations". */
export function displayLocation(location, url = '') {
  const raw = String(location || '').trim();
  if (raw && !/^\d+\s+locations?$/i.test(raw)) return raw;
  return locationHintFromUrl(url) || raw || '';
}
