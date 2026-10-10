// Where the player is. Everything stays in memory on this device: coordinates are never stored, logged
// or sent anywhere. The town list is a static file searched locally (no geocoding service).
import { centralAngle } from './geo.js';

let townData = null;

export async function loadTowns() {
  if (!townData) {
    const res = await fetch(new URL('../data/towns.json', import.meta.url));
    townData = await res.json();
  }
  return townData;
}

function getPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject, options);
  });
}

const UA = () => navigator.userAgent;
const isIOS = () => /iP(hone|ad|od)/.test(UA()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|Snapchat|; wv\)|GSA\//.test(UA());

/** Which browser, for settings instructions. */
export function browserName() {
  if (/CriOS/.test(UA())) return 'Chrome';
  if (/FxiOS|Firefox/.test(UA())) return 'Firefox';
  if (/EdgiOS|EdgA|Edg\//.test(UA())) return 'Edge';
  if (/SamsungBrowser/.test(UA())) return 'Samsung Internet';
  if (isIOS()) return 'Safari';
  return 'Chrome';
}

/**
 * What to do when location is blocked. On iPhone the browser never shows a prompt if location is off for
 * it in Settings: it just refuses straight away, so spell out exactly where the switches are.
 */
export function blockedHelp() {
  if (inAppBrowser()) return 'This in-app browser blocks location. Open the page in Safari or Chrome instead (the ⋯ or share menu → Open in browser).';
  const b = browserName();
  if (isIOS()) {
    const app = b === 'Safari'
      ? 'Settings → Privacy & Security → Location Services → Safari Websites → "While Using the App". Also check Settings → Apps → Safari → Location is "Ask" or "Allow".'
      : `Settings → Privacy & Security → Location Services → ${b} → "While Using the App".`;
    return `Your iPhone is blocking location for ${b}, so no prompt appears. Make sure Location Services is on, then ${app} Then reload this page and tap the button again.`;
  }
  return `${b} is blocking location for this site. Tap the icon left of the address bar → Permissions (or Site settings) → Location → Allow. Also check Location is switched on in your phone's quick settings. Then tap the button again.`;
}

/** Human help for a failed location request (GeolocationPositionError code). */
export function locationHelp(code) {
  if (!window.isSecureContext) return 'Location only works on the https:// version of the site.';
  if (code === 1) return blockedHelp();
  if (code === 3) return 'Getting your location took too long. Try again with Wi-Fi on, or pick your town.';
  return "Your phone couldn't work out where you are. Check Location is switched on in your phone's settings.";
}

/** 'granted' | 'prompt' | 'denied' | 'unknown' (the Permissions API isn't available everywhere). */
export async function locationPermission() {
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' });
    return st?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Ask the browser for the position (city-level accuracy is plenty). Tries a quick low-accuracy fix first
 * and, if that fails for a reason other than "denied", once more with GPS. Resolves to { lat, lon }.
 * Rejects with an Error whose `help` says what to do. Must be called straight from a tap.
 */
export async function requestPosition() {
  if (!navigator.geolocation) throw Object.assign(new Error('Location is not available in this browser.'), { help: 'Pick your town instead.' });
  try {
    return await getPosition({ enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 15000 });
  } catch (e) {
    let err = e;
    if (err.code !== 1) {
      try { return await getPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 25000 }); } catch (e2) { err = e2; }
    }
    const msg = err.code === 1 ? 'Location is blocked.' : 'Could not get your location.';
    throw Object.assign(new Error(msg), { code: err.code, help: locationHelp(err.code) });
  }
}

const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** Search towns by name prefix (then substring); results are { name, region, country, lat, lon }. */
export async function searchTowns(query, limit = 12) {
  const { towns, countries } = await loadTowns();
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const starts = [], contains = [];
  for (const t of towns) {
    const n = fold(t[0]);
    if (n.startsWith(q)) starts.push(t);
    else if (contains.length < limit && n.includes(q)) contains.push(t);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit).map((t) => ({ name: t[0], region: t[1], country: countries[t[2]] ?? t[2], lat: t[3], lon: t[4] }));
}

/** The nearest town in the list (computed on the device), shown on the leaderboard: { name, country }. */
export async function nearestTown(pos) {
  const { towns, countries } = await loadTowns();
  let best = null, bestD = Infinity;
  for (const t of towns) {
    if (Math.abs(t[3] - pos.lat) > 2) continue;
    const d = centralAngle(pos, { lat: t[3], lon: t[4] });
    if (d < bestD) { bestD = d; best = t; }
  }
  return best ? { name: best[0], country: countries[best[2]] ?? best[2] } : null;
}
