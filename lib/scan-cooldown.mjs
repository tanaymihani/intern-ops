// lib/scan-cooldown.mjs — skip chronically-dead boards instead of re-paying
// their full COMPANY_TIMEOUT_MS every single sweep.
//
// Why this exists: Workday's reverse scan was re-attempting its full ~13-16k
// tenant list every run, and roughly HALF of them ("~7,200-7,700 unreachable
// boards skipped") are dead on literally every sweep — same defunct tenants,
// over and over, each one capable of riding out the full 5-minute per-company
// timeout before giving up. That's what turned routine hourly sweeps into
// multi-hour (occasionally ~9.6-hour) runs. A company that failed recently is
// overwhelmingly likely to still be dead a few hours later, so skip it
// immediately on sight instead of re-paying the timeout — and back off
// harder (longer cooldown) the more consecutive times it fails, while still
// periodically re-trying so a board that comes back isn't lost forever.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Exponential backoff by consecutive-failure count. A board seen failing
// once might just be a transient blip (don't over-punish); by the 4th+
// consecutive failure it's almost certainly gone for good, so the cooldown
// caps at a week rather than growing forever (still occasionally re-checked
// in case it ever comes back, e.g. the company re-platforms onto the same
// tenant slug).
const COOLDOWN_MS_BY_STREAK = [
  0,                    // 0 prior failures — never in cooldown
  6 * 60 * 60_000,      // 1st failure  — 6h
  24 * 60 * 60_000,     // 2nd failure  — 1 day
  3 * 24 * 60 * 60_000, // 3rd failure  — 3 days
  7 * 24 * 60 * 60_000, // 4th+ failure — 1 week (cap)
];

function cooldownMsFor(streak) {
  const idx = Math.min(streak, COOLDOWN_MS_BY_STREAK.length - 1);
  return COOLDOWN_MS_BY_STREAK[idx];
}

/**
 * @param {string} path
 * @returns {Map<string, {streak: number, lastFailAt: number}>}
 */
export function loadCooldown(path) {
  if (!existsSync(path)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object') return new Map();
    return new Map(Object.entries(raw));
  } catch {
    // Corrupt/partial file (e.g. killed mid-write) — safer to start clean
    // than to let a parse error take down the whole scan.
    return new Map();
  }
}

export function saveCooldown(path, map) {
  mkdirSync(dirname(path), { recursive: true });
  const obj = Object.fromEntries(map.entries());
  writeFileSync(path, JSON.stringify(obj));
}

/** @returns {boolean} true if this key should be skipped right now. */
export function isInCooldown(key, map, now = Date.now()) {
  const rec = map.get(key);
  if (!rec || !rec.streak) return false;
  return now - rec.lastFailAt < cooldownMsFor(rec.streak);
}

/** Record a failure — bumps the streak and starts a new cooldown window. */
export function recordFailure(key, map, now = Date.now()) {
  const prev = map.get(key);
  map.set(key, { streak: (prev?.streak ?? 0) + 1, lastFailAt: now });
}

/** Record a success — clears any cooldown so a recovered board scans normally again. */
export function recordSuccess(key, map) {
  if (map.has(key)) map.delete(key);
}
