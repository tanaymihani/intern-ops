/**
 * feed-io.mjs — shared plumbing for the snapshot feeds (lists, LinkedIn,
 * Handshake…): stable job keys, first-seen preservation across runs, and
 * atomic writes of the feed + heartbeat files the dashboard reads.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { canonicalGhalKey } from './ghal-job-key.mjs';

/** Canonical identity for a posting URL (ATS-aware, tracking params stripped). */
export function jobKey(url) {
  const canonical = canonicalGhalKey(url);
  if (canonical) return canonical;
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|src$|gh_src$|lever-source|trk|refid|trackingid)/i.test(p)) u.searchParams.delete(p);
    }
    u.hash = '';
    return (u.host.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + (u.search || '')).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write via tmp + rename so a reader (or a killed run) never sees half a file. */
export function writeJsonAtomic(path, value, { pretty = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, pretty ? 2 : 0));
  renameSync(tmp, path);
}

/**
 * Write a feed so consecutive commits diff well: header fields first, then
 * one job per line in a stable order. Feeds are committed to git every few
 * minutes, and a reshuffled or re-indented file would store a full copy each
 * time instead of a few changed lines.
 */
export function writeFeedFile(path, header, jobs, { keyOf = (j) => jobKey(j.url) } = {}) {
  const sorted = [...jobs].sort((a, b) => String(keyOf(a)).localeCompare(String(keyOf(b))));
  const head = JSON.stringify({ ...header, count: sorted.length }).slice(0, -1);
  const body = sorted.map((j) => JSON.stringify(j)).join(',\n');
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${head},"jobs":[\n${body}\n]}\n`);
  renameSync(tmp, path);
}

/**
 * Complete-snapshot merge: the new scrape IS the current set of open
 * postings (closed ones drop out), but each job keeps the discoveredAt it
 * had the first time we saw it, so "found today" stays honest.
 *
 * Jobs from a source's very first run are flagged `bootstrap`: they were
 * all "found" in the same minute, so the dashboard dates them by the
 * employer's posting date instead of burying everything under "Today".
 */
export function mergeSnapshot(previousJobs, incoming, { keyOf = (j) => jobKey(j.url), now = new Date().toISOString() } = {}) {
  const prevList = Array.isArray(previousJobs) ? previousJobs : [];
  const firstRun = prevList.length === 0;
  const prevByKey = new Map();
  for (const j of prevList) {
    const k = keyOf(j);
    if (k && j.discoveredAt) prevByKey.set(k, j);
  }
  const out = new Map();
  for (const j of incoming) {
    const k = keyOf(j);
    if (!k || out.has(k)) continue;
    const prev = prevByKey.get(k);
    const bootstrap = prev ? Boolean(prev.bootstrap) : firstRun;
    out.set(k, { ...j, discoveredAt: prev?.discoveredAt || now, ...(bootstrap ? { bootstrap: true } : {}) });
  }
  return [...out.values()];
}

/**
 * Rolling merge for partial scrapes (LinkedIn returns only the newest N per
 * query): keep previously seen jobs for `keepDays` after they were last seen,
 * so one thin run doesn't wipe the feed.
 */
export function mergeRolling(previousJobs, incoming, { keyOf = (j) => jobKey(j.url), now = new Date().toISOString(), keepDays = 21 } = {}) {
  const nowMs = Date.parse(now);
  const cutoff = nowMs - keepDays * 86400000;
  const firstRun = !(Array.isArray(previousJobs) && previousJobs.length);
  const byKey = new Map();
  for (const j of Array.isArray(previousJobs) ? previousJobs : []) {
    const k = keyOf(j);
    if (!k) continue;
    const seenMs = Date.parse(j.lastSeenAt || j.discoveredAt || '');
    if (Number.isFinite(seenMs) && seenMs >= cutoff) byKey.set(k, j);
  }
  for (const j of incoming) {
    const k = keyOf(j);
    if (!k) continue;
    const prev = byKey.get(k);
    const bootstrap = prev ? Boolean(prev.bootstrap) : firstRun;
    byKey.set(k, { ...(prev || {}), ...j, discoveredAt: prev?.discoveredAt || now, lastSeenAt: now, ...(bootstrap ? { bootstrap: true } : {}) });
  }
  return [...byKey.values()];
}

/** "YYYY-MM-DD" for "Oct 15" (no year) — assumes the most recent such date. */
export function parseMonthDay(text, now = new Date()) {
  const m = String(text || '').trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/);
  if (!m) return null;
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    .indexOf(m[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  let d = new Date(Date.UTC(now.getUTCFullYear(), month, Number(m[2]), 12));
  if (d.getTime() > now.getTime() + 2 * 86400000) d = new Date(Date.UTC(now.getUTCFullYear() - 1, month, Number(m[2]), 12));
  return d.toISOString().slice(0, 10);
}

/** Epoch ms for relative ages like "1d", "3h", "2w", "1mo". */
export function parseRelativeAge(text, now = Date.now()) {
  const m = String(text || '').trim().toLowerCase().match(/^(\d+)\s*(m|min|h|hr|d|w|mo)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { m: 60e3, min: 60e3, h: 3600e3, hr: 3600e3, d: 86400e3, w: 7 * 86400e3, mo: 30 * 86400e3 }[m[2]];
  return now - n * unit;
}

/** Strip markdown/HTML from a table cell, decode the few entities lists use. */
export function cellText(cell) {
  return String(cell || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__/g, '')
    // Link text may itself contain one level of brackets: [Intern [Winter 2027]](url)
    .replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\([^)]*\)/g, '$1')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All hrefs in a cell, in order — markdown links and HTML anchors. */
export function cellLinks(cell) {
  const out = [];
  const s = String(cell || '');
  for (const m of s.matchAll(/\]\((https?:\/\/[^)\s]+)\)|href="(https?:\/\/[^"]+)"/g)) out.push(m[1] || m[2]);
  return out;
}

/** Split a markdown table row into cells ("| a | b |" → ["a", "b"]). */
export function splitRow(line) {
  const t = String(line || '').trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}
