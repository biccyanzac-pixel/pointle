// Which targets (and which fixed origin) belong to a day. The day is the UTC date, so everyone in the
// world plays the same five targets and the puzzle changes at 00:00 UTC.
// Shared by the site, the schedule generator, the tests and the leaderboard worker.

export const EPOCH = '2026-10-09'; // puzzle #1. Don't change once live: it renumbers every puzzle.

export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function isValidDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(t) && dayKey(new Date(t)) === day;
}

export function addDays(day, n) {
  return dayKey(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000));
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function puzzleNumber(day) {
  return daysBetween(EPOCH, day) + 1;
}

/** 0 = Sunday ... 6 = Saturday, of the UTC day. */
export function weekday(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Monday of the day's ISO week (weekly leaderboards run Monday to Sunday, UTC). */
export function weekStart(day) {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** Yesterday's board stays open this long after midnight UTC, for players who started before it. */
export const GRACE_MS = 2 * 3600 * 1000;

/**
 * Does a submission for `day` go on the archive's late board? Today: no. Yesterday within the grace period
 * (and not deliberately replayed from the archive): no. Anything older: yes.
 */
export function isLate(day, archive, now = new Date()) {
  const today = dayKey(now);
  if (day === today) return false;
  const grace = day === addDays(today, -1) && now - Date.parse(`${today}T00:00:00Z`) < GRACE_MS;
  return !(grace && !archive);
}

export function msUntilNextUtcDay(now = new Date()) {
  return Date.parse(`${addDays(dayKey(now), 1)}T00:00:00Z`) - now.getTime();
}

// --- seeded randomness ---
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The day's entry: { targets: [ids], reserve: id, origin: id }. Schedule rows are [...targets, reserve, origin].
 * `reserve` replaces any target that is too close to the player to point at (see game.js).
 * Days past the end of the pre-built schedule fall back to `fallback(day)` (seeded generator).
 */
export function entryFor(day, schedule, fallback) {
  const i = daysBetween(schedule.start, day);
  if (i >= 0 && i < schedule.days.length) {
    const row = schedule.days[i];
    return { targets: row.slice(0, -2), reserve: row.at(-2), origin: row.at(-1) };
  }
  return fallback ? fallback(day) : null;
}
