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

/** Ask the browser for the position (city-level accuracy is plenty). Resolves to { lat, lon } or throws. */
export function requestPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Location is not available in this browser.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was declined.' : 'Could not get your location.')),
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 20000 },
    );
  });
}

const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

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
