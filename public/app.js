// intern-ops dashboard — adapted from career-ops' jobs view.
import { guessDomain, emailFromPattern, COMMON_PATTERNS, outreachLinks, personLinks } from './people-core.js';
// Data: GET /api/jobs?track=… (shared, cacheable). Per-user state (opened /
// applied / hidden) lives in localStorage, or in Supabase when /api/config
// says it's configured (then GitHub sign-in is required, like career-ops).

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const empty = $('empty');
const stat = $('stat');
const q = $('q');
const toast = $('toast');
const newBanner = $('newBanner');
const staleBanner = $('staleBanner');
const hideReasonModal = $('hideReasonModal');

const PREFS_KEY = 'intern-ops-prefs-v1';
const PREFS_VERSION = 2;
const STATE_KEY = 'intern-ops-state-v1';
const APPLIED_GRACE_MS = 4000;
const POLL_MS = 60_000;
const STALE_POSTED_DAYS = 60;

let JOBS = [];
let CONFIG = { supabase: null, refreshLogin: false };
let sourceMode = 'jobs'; // jobs | hidden
let knownKeys = new Set();
let pendingNewKeys = new Set();
let pendingHideKeys = new Set();
const pendingHideTimers = new Map();
let suppressScrollPreserve = false;
let lastJobsSignature = '';
let olderExpanded = false;
let pendingHide = null;
let toastTimer;

// ── Preferences ─────────────────────────────────────────────────────

const DEFAULT_PREFS = {
  track: 'ai', age: '7', season: '', degree: 'no-phd', geo: 'us', work: '', source: '', ats: '',
  sort: 'posted', hideApplied: true, hideOpened: false, hideCoop: false, hideReposts: false,
  officialOnly: false, company: '', loc: '', filtersOpen: false,
};
let prefs = { ...DEFAULT_PREFS };
try { prefs = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { /* private mode */ }
// v2: cards are dated and sorted by when the employer posted, not when we found it.
if ((prefs.v || 1) < PREFS_VERSION) prefs = { ...prefs, sort: 'posted', v: PREFS_VERSION };
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ── State store: localStorage, synced through /api/state when the
// deployment has storage (or Supabase when configured) ───────────────

const SYNC_DEBOUNCE_MS = 2500;

const store = {
  mode: 'local', // local | sync | supabase
  client: null,
  userId: null,
  map: new Map(),
  pending: new Map(), // key → patch waiting to be sent to /api/state
  flushTimer: null,
  retryMs: 0, // current back-off after a failed sync (0 = last sync worked)

  loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      this.map = new Map(Object.entries(raw));
    } catch {
      this.map = new Map();
    }
  },
  saveLocal() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(Object.fromEntries(this.map))); } catch { /* ignore */ }
  },
  async loadRemote() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.client.from('job_state').select('*').range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    this.map = new Map(rows.map((r) => [r.job_key, {
      viewedAt: r.viewed_at, appliedAt: r.applied_at, hiddenAt: r.hidden_at, hideReason: r.hide_reason, url: r.url,
    }]));
  },
  /** Pull the synced marks; marks this browser made before syncing get uploaded. */
  async loadSync() {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`state ${res.status}`);
    const { marks } = await res.json();
    const localOnly = [...this.map].filter(([k]) => !marks[k]);
    this.map = new Map(Object.entries(marks).map(([k, r]) => [k, {
      viewedAt: r.viewedAt, appliedAt: r.appliedAt, hiddenAt: r.hiddenAt, hideReason: r.hideReason, url: r.url,
    }]));
    for (const [k, v] of this.pending) this.map.set(k, { ...this.map.get(k), ...v });
    for (const [k, v] of localOnly) {
      this.map.set(k, v);
      this.pending.set(k, { ...v });
    }
    this.saveLocal();
    if (this.pending.size) this.scheduleFlush(0);
  },
  scheduleFlush(ms = SYNC_DEBOUNCE_MS) {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), ms);
  },
  /** Send queued marks (a burst of clicks = one write; a big backlog goes 200 at a time). */
  async flush(keepalive = false) {
    if (this.mode !== 'sync' || !this.pending.size) return;
    const batch = [...this.pending].slice(0, 200);
    const patches = Object.fromEntries(batch);
    for (const [k] of batch) this.pending.delete(k);
    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patches }),
        keepalive,
      });
      if (!res.ok) throw new Error(`state ${res.status}`);
      this.retryMs = 0;
      if (this.pending.size) this.scheduleFlush(0);
    } catch {
      // Keep them (newer local edits win) and retry, backing off up to 10 min;
      // they're already in localStorage. Say so once per outage, not per retry.
      for (const [k, v] of Object.entries(patches)) this.pending.set(k, { ...v, ...(this.pending.get(k) || {}) });
      if (!this.retryMs) showToast('Saved on this device — will sync when back online');
      this.retryMs = Math.min((this.retryMs || 10_000) * 2, 600_000);
      this.scheduleFlush(this.retryMs);
    }
  },
  get(key) {
    return this.map.get(key) || {};
  },
  async patch(job, patch) {
    const next = { ...this.get(job.key), ...patch, url: job.url };
    this.map.set(job.key, next);
    if (this.mode === 'supabase') {
      const { error } = await this.client.from('job_state').upsert({
        user_id: this.userId,
        job_key: job.key,
        url: job.url,
        title: job.title,
        company: job.company,
        viewed_at: next.viewedAt || null,
        applied_at: next.appliedAt || null,
        hidden_at: next.hiddenAt || null,
        hide_reason: next.hideReason || null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    } else {
      this.saveLocal();
      if (this.mode === 'sync') {
        this.pending.set(job.key, { ...(this.pending.get(job.key) || {}), ...patch, url: job.url, title: job.title, company: job.company });
        this.scheduleFlush();
      }
    }
    return next;
  },
};

function applyState(job) {
  const s = store.get(job.key);
  job.viewed = Boolean(s.viewedAt);
  job.applied = Boolean(s.appliedAt);
  job.doubtful = Boolean(s.hiddenAt);
  job.hideReason = s.hideReason || '';
  return job;
}

// ── Small helpers ───────────────────────────────────────────────────

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isDateOnly(iso) {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
}

/** Calendar days from local midnight. Date-only rows have no clock time. */
function calendarDaysAgo(ymd) {
  const [Y, M, D] = String(ymd).split('-').map(Number);
  if (!Y || !M || !D) return NaN;
  const posted = new Date(Y, M - 1, D);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - posted.getTime()) / 86400000);
}

function parseJobTime(iso) {
  if (!iso) return NaN;
  if (isDateOnly(iso)) {
    const [Y, M, D] = iso.split('-').map(Number);
    return new Date(Y, M - 1, D).getTime();
  }
  return Date.parse(iso);
}

const discoveryEpoch = (j) => parseJobTime(j.first_seen || '');
const employerEpoch = (j) => parseJobTime(j.posted_at_full || j.posted_at || '');

function localDayKey(iso) {
  if (!iso) return null;
  let Y; let M; let D;
  if (isDateOnly(iso)) {
    [Y, M, D] = iso.split('-').map(Number);
  } else {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t);
    Y = d.getFullYear(); M = d.getMonth() + 1; D = d.getDate();
  }
  return (Y && M && D) ? (Y * 10000 + M * 100 + D) : null;
}

const discoveryDayKey = (j) => localDayKey(j.first_seen || '');

function todayDayKey() {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

function isTodayLocal(iso) {
  const key = localDayKey(iso);
  return key != null && key === todayDayKey();
}

/** When the employer posted it, or — if the source gives no date — when we found it. */
const postedOrFound = (j) => j.posted_at_full || j.posted_at || j.first_seen || '';

/** Today / Yesterday / Older, by posting date (or discovery date in "Recently found" sort). */
function dayBucket(j) {
  const key = localDayKey(prefs.sort === 'discovered' ? (j.first_seen || '') : postedOrFound(j));
  if (key == null) return 'older';
  if (key === todayDayKey()) return 'today';
  const yest = new Date();
  yest.setHours(0, 0, 0, 0);
  yest.setDate(yest.getDate() - 1);
  const yestKey = yest.getFullYear() * 10000 + (yest.getMonth() + 1) * 100 + yest.getDate();
  return key === yestKey ? 'yesterday' : 'older';
}

function stableJobTieBreak(a, b) {
  return (a.company || '').localeCompare(b.company || '')
    || (a.title || '').localeCompare(b.title || '')
    || (a.key || '').localeCompare(b.key || '');
}

function compareByPosted(a, b) {
  const ap = employerEpoch(a);
  const bp = employerEpoch(b);
  const aHas = Number.isFinite(ap);
  const bHas = Number.isFinite(bp);
  if (aHas && bHas && ap !== bp) return bp - ap;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  return stableJobTieBreak(a, b);
}

/** Newest posting first; postings without an employer date slot in by when we found them. */
function compareByNewest(a, b) {
  const at = parseJobTime(postedOrFound(a));
  const bt = parseJobTime(postedOrFound(b));
  const aHas = Number.isFinite(at);
  const bHas = Number.isFinite(bt);
  if (aHas && bHas && at !== bt) return bt - at;
  if (aHas !== bHas) return aHas ? -1 : 1;
  const af = discoveryEpoch(a);
  const bf = discoveryEpoch(b);
  if (Number.isFinite(af) && Number.isFinite(bf) && af !== bf) return bf - af;
  return stableJobTieBreak(a, b);
}

function compareByDiscovered(a, b) {
  // Same calendar day of discovery groups together first.
  const ad = discoveryDayKey(a);
  const bd = discoveryDayKey(b);
  if (ad != null && bd != null && ad !== bd) return bd - ad;
  if (ad != null && bd == null) return -1;
  if (ad == null && bd != null) return 1;
  // Found today AND posted today beats a re-discovered old posting.
  const aFresh = ad === todayDayKey() && isTodayLocal(a.posted_at_full || a.posted_at || '');
  const bFresh = bd === todayDayKey() && isTodayLocal(b.posted_at_full || b.posted_at || '');
  if (aFresh !== bFresh) return aFresh ? -1 : 1;
  // Within a day, the employer's own date orders better than our scrape clock
  // (a 5-minute scan and a daily list run would otherwise interleave randomly).
  const byPosted = compareByPosted(a, b);
  if (byPosted) return byPosted;
  const ap = discoveryEpoch(a);
  const bp = discoveryEpoch(b);
  if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return bp - ap;
  return stableJobTieBreak(a, b);
}

function timeWithin(iso, maxAgeMs) {
  if (!iso) return false;
  const maxDays = Math.max(1, Math.round(maxAgeMs / 86400000));
  if (isDateOnly(iso)) {
    const days = calendarDaysAgo(iso);
    return Number.isFinite(days) && days >= 0 && days <= maxDays;
  }
  const t = Date.parse(iso);
  return Number.isFinite(t) && (Date.now() - t) <= maxAgeMs;
}

/** "Past N days" = posted in the last N days; postings with no employer date use when we found them. */
function withinAge(j, maxAgeMs) {
  if (!maxAgeMs) return true;
  return timeWithin(postedOrFound(j), maxAgeMs);
}

/** Posted well before we found it — still worth a look, so it gets a "new to you" tag. */
function isLateFind(j) {
  const posted = employerEpoch(j);
  const found = discoveryEpoch(j);
  return Number.isFinite(posted) && Number.isFinite(found)
    && Date.now() - found < 24 * 3600000 && found - posted > 48 * 3600000;
}

function formatRel(iso) {
  if (!iso) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const calOf = (s) => {
    const [Y, M, D] = String(s).slice(0, 10).split('-').map(Number);
    return (Y && M && D) ? `${months[M - 1]} ${D}` : '';
  };
  if (isDateOnly(iso)) {
    const d = calendarDaysAgo(iso);
    if (!Number.isFinite(d)) return iso;
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 60) return `${d}d · ${calOf(iso)}`;
    return iso;
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  const h = Math.round((Date.now() - t) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d · ${calOf(iso)}`;
  return iso.slice(0, 10);
}

/** "14h ago", "3d ago · Oct 15", "today", "yesterday". */
function formatAgo(iso) {
  const rel = formatRel(iso);
  if (/^\d+h$/.test(rel)) return `${rel} ago`;
  return rel.replace(/^(\d+d)( · )/, '$1 ago$2');
}

/** Big label = when the employer posted it; small = when we found it (if notably later). */
function ageParts(j) {
  const postedRaw = j.posted_at_full || j.posted_at;
  if (postedRaw) {
    const posted = employerEpoch(j);
    const found = discoveryEpoch(j);
    // Date-only postings ("today") have no clock time: only mention when we
    // found it if that was a later day. Timestamped ones: if 12h+ later.
    const showFound = Number.isFinite(found) && Number.isFinite(posted) && (isDateOnly(postedRaw)
      ? (localDayKey(j.first_seen) || 0) > (localDayKey(postedRaw) || 0)
      : found - posted > 12 * 3600000);
    return { mainText: `posted ${formatAgo(postedRaw)}`, subText: showFound ? `found ${formatAgo(j.first_seen)}` : '' };
  }
  if (j.first_seen) return { mainText: `found ${formatAgo(j.first_seen)}`, subText: 'posting date not listed' };
  return { mainText: '—', subText: '' };
}

/** Client copy of lib/us-location.mjs. */
function isUsLocationClient(location, allowUnknown = true) {
  const raw = String(location || '').trim();
  if (!raw) return allowUnknown;
  const georgiaIsCountry = /\bgeorgia\b/i.test(raw)
    && !/\b(atlanta|savannah|augusta|macon|alpharetta|\bga\b|united\s*states|usa)\b/i.test(raw);
  const probe = georgiaIsCountry ? raw.replace(/\bgeorgia\b/gi, ' ') : raw;
  const US_POS = /\b(united\s*states|\bu\.?s\.?a\.?\b|\bus\b|remote\s*[-\s]?(us|usa|united\s*states)|(us|usa|united\s*states)\s*[-\s]?remote|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s*hampshire|new\s*jersey|new\s*mexico|new\s*york|north\s*carolina|north\s*dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s*island|south\s*carolina|south\s*dakota|tennessee|texas|utah|vermont|virginia|washington|west\s*virginia|wisconsin|wyoming|district\s*of\s*columbia|\bdc\b|\bnyc\b|sf\s*bay|bay\s*area|los\s*angeles|\bla\b|san\s*francisco|seattle|austin|boston|chicago|denver|atlanta|dallas|miami|phoenix|portland|san\s*diego|san\s*jose|palo\s*alto|menlo\s*park|mountain\s*view|sunnyvale|redmond|cambridge,?\s*ma|pittsburgh|philadelphia|houston|greenwich|stamford)\b/i;
  const US_STATE_ABBR = /\b(a[klrz]|c[aot]|d[ce]|fl|g[au]|hi|i[adln]|k[sy]|la|m[adehinost]|n[cdehjmvyc]|o[hkr]|pa|ri|s[cd]|t[nxi]|ut|v[ait]|w[aivy])\b/i;
  const normalized = probe.toLowerCase().replace(/\bnew mexico\b/g, 'nm_state');
  const NON_US = /\b(india|indian|philippines|manila|pakistan|bangladesh|sri\s*lanka|nepal|nigeria|kenya|ghana|egypt|south\s*africa|brazil|argentina|chile|colombia|peru|mexico|canada|toronto|vancouver|montreal|ottawa|waterloo|united\s*kingdom|\buk\b|london|england|scotland|wales|ireland|dublin|germany|berlin|munich|france|paris|netherlands|amsterdam|spain|madrid|barcelona|italy|portugal|poland|romania|hungary|czech|sweden|norway|denmark|finland|switzerland|zurich|austria|belgium|australia|sydney|melbourne|new\s*zealand|singapore|japan|tokyo|korea|seoul|china|shanghai|beijing|taiwan|hong\s*kong|vietnam|thailand|indonesia|malaysia|israel|tel\s*aviv|uae|dubai|saudi|emea|apac|latam|latin\s*america|\beurope\b|armenia|kazakhstan|serbia|ukraine|belarus|tbilisi)\b/i;
  const WORLDWIDE = /\b(worldwide|anywhere\s+in\s+the\s+world|work\s+from\s+anywhere|globally|global(?:\s+remote)?|remote\s+anywhere|anywhere\s+remote)\b/i;
  if (WORLDWIDE.test(raw)) {
    const rest = raw.replace(WORLDWIDE, ' ').replace(/[()[\]·|,;/]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rest || /^(remote|hybrid|onsite|on-?site|in\s*office)$/i.test(rest)) return true;
    if (!NON_US.test(rest.toLowerCase().replace(/\bnew mexico\b/g, 'nm_state'))) return true;
  }
  if (/\bnorth\s+america\b/i.test(raw)) return true;
  if (US_POS.test(probe)) return true;
  if (NON_US.test(normalized)) return false;
  if (US_STATE_ABBR.test(probe)) return true;
  if (/^(remote|hybrid|onsite|on-?site|in\s*office)([\s,/|-]*remote)?$/i.test(raw)) return allowUnknown;
  return false;
}

function passesGeo(j) {
  if (!prefs.geo) return true;
  const loc = j.location || '';
  if (prefs.geo === 'us') return isUsLocationClient(loc, true);
  if (prefs.geo === 'remote-us') {
    if (!isUsLocationClient(loc, true)) return false;
    return String(j.workplace || '').toLowerCase() === 'remote' || /\bremote\b/i.test(loc);
  }
  return true;
}

const isOfficial = (j) => (j.feed || '').split('+').includes('scan');

// ── Filtering ───────────────────────────────────────────────────────

function filtered(opts = {}) {
  const hideApp = opts.hideApplied != null ? opts.hideApplied : prefs.hideApplied;
  const query = q.value.trim().toLowerCase();
  const locQ = prefs.loc.trim().toLowerCase();
  const coQ = prefs.company.trim().toLowerCase();
  const maxAgeMs = prefs.age ? Number(prefs.age) * 86400000 : 0;
  const rows = JOBS.filter((j) => {
    if (sourceMode === 'hidden' ? !j.doubtful : j.doubtful) return false;
    if (hideApp && j.applied && !pendingHideKeys.has(j.key)) return false;
    if (prefs.hideOpened && j.viewed && !j.applied) return false;
    if (prefs.hideCoop && j.coop) return false;
    if (prefs.hideReposts && j.repost) return false;
    if (prefs.officialOnly && !isOfficial(j)) return false;
    if (prefs.degree === 'no-phd' && j.degree === 'PhD') return false;
    if (prefs.degree === 'phd' && j.degree !== 'PhD') return false;
    if (prefs.season === '__none' && j.season) return false;
    if (prefs.season && prefs.season !== '__none' && j.season !== prefs.season) return false;
    if (!passesGeo(j)) return false;
    if (prefs.work && String(j.workplace || '').toLowerCase() !== prefs.work.toLowerCase()) return false;
    if (prefs.source && !(j.sources || []).includes(prefs.source)) return false;
    if (prefs.ats && (j.ats || '') !== prefs.ats) return false;
    if (locQ && !(j.location || '').toLowerCase().includes(locQ)) return false;
    if (coQ && !(j.company || '').toLowerCase().includes(coQ)) return false;
    if (maxAgeMs && sourceMode !== 'hidden' && !withinAge(j, maxAgeMs)) return false;
    if (!query) return true;
    const hay = [j.title, j.company, j.location, j.ats, j.season, j.summary, (j.sources || []).join(' '), (j.tools || []).join(' '), j.salary]
      .join(' ').toLowerCase();
    return hay.includes(query);
  });
  if (prefs.sort === 'company') {
    rows.sort((a, b) => (a.company || '').localeCompare(b.company || '') || (a.title || '').localeCompare(b.title || ''));
  } else if (prefs.sort === 'title') {
    rows.sort((a, b) => (a.title || '').localeCompare(b.title || '') || (a.company || '').localeCompare(b.company || ''));
  } else if (prefs.sort === 'discovered') {
    rows.sort(compareByDiscovered);
  } else {
    rows.sort(compareByNewest);
  }
  return rows;
}

// ── Rendering ───────────────────────────────────────────────────────

function cardHtml(j) {
  const bucket = dayBucket(j);
  const cls = ['card', `bucket-${bucket}`];
  if (pendingNewKeys.has(j.key)) cls.push('just-in');
  if (pendingHideKeys.has(j.key)) cls.push('pending-hide');
  if (j.doubtful) cls.push('doubtful');
  else if (j.applied) cls.push('applied');
  else if (j.viewed) cls.push('viewed');
  const ageP = ageParts(j);
  const whenTitle = [
    j.posted_at ? `Posted by the employer: ${j.posted_at_full || j.posted_at}` : 'The source gives no posting date',
    j.first_seen ? `First found by intern-ops: ${j.first_seen}` : '',
  ].filter(Boolean).join(' · ');

  const chips = [];
  const sources = j.sources || [];
  if (isOfficial(j)) {
    chips.push(`<span class="chip trust-official" title="Found directly on the employer's own board (${escapeHtml(j.ats || 'ATS')}) — not a third-party copy">✓ Official source</span>`);
  } else {
    chips.push(`<span class="chip trust-aggregated" title="Found via ${escapeHtml(sources.join(', '))}">via ${escapeHtml(sources[0] || 'aggregator')}</span>`);
  }
  const others = sources.filter((s, i) => (isOfficial(j) ? s !== 'Direct ATS scan' : i > 0));
  if (others.length) {
    chips.push(`<span class="chip sources-more" title="Also on: ${escapeHtml(others.join(', '))}">+${others.length} source${others.length > 1 ? 's' : ''}</span>`);
  }
  if (isLateFind(j)) {
    chips.push(`<span class="chip new-to-you" title="Posted ${escapeHtml(formatAgo(j.posted_at_full || j.posted_at))}, but intern-ops only found it in the last day">🆕 new to you</span>`);
  }
  if (prefs.track === 'all') {
    for (const t of j.tracks || []) chips.push(`<span class="chip track-${t}">${t === 'ai' ? 'AI/ML' : 'Quant'}</span>`);
  }
  if (j.season) chips.push(`<span class="chip season">${escapeHtml(j.season)}</span>`);
  if (j.degree === 'PhD') chips.push('<span class="chip phd" title="Title says PhD">PhD</span>');
  else if (j.degree) chips.push(`<span class="chip">${escapeHtml(j.degree)}</span>`);
  if (j.coop) chips.push('<span class="chip coop">Co-op</span>');
  if (j.salary) chips.push(`<span class="chip pay">${escapeHtml(j.salary)}</span>`);
  if (j.workplace) chips.push(`<span class="chip work">${escapeHtml(j.workplace)}</span>`);
  if (j.repost) chips.push('<span class="chip repost" title="Reposted — the employer has listed this role before">⟳ reposted</span>');
  const postedMs = employerEpoch(j);
  if (Number.isFinite(postedMs) && (Date.now() - postedMs) > STALE_POSTED_DAYS * 86400000) {
    const daysOld = Math.floor((Date.now() - postedMs) / 86400000);
    chips.push(`<span class="chip stale" title="Posted ${daysOld} days ago — may already be filled">${daysOld}d old</span>`);
  }
  if (typeof j.trust_score === 'number' && j.trust_score < 100) {
    const trustCls = j.trust_score < 60 ? 'chip trust-low' : 'chip trust-medium';
    chips.push(`<span class="${trustCls}" title="Legitimacy check: ${escapeHtml((j.trust_flags || []).join(', '))}">⚠ trust ${j.trust_score}</span>`);
  }
  if (j.ats && !sources.includes(j.ats)) chips.push(`<span class="chip">${escapeHtml(j.ats)}</span>`);
  const tools = Array.isArray(j.tools) ? j.tools.filter(Boolean) : [];
  const stackHtml = tools.length
    ? `<div class="stack-row"><div class="stack-label">Stack</div><div class="stack-tools">${tools.map((t) => `<span class="tool-chip">${escapeHtml(t)}</span>`).join('')}</div></div>`
    : '';
  return `<article class="${cls.join(' ')}" data-key="${escapeHtml(j.key)}" data-url="${escapeHtml(j.url)}">`
    + '<div class="meta">'
    + `<span class="company">${escapeHtml(j.company || 'Unknown')}</span>`
    + `<span class="when when-found bucket-${bucket}" title="${escapeHtml(whenTitle)}">${escapeHtml(ageP.mainText)}`
    + (ageP.subText ? `<span class="when-posted-sub">${escapeHtml(ageP.subText)}</span>` : '')
    + '</span></div>'
    + `<h2 class="title">${escapeHtml(j.title || 'Untitled')}</h2>`
    + `<div class="loc">${escapeHtml(j.location || 'Location n/a')}</div>`
    + `<div class="chips">${chips.join('')}</div>`
    + (j.summary ? `<div class="summary">${escapeHtml(j.summary)}</div>` : '')
    + stackHtml
    + '<div class="actions">'
    + '<button type="button" class="open-btn">Open</button>'
    + `<button type="button" class="people-btn" title="Recruiters, the team, alumni, emails">People${j.contacts?.length ? ` · ${j.contacts.length}` : ''}</button>`
    + `<button type="button" class="apply-btn">${j.applied ? 'Unmark applied' : 'Mark applied'}</button>`
    + `<button type="button" class="flag-btn${j.doubtful ? ' on' : ''}">${j.doubtful ? 'Unhide' : 'Hide'}</button>`
    + '</div></article>';
}

function paintCard(card, job) {
  if (!card || !job) return;
  card.classList.toggle('viewed', Boolean(job.viewed) && !job.applied && !job.doubtful);
  card.classList.toggle('applied', Boolean(job.applied));
  card.classList.toggle('doubtful', Boolean(job.doubtful));
  card.classList.toggle('pending-hide', pendingHideKeys.has(job.key));
  const applyBtn = card.querySelector('.apply-btn');
  if (applyBtn) applyBtn.textContent = job.applied ? 'Unmark applied' : 'Mark applied';
  const flagBtn = card.querySelector('.flag-btn');
  if (flagBtn) {
    flagBtn.textContent = job.doubtful ? 'Unhide' : 'Hide';
    flagBtn.classList.toggle('on', Boolean(job.doubtful));
  }
}

const BUCKET_LABELS = { today: 'Today', yesterday: 'Yesterday', older: 'Older' };
const bucketLabel = (key) => (key === 'older' ? 'Older' : `${prefs.sort === 'discovered' ? 'Found' : 'Posted'} ${BUCKET_LABELS[key].toLowerCase()}`);
const OLDER_COLLAPSE_COUNT = 9;

function bucketHeadHtml(bucketKey, total, appliedCount) {
  const pct = total ? Math.round((appliedCount / total) * 100) : 0;
  return '<div class="bucket-head"><div class="bucket-head-top">'
    + `<div class="bucket-title ${bucketKey}">${bucketLabel(bucketKey)}</div>`
    + `<div class="bucket-progress"><b>${appliedCount}</b> of ${total} applied</div>`
    + '</div></div>'
    + `<div class="bucket-bar"><div class="bucket-bar-fill ${bucketKey}" style="width:${pct}%"></div></div>`;
}

/** Today / Yesterday / Older sections, each with its own applied progress. */
function buildGridHtml(rows) {
  if (sourceMode === 'hidden' || (prefs.sort !== 'posted' && prefs.sort !== 'discovered')) return rows.map(cardHtml).join('');
  const fullRows = prefs.hideApplied ? filtered({ hideApplied: false }) : rows;
  const fullBy = { today: [], yesterday: [], older: [] };
  for (const j of fullRows) fullBy[dayBucket(j)].push(j);
  const shownBy = { today: [], yesterday: [], older: [] };
  for (const j of rows) shownBy[dayBucket(j)].push(j);
  let html = '';
  for (const key of ['today', 'yesterday', 'older']) {
    const total = fullBy[key].length;
    if (!total) continue;
    html += bucketHeadHtml(key, total, fullBy[key].filter((j) => j.applied).length);
    let cards = shownBy[key];
    const anyNewer = shownBy.today.length + shownBy.yesterday.length > 0;
    if (key === 'older' && anyNewer && !olderExpanded && cards.length > OLDER_COLLAPSE_COUNT) {
      const hiddenCount = cards.length - OLDER_COLLAPSE_COUNT;
      cards = cards.slice(0, OLDER_COLLAPSE_COUNT);
      html += cards.map(cardHtml).join('');
      html += `<button type="button" class="bucket-collapsed-toggle" data-expand-older="1">${hiddenCount} more in Older — expand</button>`;
    } else {
      html += cards.map(cardHtml).join('');
    }
  }
  return html;
}

function captureScrollAnchor() {
  if (suppressScrollPreserve || window.scrollY <= 0) return null;
  for (const c of grid.querySelectorAll('.card[data-key]')) {
    const r = c.getBoundingClientRect();
    if (r.bottom > 0) return { key: c.getAttribute('data-key'), offset: r.top };
  }
  return null;
}

function restoreScrollAnchor(anchor, fallbackScrollY) {
  if (suppressScrollPreserve) { suppressScrollPreserve = false; return; }
  requestAnimationFrame(() => {
    if (anchor) {
      const el = grid.querySelector(`.card[data-key="${CSS.escape(anchor.key)}"]`);
      if (el) { window.scrollBy(0, el.getBoundingClientRect().top - anchor.offset); return; }
    }
    if (fallbackScrollY > 0) window.scrollTo(0, fallbackScrollY);
  });
}

function paintControls() {
  const more = $('moreToggle');
  const extras = [prefs.company, prefs.loc, prefs.ats].filter((v) => String(v || '').trim()).length
    + (prefs.hideOpened ? 1 : 0) + (prefs.hideCoop ? 1 : 0) + (prefs.hideReposts ? 1 : 0) + (prefs.officialOnly ? 1 : 0);
  more.textContent = extras ? `More (${extras})` : 'More';
  more.classList.toggle('on', extras > 0);
  const hiddenBtn = $('hiddenToggle');
  const n = JOBS.filter((j) => j.doubtful).length;
  hiddenBtn.textContent = n ? `Hidden (${n})` : 'Hidden';
  hiddenBtn.classList.toggle('on', sourceMode === 'hidden');
}

function render() {
  const scrollY = window.scrollY;
  const anchor = captureScrollAnchor();
  const rows = filtered();
  const appliedInFilter = (sourceMode !== 'hidden' && prefs.hideApplied)
    ? filtered({ hideApplied: false }).filter((j) => j.applied).length
    : 0;
  $('hideAppliedLabel').textContent = appliedInFilter ? `Hide applied (${appliedInFilter})` : 'Hide applied';
  if (sourceMode === 'hidden') stat.textContent = rows.length ? `${rows.length} hidden` : '';
  else if (appliedInFilter) stat.textContent = `${rows.length} open · ${appliedInFilter} applied`;
  else stat.textContent = rows.length ? `${rows.length} internships` : '';

  if (pendingNewKeys.size && sourceMode !== 'hidden') {
    newBanner.textContent = `${pendingNewKeys.size} new — jump to top`;
    newBanner.classList.add('show');
  } else {
    newBanner.classList.remove('show');
  }
  empty.innerHTML = sourceMode === 'hidden'
    ? 'Nothing hidden.'
    : appliedInFilter
      ? `No open internships in this filter — ${appliedInFilter} already applied are hidden. Uncheck <b>Hide applied</b> to see them.`
      : JOBS.length
        ? 'No internships match these filters.<br/><br/>Widen the time window, season or location — or press Reset.'
        : 'Loading internships…';
  paintControls();
  if (!rows.length) {
    empty.style.display = 'block';
    grid.innerHTML = '';
    suppressScrollPreserve = false;
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = buildGridHtml(rows);
  restoreScrollAnchor(anchor, scrollY);
}

function fillSelect(el, values, { allLabel, current, labelOf = (v) => v }) {
  el.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>`
    + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(labelOf(v))}</option>`).join('');
  el.value = values.includes(current) || current === '' ? current : '';
}

const SEASON_ORDER = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
function fillDynamicOptions() {
  const seasons = [...new Set(JOBS.map((j) => j.season).filter(Boolean))].sort((a, b) => {
    const [sa, ya] = a.split(' ');
    const [sb, yb] = b.split(' ');
    return Number(ya) - Number(yb) || SEASON_ORDER[sa] - SEASON_ORDER[sb];
  });
  fillSelect($('seasonFilter'), [...seasons, '__none'], {
    allLabel: 'Any season', current: prefs.season, labelOf: (v) => (v === '__none' ? 'Season not listed' : v),
  });
  const sources = [...new Set(JOBS.flatMap((j) => j.sources || []))].sort();
  fillSelect($('sourceFilter'), sources, { allLabel: 'All sources', current: prefs.source });
  const boards = [...new Set(JOBS.map((j) => j.ats).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fillSelect($('atsFilter'), boards, { allLabel: 'All boards', current: prefs.ats });
}

// ── Actions ─────────────────────────────────────────────────────────

const findJob = (key) => JOBS.find((j) => j.key === key);

async function markViewed(job, card) {
  if (job.viewed) return;
  job.viewed = true;
  paintCard(card, job);
  try { await store.patch(job, { viewedAt: new Date().toISOString() }); } catch { showToast('Could not save'); }
}

async function toggleApplied(job, card) {
  const applied = !job.applied;
  const now = new Date().toISOString();
  try {
    await store.patch(job, applied ? { appliedAt: now, viewedAt: store.get(job.key).viewedAt || now } : { appliedAt: null });
  } catch {
    showToast('Could not save');
    return;
  }
  job.applied = applied;
  if (applied) job.viewed = true;
  showToast(applied ? 'Marked applied' : 'Unmarked applied');
  if (pendingHideTimers.has(job.key)) {
    clearTimeout(pendingHideTimers.get(job.key));
    pendingHideTimers.delete(job.key);
  }
  if (prefs.hideApplied && applied) {
    // Grace period: keep the card in place so a run of clicks doesn't reflow the grid.
    pendingHideKeys.add(job.key);
    paintCard(card, job);
    pendingHideTimers.set(job.key, setTimeout(() => {
      pendingHideKeys.delete(job.key);
      pendingHideTimers.delete(job.key);
      render();
    }, APPLIED_GRACE_MS));
  } else {
    pendingHideKeys.delete(job.key);
    paintCard(card, job);
    render();
  }
}

async function setHidden(job, hidden, reason) {
  try {
    await store.patch(job, hidden ? { hiddenAt: new Date().toISOString(), hideReason: reason } : { hiddenAt: null, hideReason: null });
  } catch {
    showToast('Could not save');
    return;
  }
  job.doubtful = hidden;
  job.hideReason = hidden ? reason : '';
  showToast(hidden ? 'Hidden' : 'Back in feed');
  render();
}

const HIDE_REASONS = {
  not_relevant: 'Not really an AI/ML or quant role',
  degree: 'Wrong degree level (PhD-only, etc.)',
  location: 'Wrong location',
  season: 'Wrong season / dates',
  company: 'Not interested in this company',
  closed: 'Closed or stale posting',
  eligibility: 'Citizenship / clearance / work authorization',
  duplicate: 'Duplicate of another card',
  other: 'Other',
};

function suggestHideReason(job) {
  if (job.degree === 'PhD') return 'degree';
  if (!isUsLocationClient(job.location, true)) return 'location';
  const postedMs = employerEpoch(job);
  if (Number.isFinite(postedMs) && Date.now() - postedMs > STALE_POSTED_DAYS * 86400000) return 'closed';
  if (/clearance|citizen|ts\/sci|polygraph/i.test(`${job.title} ${job.summary}`)) return 'eligibility';
  return 'not_relevant';
}

function closeHideDialog() {
  pendingHide = null;
  hideReasonModal.classList.remove('show');
  hideReasonModal.setAttribute('aria-hidden', 'true');
  $('hideReasonPicker').classList.remove('show');
  $('hideChange').textContent = 'Change reason';
}

function openHideDialog(job) {
  const reason = suggestHideReason(job);
  pendingHide = { job, suggestedReason: reason };
  $('hideDialogJob').textContent = `${job.title || 'Untitled'} · ${job.company || 'Unknown company'}`;
  $('hideSuggestionValue').textContent = HIDE_REASONS[reason];
  $('hideReasonSelect').innerHTML = Object.entries(HIDE_REASONS)
    .map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
  $('hideReasonSelect').value = reason;
  $('hideReasonPicker').classList.remove('show');
  hideReasonModal.classList.add('show');
  hideReasonModal.setAttribute('aria-hidden', 'false');
  $('hideConfirm').focus();
}

grid.addEventListener('click', async (e) => {
  if (e.target.closest('[data-expand-older]')) {
    olderExpanded = true;
    suppressScrollPreserve = true;
    render();
    return;
  }
  const card = e.target.closest('.card');
  if (!card) return;
  const job = findJob(card.dataset.key);
  if (!job) return;
  if (e.target.closest('.flag-btn')) {
    e.preventDefault();
    if (job.doubtful) await setHidden(job, false);
    else openHideDialog(job);
    return;
  }
  if (e.target.closest('.apply-btn')) {
    e.preventDefault();
    await toggleApplied(job, card);
    return;
  }
  if (e.target.closest('.people-btn')) {
    e.preventDefault();
    openPeople(job);
    return;
  }
  e.preventDefault();
  window.open(job.url, '_blank', 'noopener');
  await markViewed(job, card);
});

$('hideChange').addEventListener('click', () => {
  const picker = $('hideReasonPicker');
  const open = !picker.classList.contains('show');
  picker.classList.toggle('show', open);
  $('hideChange').textContent = open ? 'Use suggestion' : 'Change reason';
  if (!open && pendingHide) $('hideReasonSelect').value = pendingHide.suggestedReason;
  if (open) $('hideReasonSelect').focus();
});
$('hideCancel').addEventListener('click', closeHideDialog);
$('hideConfirm').addEventListener('click', async () => {
  if (!pendingHide) return;
  const { job, suggestedReason } = pendingHide;
  const reason = $('hideReasonPicker').classList.contains('show') ? $('hideReasonSelect').value : suggestedReason;
  closeHideDialog();
  await setHidden(job, true, reason);
});
hideReasonModal.addEventListener('click', (e) => { if (e.target === hideReasonModal) closeHideDialog(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && hideReasonModal.classList.contains('show')) closeHideDialog();
});

// ── People panel ────────────────────────────────────────────────────

const peopleModal = $('peopleModal');
const normCo = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(inc|llc|lp|ltd|corp|corporation|co|company|the|group|holdings|technologies|technology)\b/g, ' ').replace(/\s+/g, ' ').trim();
let peopleState = null; // { job, domain, configured, result, contacts }

function closePeople() {
  peopleState = null;
  peopleModal.classList.remove('show');
  peopleModal.setAttribute('aria-hidden', 'true');
}

/** Hiring-team contacts for this posting, plus ones from the company's other Handshake postings. */
function companyContacts(job) {
  const out = [];
  const seen = new Set();
  const add = (c, fromJob) => {
    const k = c.name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ...c, fromUrl: fromJob.url, fromTitle: fromJob.title, here: fromJob === job });
  };
  for (const c of job.contacts || []) add(c, job);
  const co = normCo(job.company);
  for (const j of JOBS) if (j !== job && j.contacts?.length && normCo(j.company) === co) for (const c of j.contacts) add(c, j);
  return out;
}

function copyBtn(text) {
  return `<button type="button" class="mini" data-copy="${escapeHtml(text)}">Copy</button>`;
}

function emailFor(name) {
  const st = peopleState;
  const pattern = st?.result?.pattern;
  const domain = st?.result?.domain || st?.domain;
  return pattern && domain ? emailFromPattern(pattern, name, domain) : '';
}

function renderPeople() {
  const st = peopleState;
  if (!st) return;
  const { job, configured, result, contacts } = st;
  const domain = result?.domain || st.domain;
  const parts = [];

  if (contacts.length) {
    parts.push('<h3>Hiring team on Handshake</h3><ul class="people-list">' + contacts.map((c) => {
      const email = emailFor(c.name);
      const find = result?.finds?.[c.name.toLowerCase()];
      return '<li><div class="who">'
        + `<b>${escapeHtml(c.name)}</b>${c.title ? ` · <span>${escapeHtml(c.title)}</span>` : ''}`
        + (c.here ? '' : `<div class="via">on “${escapeHtml(c.fromTitle)}”</div>`)
        + (find?.email ? `<div class="mail">${escapeHtml(find.email)}${find.verified ? ' ✓ verified' : ''} ${copyBtn(find.email)}</div>`
          : email ? `<div class="mail">${escapeHtml(email)} <span class="guess">likely, from ${escapeHtml(domain)}'s format</span> ${copyBtn(email)}</div>` : '')
        + '</div><div class="acts">'
        + `<a class="mini" href="${escapeHtml(c.fromUrl)}" target="_blank" rel="noopener">Message on Handshake</a>`
        + `<a class="mini" href="${escapeHtml(personLinks(c, job.company).linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`
        + (configured && !find ? `<button type="button" class="mini" data-find="${escapeHtml(c.name)}">Find exact email</button>` : '')
        + '</div></li>';
    }).join('') + '</ul>');
  }

  parts.push('<h3>Find people on LinkedIn</h3><ul class="people-links">' + outreachLinks(job).map((l) => (
    `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)} ↗</a><span>${escapeHtml(l.hint)}</span></li>`
  )).join('') + '</ul>');

  parts.push('<h3>Email</h3>');
  if (result) {
    parts.push(`<p class="people-note">${result.pattern
      ? `${escapeHtml(result.company || job.company)} emails look like <code>${escapeHtml(emailFromPattern(result.pattern, 'Jane Doe', result.domain))}</code> (<code>${escapeHtml(result.pattern)}@${escapeHtml(result.domain)}</code>).`
      : `Hunter didn't find an email format for ${escapeHtml(result.domain || job.company)}.`}</p>`);
    if (result.emails?.length) {
      parts.push('<ul class="people-list">' + result.emails.map((e) => '<li><div class="who">'
        + `<b>${escapeHtml(e.name || e.email)}</b>${e.position ? ` · <span>${escapeHtml(e.position)}</span>` : ''}`
        + `<div class="mail">${escapeHtml(e.email)}${e.verified ? ' ✓ verified' : ''} ${copyBtn(e.email)}</div></div>`
        + `<div class="acts">${e.linkedin ? `<a class="mini" href="${escapeHtml(e.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ''}</div></li>`).join('') + '</ul>');
    }
  } else if (configured) {
    parts.push(`<p class="people-note">Look up how ${escapeHtml(job.company)} formats emails, plus a few recruiting contacts — uses up to 3 of your 50 free monthly Hunter credits, then it's saved.</p>`
      + `<button type="button" class="mini primary" id="peopleLookup">Look up ${escapeHtml(domain || job.company)}</button>`);
  } else {
    parts.push('<p class="people-note">Add a free Hunter.io key to unlock real email formats and recruiter emails (see SETUP.md).</p>');
    if (domain) {
      parts.push(`<p class="people-note">Until then, the usual formats at <b>${escapeHtml(domain)}</b> (unverified): `
        + COMMON_PATTERNS.map((p) => `<code>${escapeHtml(emailFromPattern(p, 'Jane Doe', domain))}</code>`).join(' · ') + '</p>');
    }
  }
  const canGuess = Boolean(domain || configured);
  parts.push('<div class="people-name">'
    + `<input id="peopleName" type="text" placeholder="${canGuess ? "Type someone's full name (e.g. from LinkedIn) to get their email" : 'No company email domain known yet'}" autocomplete="off" ${canGuess ? '' : 'disabled'} />`
    + '<div id="peopleNameOut" class="mail"></div></div>');
  if (st.error) parts.push(`<p class="people-error">${escapeHtml(st.error)}</p>`);
  $('peopleBody').innerHTML = parts.join('');
}

/** Email domain for the company — this posting's, or any other posting from the same company. */
function companyDomain(job) {
  const own = guessDomain(job);
  if (own) return own;
  const co = normCo(job.company);
  for (const j of JOBS) {
    if (j !== job && normCo(j.company) === co) {
      const d = guessDomain(j);
      if (d) return d;
    }
  }
  return '';
}

async function openPeople(job) {
  peopleState = { job, domain: companyDomain(job), configured: false, result: null, contacts: companyContacts(job), error: '' };
  $('peopleJob').textContent = `${job.title} · ${job.company}`;
  peopleModal.classList.add('show');
  peopleModal.setAttribute('aria-hidden', 'false');
  renderPeople();
  try {
    const q = new URLSearchParams({ company: job.company, domain: peopleState.domain });
    const data = await (await fetch(`/api/people?${q}`)).json();
    if (peopleState?.job !== job) return;
    peopleState.configured = Boolean(data.configured);
    peopleState.result = data.result || null;
    renderPeople();
  } catch { /* links still work */ }
}

async function peopleCall(body) {
  const st = peopleState;
  const res = await fetch('/api/people', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ company: st.job.company, domain: st.result?.domain || st.domain, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

peopleModal.addEventListener('click', async (e) => {
  if (e.target === peopleModal || e.target.closest('#peopleClose')) { closePeople(); return; }
  const st = peopleState;
  if (!st) return;
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); showToast('Copied'); } catch { showToast(copy.dataset.copy); }
    return;
  }
  if (e.target.closest('#peopleLookup')) {
    e.target.disabled = true;
    e.target.textContent = 'Looking up…';
    try {
      st.result = (await peopleCall({ action: 'lookup' })).result;
      st.error = '';
    } catch (err) { st.error = err.message; }
    renderPeople();
    return;
  }
  const find = e.target.closest('[data-find]');
  if (find || e.target.closest('#peopleFindName')) {
    const name = find ? find.dataset.find : $('peopleName').value.trim();
    (find || e.target).disabled = true;
    try {
      const { find: f } = await peopleCall({ action: 'find', name });
      st.result = st.result || { company: st.job.company, domain: st.domain, pattern: '', emails: [], finds: {} };
      st.result.finds = { ...(st.result.finds || {}), [name.toLowerCase()]: f };
      st.error = f.email ? '' : `Hunter couldn't find an email for ${name}.`;
    } catch (err) { st.error = err.message; }
    renderPeople();
  }
});

peopleModal.addEventListener('input', (e) => {
  if (e.target.id !== 'peopleName') return;
  const name = e.target.value.trim();
  const out = $('peopleNameOut');
  const email = emailFor(name);
  const known = peopleState?.result?.finds?.[name.toLowerCase()];
  const domain = peopleState?.result?.domain || peopleState?.domain;
  // No verified format yet: show the usual formats, clearly marked as guesses.
  const guesses = !email && domain && /\S+\s+\S+/.test(name)
    ? COMMON_PATTERNS.map((p) => emailFromPattern(p, name, domain)).filter(Boolean)
    : [];
  out.innerHTML = known?.email
    ? `${escapeHtml(known.email)}${known.verified ? ' ✓ verified' : ''} ${copyBtn(known.email)}`
    : (email ? `${escapeHtml(email)} <span class="guess">likely</span> ${copyBtn(email)}` : '')
      + guesses.map((g) => `<div>${escapeHtml(g)} <span class="guess">unverified guess</span> ${copyBtn(g)}</div>`).join('')
      + (peopleState?.configured && /\S+\s+\S+/.test(name) ? ' <button type="button" class="mini" id="peopleFindName">Find exact email</button>' : '');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && peopleModal.classList.contains('show')) closePeople();
});

// ── Controls ────────────────────────────────────────────────────────

const SELECTS = { ageFilter: 'age', seasonFilter: 'season', degreeFilter: 'degree', geoFilter: 'geo', workFilter: 'work', sourceFilter: 'source', atsFilter: 'ats', sort: 'sort' };
const CHECKS = { hideApplied: 'hideApplied', hideOpened: 'hideOpened', hideCoop: 'hideCoop', hideReposts: 'hideReposts', officialOnly: 'officialOnly' };
const TEXTS = { companyFilter: 'company', locFilter: 'loc' };

function syncControls() {
  for (const [id, k] of Object.entries(SELECTS)) $(id).value = prefs[k];
  for (const [id, k] of Object.entries(CHECKS)) $(id).checked = Boolean(prefs[k]);
  for (const [id, k] of Object.entries(TEXTS)) $(id).value = prefs[k];
  $('filtersPanel').classList.toggle('open', Boolean(prefs.filtersOpen));
}

for (const [id, k] of Object.entries(SELECTS)) {
  $(id).addEventListener('change', (e) => { prefs[k] = e.target.value; savePrefs(); render(); });
}
for (const [id, k] of Object.entries(CHECKS)) {
  $(id).addEventListener('change', (e) => { prefs[k] = e.target.checked; savePrefs(); render(); });
}
for (const [id, k] of Object.entries(TEXTS)) {
  $(id).addEventListener('input', (e) => { prefs[k] = e.target.value; savePrefs(); render(); });
}
q.addEventListener('input', render);
$('moreToggle').addEventListener('click', () => {
  prefs.filtersOpen = !prefs.filtersOpen;
  savePrefs();
  $('filtersPanel').classList.toggle('open', prefs.filtersOpen);
});
$('clearFilters').addEventListener('click', () => {
  prefs = { ...DEFAULT_PREFS, track: prefs.track, filtersOpen: prefs.filtersOpen };
  q.value = '';
  savePrefs();
  syncControls();
  render();
});
$('hiddenToggle').addEventListener('click', () => {
  sourceMode = sourceMode === 'hidden' ? 'jobs' : 'hidden';
  render();
});
$('sourcesLink').addEventListener('click', () => {
  const panel = $('sourcesPanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) panel.scrollIntoView({ block: 'nearest' });
});
newBanner.addEventListener('click', () => {
  pendingNewKeys.clear();
  newBanner.classList.remove('show');
  suppressScrollPreserve = true;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function setTrack(track) {
  const next = ['ai', 'quant', 'all'].includes(track) ? track : 'ai';
  document.querySelectorAll('.track-tab').forEach((b) => b.classList.toggle('active', b.dataset.track === next));
  if (next === prefs.track && JOBS.length) return;
  prefs.track = next;
  savePrefs();
  // A different track is a fresh feed, not a burst of "new" jobs.
  knownKeys = new Set();
  pendingNewKeys.clear();
  lastJobsSignature = '';
  JOBS = [];
  render();
  refresh();
}
document.querySelectorAll('.track-tab').forEach((b) => b.addEventListener('click', () => setTrack(b.dataset.track)));

// ── Sources panel (scraper heartbeats) ───────────────────────────────

const SOURCES = [
  { key: 'lists', label: 'Curated lists', staleH: 6, count: (h) => h.newMatches },
  { key: 'quantSites', label: 'Jane Street · SIG · D. E. Shaw', staleH: 6, count: (h) => h.newMatches },
  { key: 'linkedin', label: 'LinkedIn', staleH: 6, count: (h) => h.total },
  { key: 'ghal', label: 'Greenhouse · Ashby · Lever', staleH: 2 },
  { key: 'workday', label: 'Workday', staleH: 3 },
  { key: 'tracked', label: 'Tracked boards', staleH: 3 },
  { key: 'seeds', label: 'YC + a16z', staleH: 12 },
  { key: 'jr', label: 'JobRight', staleH: 12, count: (h) => h.newMatches, login: true },
  { key: 'handshake', label: 'Handshake', staleH: 14, count: (h) => h.total ?? h.newMatches, login: true },
  { key: 'liveness', label: 'Closed-posting check', staleH: 12, count: (h) => h.totalClosed },
];

function fmtAgo(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function renderSources(hb) {
  const pills = [];
  const notes = [];
  for (const s of SOURCES) {
    const h = hb?.[s.key];
    if (!h) {
      pills.push(`<span class="src-pill off"><span class="dot"></span>${s.label} · not set up</span>`);
      continue;
    }
    const ageH = (Date.now() - Date.parse(h.at || '')) / 3600000;
    let cls = 'ok';
    let label = fmtAgo(h.at);
    const n = s.count ? s.count(h) : null;
    if (Number.isFinite(n)) label = `<b>${n}</b> · ${label}`;
    if (h.loginWall || h.cookieExpired) {
      cls = h.lastOkAt ? 'bad' : 'warn';
      label = 'sign-in needed';
      notes.push(h.lastOkAt
        ? `${s.label} session expired — <a href="/refresh.html">refresh the login</a>.`
        : `${s.label} isn't connected yet — see <a href="/refresh.html">how to sign in</a>.`);
    } else if (h.blocked) {
      cls = 'warn';
      label = `blocked · ${fmtAgo(h.at)}`;
      notes.push(`${s.label} is rate-limiting this runner (${escapeHtml(h.blocked)}). It retries next cycle.`);
    } else if (h.exitCode && h.exitCode !== 0) {
      cls = 'bad';
      label = `failed · ${fmtAgo(h.at)}`;
    } else if (!Number.isFinite(ageH) || ageH > s.staleH) {
      cls = 'warn';
    }
    pills.push(`<span class="src-pill ${cls}" title="${escapeHtml(JSON.stringify(h).slice(0, 400))}"><span class="dot"></span>${s.label} · ${label}</span>`);
  }
  $('sourcesGrid').innerHTML = pills.join('');
  $('sourcesNote').innerHTML = notes.join('<br/>')
    || 'Every source runs on its own GitHub Actions schedule. Hover a pill for its last-run details.';
  // Login sources that were never set up stay quiet here (the Sources panel
  // already says "sign-in needed"); the banner is for a session that was
  // working and just expired.
  const expired = SOURCES.filter((s) => s.login && hb?.[s.key]?.loginWall && hb[s.key].lastOkAt);
  staleBanner.innerHTML = expired.map((s) => `${s.label} session expired — <a href="/refresh.html">refresh the login</a>.`).join('<br/>');
  staleBanner.classList.toggle('show', expired.length > 0);
}

// ── Data ────────────────────────────────────────────────────────────

async function refresh() {
  const track = prefs.track;
  let next;
  try {
    const res = await fetch(`/api/jobs?track=${encodeURIComponent(track)}`);
    next = await res.json();
  } catch {
    showToast('Could not load internships');
    return;
  }
  if (track !== prefs.track) return; // tab switched mid-flight
  fetch('/api/heartbeat').then((r) => (r.ok ? r.json() : null)).then(renderSources).catch(() => {});
  const signature = JSON.stringify(next.map((j) => j.key + j.first_seen));
  if (signature === lastJobsSignature) return;
  lastJobsSignature = signature;
  const nextKeys = new Set(next.map((j) => j.key));
  if (knownKeys.size) {
    for (const j of next) {
      const s = store.get(j.key);
      if (!knownKeys.has(j.key) && !s.appliedAt && !s.hiddenAt) pendingNewKeys.add(j.key);
    }
  }
  knownKeys = nextKeys;
  JOBS = next.map(applyState);
  fillDynamicOptions();
  render();
}

// ── Auth (only when Supabase is configured) ─────────────────────────

async function setupSupabase(cfg) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
  const client = createClient(cfg.url, cfg.anonKey);
  store.client = client;
  document.body.classList.add('gated');
  $('authWrap').hidden = false;
  const signIn = () => client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: location.href } });
  $('gateSignInBtn').onclick = signIn;

  const onSession = async (session) => {
    const authArea = $('authArea');
    document.body.classList.toggle('signed-in', Boolean(session?.user));
    if (!session?.user) {
      store.mode = 'local';
      authArea.innerHTML = '<button type="button" class="linklike" id="signInLink">Sign in with GitHub</button>';
      $('signInLink').onclick = signIn;
      return;
    }
    const name = session.user.user_metadata?.user_name || session.user.email || 'signed in';
    authArea.innerHTML = `Signed in as <strong>${escapeHtml(name)}</strong> — <button type="button" class="linklike" id="signOutLink">Sign out</button>`;
    $('signOutLink').onclick = async () => { await client.auth.signOut(); location.reload(); };
    if (store.userId === session.user.id) return;
    store.mode = 'supabase';
    store.userId = session.user.id;
    try {
      await store.loadRemote();
    } catch (err) {
      showToast('Could not load your saved state');
      console.error(err);
    }
    JOBS = JOBS.map(applyState);
    render();
  };
  const { data: { session } } = await client.auth.getSession();
  await onSession(session);
  client.auth.onAuthStateChange((_event, s) => { onSession(s); });
}

async function boot() {
  store.loadLocal();
  syncControls();
  try {
    CONFIG = await (await fetch('/api/config')).json();
  } catch { /* defaults */ }
  $('refreshLinkWrap').hidden = !CONFIG.refreshLogin;
  if (CONFIG.gate) {
    $('authWrap').hidden = false;
    $('authArea').innerHTML = '<button type="button" class="linklike" id="signOutLink">Sign out</button>';
    $('signOutLink').onclick = async () => {
      await store.flush(true);
      await fetch('/api/logout', { method: 'POST' }).catch(() => {});
      location.replace('/login.html');
    };
  }
  if (CONFIG.supabase) {
    try { await setupSupabase(CONFIG.supabase); } catch (err) { console.error('Supabase setup failed', err); }
  } else if (CONFIG.sync) {
    store.mode = 'sync';
    try { await store.loadSync(); } catch (err) { console.error('sync load failed', err); }
  }
  document.querySelectorAll('.track-tab').forEach((b) => b.classList.toggle('active', b.dataset.track === prefs.track));
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      store.flush(true);
      return;
    }
    // Back on this tab: pick up marks made on another device, then refresh.
    if (store.mode === 'sync' && !store.pending.size) {
      try {
        await store.loadSync();
        JOBS = JOBS.map(applyState);
        render();
      } catch { /* keep local copy */ }
    }
    refresh();
  });
  window.addEventListener('pagehide', () => store.flush(true));
}

boot();
