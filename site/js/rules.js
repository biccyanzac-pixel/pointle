// Rules for a day's targets, and the seeded generator that satisfies them.
// Used by tools/make_schedule.mjs (to pre-build the schedule), the tests, and the site as a fallback for
// days past the end of the pre-built schedule.
import { centralAngle, DEG, MEAN_RADIUS_KM } from './geo.js';
import { addDays, hashString, mulberry32, weekday } from './daily.js';
import { TARGETS_PER_DAY } from './scoring.js';

/** A typical UK/European player, used to make sure each day mixes near and far targets. */
export const REFERENCE_PLAYER = { lat: 51.5074, lon: -0.1278, name: 'London' };
export const NO_REPEAT_DAYS = 60;
export const MIN_SEPARATION_KM = 500;        // between a day's targets (no Paris + Eiffel Tower)
export const MIN_ORIGIN_DISTANCE_KM = 1000;  // fixed-location origin to each target
export const NEAR_KM = 2500;
export const FAR_KM = 9000;

// Difficulty tiers per weekday (0 = Sunday). Monday: famous capitals; rising to Saturday: smaller cities
// and landmarks. Sunday is a wildcard mix of every tier.
export const WEEKDAY_TIERS = {
  1: [1, 1, 1],
  2: [1, 2, 2],
  3: [2, 2, 3],
  4: [2, 3, 4],
  5: [3, 4, 4],
  6: [4, 5, 5],
  0: [1, 3, 5],
};
export const WEEKDAY_NAMES = ['Sunday mix', 'Famous capitals', 'Capitals and big cities', 'Big cities', 'Cities and sights',
  'Cities and sights', 'Smaller cities and landmarks'];

export const kmBetween = (a, b) => centralAngle(a, b) * DEG * MEAN_RADIUS_KM;

/** Below-horizon angle of the line from the reference player, in bands of 15 degrees. */
const dipBand = (t) => Math.min(5, Math.floor(centralAngle(REFERENCE_PLAYER, t) / 2 / 15));

/**
 * Problems with a day's entry (empty array = valid).
 * entry: { targets: [ids], reserve: id, origin: id }; byId: Map id -> target.
 */
export function checkDay(day, entry, byId) {
  const problems = [];
  const ts = entry.targets.map((id) => byId.get(id));
  if (ts.length !== TARGETS_PER_DAY || ts.some((t) => !t)) return [`needs ${TARGETS_PER_DAY} known targets`];
  const reserve = byId.get(entry.reserve), origin = byId.get(entry.origin);
  if (!reserve) problems.push('unknown reserve');
  if (!origin || origin.k !== 'city' || origin.t > 3) problems.push('origin must be a well-known city');
  const all = reserve ? [...ts, reserve] : ts;
  if (new Set(all.map((t) => t.id)).size !== all.length) problems.push('duplicate target');
  if (new Set(ts.map((t) => t.ct)).size < 3) problems.push('fewer than 3 continents');
  const dists = ts.map((t) => kmBetween(REFERENCE_PLAYER, t));
  if (!dists.some((d) => d < NEAR_KM)) problems.push('no near target');
  if (!dists.some((d) => d > FAR_KM)) problems.push('no far target');
  if (new Set(ts.map(dipBand)).size < 3) problems.push('downward angles too similar');
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (kmBetween(all[i], all[j]) < MIN_SEPARATION_KM) problems.push(`${all[i].n} and ${all[j].n} too close`);
  }
  if (origin) for (const t of all) {
    if (t.id === origin.id || kmBetween(origin, t) < MIN_ORIGIN_DISTANCE_KM) problems.push(`origin too close to ${t.n}`);
  }
  const tiers = WEEKDAY_TIERS[weekday(day)];
  const want = [...tiers].sort(), got = ts.map((t) => t.t).sort();
  if (want.join() !== got.join()) problems.push(`tiers ${got} should be ${want}`);
  if (reserve && reserve.t !== Math.max(...tiers)) problems.push('reserve tier');
  const nonCity = ts.filter((t) => t.k !== 'city').length;
  if (weekday(day) === 6 ? nonCity < 1 : nonCity > 1) problems.push(`${nonCity} landmarks`);
  return problems;
}

/**
 * Pick one day's entry. `recent` is a Set of target ids used in the last NO_REPEAT_DAYS days and
 * `recentOrigins` likewise for origins; both may be empty (fallback mode).
 */
export function generateDay(day, targets, recent = new Set(), recentOrigins = new Set(), maxTries = 20000) {
  const rng = mulberry32(hashString(`pointle:${day}`));
  const byId = new Map(targets.map((t) => [t.id, t]));
  const tiers = WEEKDAY_TIERS[weekday(day)];
  const pools = {};
  for (let k = 1; k <= 5; k++) pools[k] = targets.filter((t) => t.t === k && !recent.has(t.id));
  const origins = targets.filter((t) => t.k === 'city' && t.t <= 2 && !recentOrigins.has(t.id));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const sat = weekday(day) === 6;
  for (let i = 0; i < maxTries; i++) {
    const chosen = [];
    for (const k of tiers) {
      // Saturdays include a landmark: the first pick comes from the non-city part of the pool when possible
      let pool = pools[k];
      if (sat && chosen.length < 1) {
        const lm = pools[k].filter((t) => t.k !== 'city');
        if (lm.length) pool = lm;
      }
      chosen.push(pick(pool));
    }
    const reserve = pick(pools[Math.max(...tiers)]);
    const origin = pick(origins);
    const entry = { targets: chosen.map((t) => t.id), reserve: reserve.id, origin: origin.id };
    if (!checkDay(day, entry, byId).length) {
      // shuffle the order so the tier isn't given away by position
      for (let a = entry.targets.length - 1; a > 0; a--) {
        const b = Math.floor(rng() * (a + 1));
        [entry.targets[a], entry.targets[b]] = [entry.targets[b], entry.targets[a]];
      }
      return entry;
    }
  }
  throw new Error(`no valid targets for ${day}`);
}

/** Build a schedule of `count` days starting at `start`, enforcing no repeats within NO_REPEAT_DAYS. */
export function buildSchedule(start, count, targets) {
  const days = [];
  for (let i = 0; i < count; i++) {
    const day = addDays(start, i);
    const recent = new Set(), recentOrigins = new Set();
    for (const d of days.slice(Math.max(0, i - (NO_REPEAT_DAYS - 1)))) {
      d.slice(0, -1).forEach((id) => recent.add(id));
      recentOrigins.add(d.at(-1));
    }
    const e = generateDay(day, targets, recent, recentOrigins);
    days.push([...e.targets, e.reserve, e.origin]);
  }
  return { start, days };
}

// --- per-player adjustments ---

/** Targets closer than this to the player can't be pointed at meaningfully (city-level location accuracy). */
export const MIN_PLAYABLE_KM = 300;

/**
 * The five targets this player actually plays: any target within MIN_PLAYABLE_KM of their origin is swapped
 * for the day's reserve (at most one swap; the schedule keeps targets 500 km apart, so two can't both be
 * that close to one player).
 */
export function playableTargets(entry, origin, byId) {
  const ids = [...entry.targets];
  const reserve = byId.get(entry.reserve);
  const i = ids.findIndex((id) => kmBetween(origin, byId.get(id)) < MIN_PLAYABLE_KM);
  if (i >= 0 && reserve && kmBetween(origin, reserve) >= MIN_PLAYABLE_KM) ids[i] = reserve.id;
  return ids;
}

/** Practice targets keep at least this far from every one of today's targets. */
export const PRACTICE_EXCLUSION_KM = 1500;

/**
 * A random practice target that is NOT one of today's (targets or reserve), nor anywhere near them, so
 * practising before playing can never be used to line up on today's answers.
 */
export function practiceTargetPool(entry, targets, byId) {
  const today = [...entry.targets, entry.reserve].map((id) => byId.get(id)).filter(Boolean);
  return targets.filter((t) => t.t <= 3 && !today.some((d) => d.id === t.id || kmBetween(d, t) < PRACTICE_EXCLUSION_KM));
}

export function pickPracticeTarget(entry, targets, byId, rng = Math.random, origin = null) {
  let pool = practiceTargetPool(entry, targets, byId);
  if (origin) pool = pool.filter((t) => kmBetween(origin, t) >= MIN_PLAYABLE_KM);
  return pool[Math.floor(rng() * pool.length)];
}
