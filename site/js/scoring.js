// Scoring, miss descriptions, share text and share-link encoding. Pure functions.
// If scoreFor() changes, change the worker's copy of the check too (worker imports this file).

export const PERFECT_WITHIN = 5;   // degrees: about normal phone-compass error
export const ZERO_AT = 90;         // degrees: pointing at right angles scores nothing
export const TARGETS_PER_DAY = 5;
export const MAX_TOTAL = 100 * TARGETS_PER_DAY;

/** Points (0-100, whole numbers) for a 3D pointing error in degrees. */
export function scoreFor(errorDeg) {
  if (!(errorDeg >= 0)) return 0;
  if (errorDeg <= PERFECT_WITHIN) return 100;
  if (errorDeg >= ZERO_AT) return 0;
  return Math.round((100 * (ZERO_AT - errorDeg)) / (ZERO_AT - PERFECT_WITHIN));
}

export function totalScore(errors) {
  return errors.reduce((s, e) => s + scoreFor(e), 0);
}

/** e.g. "12° too far left, 8° too high". horizontal > 0 = too far right, vertical > 0 = too high. */
export function describeMiss(horizontal, vertical) {
  const parts = [];
  const h = Math.round(Math.abs(horizontal)), v = Math.round(Math.abs(vertical));
  if (h >= 1) parts.push(`${h}° too far ${horizontal > 0 ? 'right' : 'left'}`);
  if (v >= 1) parts.push(`${v}° too ${vertical > 0 ? 'high' : 'low'}`);
  return parts.length ? parts.join(', ') : 'Spot on!';
}

export function emojiFor(errorDeg) {
  if (errorDeg <= PERFECT_WITHIN) return '🎯';
  if (errorDeg <= 15) return '🟢';
  if (errorDeg <= 35) return '🟡';
  if (errorDeg <= 60) return '🟠';
  return '🔴';
}

/** Share text. results: [{ name, error }]. Contains no location data. */
export function shareText(puzzleNumber, results, url, modeLabel = '') {
  const total = totalScore(results.map((r) => r.error));
  const line = results.map((r) => `${r.name} ${Math.round(r.error)}°`).join(' · ');
  const grid = results.map((r) => emojiFor(r.error)).join('');
  return `Pointle #${puzzleNumber}${modeLabel ? ` (${modeLabel})` : ''} ${grid}\n🎯 ${line} — ${total}/${MAX_TOTAL}\n${url}`;
}

// --- share links: ?r=<yyyymmdd>.<mode>.<errors in tenths of a degree, base 36> ---
// Only the day, the mode and the five errors. Never a position, a town or a direction.
const MODES = ['sensor', 'map', 'fixed-sensor', 'fixed-map'];

export function encodeResult({ day, mode, errors }) {
  const m = Math.max(0, MODES.indexOf(mode));
  return [day.replaceAll('-', ''), m, ...errors.map((e) => Math.round(Math.min(180, Math.max(0, e)) * 10).toString(36))].join('.');
}

export function decodeResult(code) {
  if (typeof code !== 'string' || !/^\d{8}\.\d(\.[0-9a-z]{1,3}){1,10}$/.test(code)) return null;
  const [d, m, ...rest] = code.split('.');
  const errors = rest.map((x) => parseInt(x, 36) / 10);
  if (errors.some((e) => !(e >= 0 && e <= 180)) || !MODES[+m]) return null;
  return { day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, mode: MODES[+m], errors };
}
