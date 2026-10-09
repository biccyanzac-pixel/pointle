// Build the target list and the town list from GeoNames (CC BY 4.0) and Wikidata (CC0).
//
//   node tools/fetch_wikidata.mjs <geonames-dir>     (once: fame data)
//   node tools/build_targets.mjs <geonames-dir>
//
// <geonames-dir> must contain cities15000.txt, countryInfo.txt, admin1CodesASCII.txt from
// https://download.geonames.org/export/dump/ plus city_fame.json and landmarks_raw.json.
// Writes site/data/targets.json and site/data/towns.json.
//
// Target ids are stable ("c<geonamesId>", "w<QID>", "x<slug>"). The schedule refers to targets by id,
// so never renumber them; adding new targets is fine.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { centralAngle, MEAN_RADIUS_KM, DEG } from '../site/js/geo.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build_targets.mjs <geonames-dir>'); process.exit(1); }
const read = (f) => readFileSync(join(dir, f), 'utf8');
const km = (a, b) => centralAngle(a, b) * DEG * MEAN_RADIUS_KM;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// --- countries ---
const countries = {};
for (const line of read('countryInfo.txt').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const f = line.split('\t');
  countries[f[0]] = { name: f[4], cont: f[8] };
}
const SHORT_COUNTRY = { 'United States': 'USA', 'United Kingdom': 'UK', 'Democratic Republic of the Congo': 'DR Congo',
  'Republic of the Congo': 'Congo', 'Bosnia and Herzegovina': 'Bosnia', 'United Arab Emirates': 'UAE' };
const countryName = (cc) => SHORT_COUNTRY[countries[cc]?.name] ?? countries[cc]?.name ?? '';

const admin1 = {};
for (const line of read('admin1CodesASCII.txt').split('\n')) {
  const f = line.split('\t');
  if (f.length > 1) admin1[f[0]] = f[1];
}

// --- cities ---
const fame = JSON.parse(read('city_fame.json'));
const rows = read('cities15000.txt').split('\n').filter(Boolean).map((l) => l.split('\t'));
const cities = rows.map((c) => ({
  gid: c[0], name: c[1], lat: +c[4], lon: +c[5], code: c[7], cc: c[8], a1: c[10], pop: +c[14],
  sl: fame[c[0]]?.[0] ?? 0, en: fame[c[0]]?.[1] ?? null,
}));

// English label from Wikidata when it looks like a plain place name (not "Foo District", not a Q-id)
function cityName(c) {
  const en = c.en;
  if (en && !/^Q\d+$/.test(en) && !/\b(District|Prefecture|Municipality|Province|Region|County|Oblast|Governorate|Department)\b/i.test(en)
      && en.length <= 32) return en.replace(/, .*$/, '');
  return c.name;
}

const MIN_CITY_LINKS = 45;
const targets = [];
const famous = cities.filter((c) => c.sl >= MIN_CITY_LINKS).sort((a, b) => b.sl - a.sl);
const CITY_SKIP = new Set(['Fuji', 'The Bronx', 'Brooklyn', 'Queens', 'Manhattan', 'Staten Island']); // boroughs, not cities
const CITY_RENAME = { 'Heroica Puebla de Zaragoza': 'Puebla', 'Acapulco de Juárez': 'Acapulco', 'Toluca de Lerdo': 'Toluca',
  Cirta: 'Constantine' };
for (const c of famous) {
  const name = CITY_RENAME[cityName(c)] ?? cityName(c);
  if (CITY_SKIP.has(name)) continue;
  // skip near-duplicates (a district or twin entry of a city we already have)
  if (targets.some((t) => (t.n === name || km(t, c) < 15))) continue;
  targets.push({
    id: `c${c.gid}`, n: name, cc: c.cc, c: countryName(c.cc), ct: countries[c.cc]?.cont ?? '', k: 'city',
    // fame: sitelinks, damped for small towns (bots write articles about every town in some languages)
    lat: r4(c.lat), lon: r4(c.lon), f: Math.round(c.sl * Math.min(1, (c.pop / 1e6) ** 0.25) + (c.code === 'PPLC' ? 40 : 0)),
    cap: c.code === 'PPLC' ? 1 : 0, pop: c.pop,
  });
}

// --- landmarks ---
const BAD_LANDMARK = new RegExp([
  'National Park', 'Lake', 'Islands?$', 'Reef', 'Prefecture', 'Coast', 'Peninsula', 'District', 'Valley', 'Forest',
  'Reserve', 'Region', 'Mountains', 'Desert', 'River', 'Archipelago', 'Sea$', 'Bay$', 'Delta', 'Route', 'Road',
  'Canal', 'Railway', '^Q\\d+$', 'Historic', 'Old Town', 'City of', 'Town of', 'Sites?$', 'Landscape', 'Monuments',
  'Churches', 'Area', 'Complex', 'Cultural', 'Heritage', 'Fortifications', 'Mines?$', 'Works', 'Park$', 'Centre',
  'Center', 'Ensemble', 'Group', 'Kingdom', 'Ruins of', 'Settlements', 'Towns', 'Villages', 'Tombs', 'Frontiers',
  'Gardens', 'Mosques', 'Temples', 'Palaces', 'Castles', 'Walls of', 'Wall$', 'Stadium', 'Arena', 'Park',
].join('|'), 'i');
// famous items whose single coordinate is meaningless or misleading, or that are really cities
const LANDMARK_BLOCKLIST = new Set([
  'Vatican City', 'Great Wall of China', 'Auschwitz', 'Bastille', 'Mausoleum at Halicarnassus', 'Temple of Ephesian Artemis',
  'Château de Montsoreau', 'Heard Island and McDonald Islands', 'Marquesas Islands', 'Troy', 'Kyoto Prefecture',
  'Mount Olympus', 'Al-Aqsa Mosque', 'Dome of the Rock', 'Mode Gakuen Cocoon Tower', 'Western Ghats', 'Way of Saint James',
  'Struve Geodetic Arc', 'Temple in Jerusalem', 'Mirante do Vale', 'Abeno Harukas', 'Dasht-e Lut', 'Crimean Bridge',
  'Appian Way', 'Curonian Spit', 'Wachau', "Tassili n'Ajjer", 'Heliopolis', 'Tadrart Acacus', "K'gari", 'Belvedere',
  'Saint Sophia Cathedral',
]);
// RENAME is applied before the name filters, so it also rescues famous places with awkward official names
const RENAME = {
  'Basilica and Expiatory Church of the Holy Family': 'Sagrada Família', 'Grand Canyon National Park': 'the Grand Canyon',
  'Yellowstone National Park': 'Yellowstone', 'Yosemite National Park': 'Yosemite', 'Galapagos Islands': 'the Galápagos Islands',
};
const ALLOW_STADIUM = new Set(['Colosseum']);
const raw = JSON.parse(read('landmarks_raw.json')).filter((l) => l.kind !== 'stadium' || ALLOW_STADIUM.has(l.name));
raw.sort((a, b) => b.sitelinks - a.sitelinks);
const MIN_LANDMARK_LINKS = 55;
for (const l of raw) {
  const name = RENAME[l.name] ?? l.name;
  if (l.sitelinks < MIN_LANDMARK_LINKS || LANDMARK_BLOCKLIST.has(l.name) || (!RENAME[l.name] && BAD_LANDMARK.test(name))) continue;
  // a heritage-listed city is covered by the city entry (but Alhambra, Spain is not Alhambra, California)
  if (cities.some((c) => (c.name === name || cityName(c) === name) && km(c, l) < 50)) continue;
  if (!countries[l.cc ?? l.country]) continue;              // need a continent
  if (Math.abs(l.lat) > 90 || Math.abs(l.lon) > 180) continue;
  const p = { lat: l.lat, lon: l.lon };
  if (targets.some((t) => t.k !== 'city' && km(t, p) < 1)) continue; // same site twice (palace + its heritage listing)
  targets.push({
    id: `w${l.qid}`, n: name, cc: l.country, c: countryName(l.country), ct: countries[l.country].cont, k: 'landmark',
    lat: r4(l.lat), lon: r4(l.lon), f: l.sitelinks,
  });
}
for (const x of JSON.parse(readFileSync(new URL('./extra_landmarks.json', import.meta.url), 'utf8')).places) {
  targets.push({
    id: `x${x.id}`, n: x.name, cc: x.cc, c: x.cc ? countryName(x.cc) : '', ct: x.cont ?? countries[x.cc]?.cont ?? 'AN',
    k: x.kind, lat: x.lat, lon: x.lon, f: x.fame,
  });
}

// --- tiers 1 (most famous) to 5 ---
// Tier 1 (Mondays) is famous capitals and world cities only; landmarks and nature start at tier 2.
const byFame = [...targets].sort((a, b) => b.f - a.f || a.id.localeCompare(b.id));
const tier1 = new Set(byFame.filter((t) => t.k === 'city' && ((t.cap && t.pop >= 300000) || t.pop >= 3e6)).slice(0, 110).map((t) => t.id));
const cityRank = new Map(byFame.filter((t) => t.k === 'city' && !tier1.has(t.id)).map((t, i) => [t.id, i]));
for (const t of targets) {
  if (t.k === 'city') {
    const r = cityRank.get(t.id);
    t.t = tier1.has(t.id) ? 1 : r < 130 ? 2 : r < 320 ? 3 : r < 600 ? 4 : r < 1100 ? 5 : 0; // 0 = too obscure
    delete t.pop;
  } else {
    t.t = t.f >= 120 ? 2 : t.f >= 95 ? 3 : t.f >= 75 ? 4 : 5;
  }
}
for (let i = targets.length - 1; i >= 0; i--) if (!targets[i].t) targets.splice(i, 1);
targets.sort((a, b) => a.t - b.t || b.f - a.f || a.id.localeCompare(b.id));
writeFileSync('site/data/targets.json', JSON.stringify({
  _credit: 'Cities: GeoNames (CC BY 4.0, geonames.org). Landmarks and fame (sitelink counts): Wikidata (CC0).',
  targets,
}).replace(/\},\{/g, '},\n{'));

// --- towns for the "pick your town" fallback (searched on-device; never sent anywhere) ---
const towns = cities.sort((a, b) => b.pop - a.pop).map((c) => [
  cityName(c), admin1[`${c.cc}.${c.a1}`] ?? '', c.cc, Math.round(c.lat * 100) / 100, Math.round(c.lon * 100) / 100,
]);
writeFileSync('site/data/towns.json', JSON.stringify({
  _credit: 'GeoNames (CC BY 4.0, geonames.org), cities with population 15,000+.',
  countries: Object.fromEntries(Object.entries(countries).map(([k, v]) => [k, countryName(k)])),
  towns,
}));

const count = (f) => targets.filter(f).length;
console.log(`targets: ${targets.length} (cities ${count((t) => t.k === 'city')}, landmarks ${count((t) => t.k === 'landmark')}, nature ${count((t) => t.k === 'nature')})`);
for (let t = 1; t <= 5; t++) console.log(`tier ${t}: ${count((x) => x.t === t)}  e.g. ${targets.filter((x) => x.t === t).slice(0, 12).map((x) => x.n).join(', ')}`);
console.log(`towns: ${towns.length}`);
