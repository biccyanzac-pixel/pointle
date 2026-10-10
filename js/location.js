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
 * What to do when location is blocked. A page cannot make the browser show its prompt: the browser
 * decides. On iPhone it refuses without asking when location is off for the browser, or when it has
 * saved a "Deny" for this particular site (one earlier tap on "Don't Allow" is enough). If other sites
 * still get a prompt, it's the per-site setting.
 * `instant`: the refusal came back too fast for anyone to have seen a prompt.
 */
export function blockedHelp(instant = false) {
  if (inAppBrowser()) return 'This in-app browser blocks location. Open the page in Safari or Chrome instead (the ⋯ or share menu → Open in browser).';
  const b = browserName();
  const why = instant ? `${b} said no straight away without asking, so it has location switched off for this site. ` : '';
  if (isIOS() && b === 'Safari') {
    return `${why}Tap the "aA" (or the page menu) button at the left of the address bar → Website Settings → Location → "Ask" or "Allow", then reload and tap the button again. ` +
      'If that\u2019s already Ask, check Settings → Apps → Safari → Location, and Settings → Privacy & Security → Location Services → Safari Websites → "While Using the App".';
  }
  if (isIOS()) {
    return `${why}Check Settings → Privacy & Security → Location Services → ${b} → "While Using the App", and the site settings in ${b}\u2019s menu. Then reload and tap the button again.`;
  }
  return `${why}Tap the icon left of the address bar → Permissions (or Site settings) → Location → Allow, and check Location is on in your phone\u2019s quick settings. Then tap the button again.`;
}

/** Human help for a failed location request (GeolocationPositionError code). */
export function locationHelp(code, instant = false) {
  if (!window.isSecureContext) return 'Location only works on the https:// version of the site.';
  if (code === 1) return blockedHelp(instant);
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
  const started = performance.now();
  try {
    return await getPosition({ enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 15000 });
  } catch (e) {
    let err = e;
    if (err.code !== 1) {
      try { return await getPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 25000 }); } catch (e2) { err = e2; }
    }
    // a refusal within ~1 s means no prompt was ever shown: the browser had already decided
    const instant = err.code === 1 && performance.now() - started < 1000;
    const msg = err.code === 1 ? (instant ? 'Your browser blocked location without asking.' : 'Location was not allowed.') : 'Could not get your location.';
    throw Object.assign(new Error(msg), { code: err.code, instant, help: locationHelp(err.code, instant) });
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
