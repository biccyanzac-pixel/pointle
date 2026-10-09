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

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|Snapchat|; wv\)|GSA\//.test(navigator.userAgent);

/** Human help for a failed location request. */
export function locationHelp(code) {
  if (!window.isSecureContext) return 'Location only works on the https:// version of the site.';
  if (code === 1) {
    if (inAppBrowser()) return 'This in-app browser blocks location. Open the page in Safari or Chrome instead (⋯ → Open in browser).';
    return isIOS()
      ? 'Location is blocked for this site. On iPhone: Settings → Privacy & Security → Location Services → turn it on, and set "Safari Websites" to "While Using the App". Then reload and try again.'
      : "Location is blocked for this site. In Chrome: tap the icon left of the address bar → Permissions → Location → Allow, and check your phone's Location setting is on. Then try again.";
  }
  if (code === 3) return 'Getting your location took too long. Try again outdoors or with Wi-Fi on.';
  return "Your phone couldn't work out where you are. Check Location is switched on in your phone's settings.";
}

/**
 * Ask the browser for the position (city-level accuracy is plenty). Tries a quick low-accuracy fix first
 * and, if that fails for a reason other than "denied", once more with GPS. Resolves to { lat, lon }.
 * Rejects with an Error whose `help` says what to do.
 */
export async function requestPosition() {
  if (!navigator.geolocation) throw Object.assign(new Error('Location is not available in this browser.'), { help: 'Pick your town instead.' });
  try {
    return await getPosition({ enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 12000 });
  } catch (e) {
    if (e.code !== 1) {
      try { return await getPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 25000 }); } catch (e2) { e = e2; }
    }
    const msg = e.code === 1 ? 'Location permission was declined.' : 'Could not get your location.';
    throw Object.assign(new Error(msg), { code: e.code, help: locationHelp(e.code) });
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

/** The nearest town in the list (computed on the device), to suggest as the optional leaderboard town. */
export async function nearestTown(pos) {
  const { towns } = await loadTowns();
  let best = null, bestD = Infinity;
  for (const t of towns) {
    if (Math.abs(t[3] - pos.lat) > 2) continue;
    const d = centralAngle(pos, { lat: t[3], lon: t[4] });
    if (d < bestD) { bestD = d; best = t; }
  }
  return best ? best[0] : null;
}
