// Fetch fame data from the Wikidata Query Service (Wikidata is CC0).
//
//   node tools/fetch_wikidata.mjs <geonames-dir>
//
// Reads <geonames-dir>/cities15000.txt and writes into <geonames-dir>:
//   city_fame.json      { geonamesId: [sitelinks, englishLabel] } for the most populous cities and all capitals
//   landmarks_raw.json  [{ qid, name, lat, lon, sitelinks, country, kind }]
// "sitelinks" = the number of Wikipedia (and sister) language editions with an article on the place,
// a cheap, stable fame measure that needs one query instead of millions of pageview calls.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/fetch_wikidata.mjs <geonames-dir>'); process.exit(1); }

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'PointleTargetBuilder/1.0 (https://github.com/biccyanzac-pixel/pointle)';

async function sparql(query) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query }),
    });
    if (res.ok) return (await res.json()).results.bindings;
    console.error(`query failed (${res.status}), attempt ${attempt}`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  throw new Error('Wikidata query kept failing');
}

// --- cities: sitelinks for the top cities by population, plus every capital ---
const rows = readFileSync(join(dir, 'cities15000.txt'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
const cities = rows.map((c) => ({ id: c[0], pop: +c[14], code: c[7] }));
const wanted = new Set(cities.filter((c) => c.code === 'PPLC').map((c) => c.id));
for (const c of [...cities].sort((a, b) => b.pop - a.pop).slice(0, 7000)) wanted.add(c.id);
const ids = [...wanted];
const fame = {};
if (existsSync(join(dir, 'city_fame.json'))) Object.assign(fame, JSON.parse(readFileSync(join(dir, 'city_fame.json'), 'utf8')));
else for (let i = 0; i < ids.length; i += 400) {
  const values = ids.slice(i, i + 400).map((id) => `"${id}"`).join(' ');
  const b = await sparql(`SELECT ?g (MAX(?s) AS ?sl) (SAMPLE(?lab) AS ?en) WHERE { VALUES ?g { ${values} }
    ?item wdt:P1566 ?g; wikibase:sitelinks ?s. OPTIONAL { ?item rdfs:label ?lab. FILTER(LANG(?lab) = "en") } } GROUP BY ?g`);
  for (const r of b) fame[r.g.value] = [+r.sl.value, r.en?.value ?? null];
  console.error(`cities ${Math.min(i + 400, ids.length)}/${ids.length}`);
}
writeFileSync(join(dir, 'city_fame.json'), JSON.stringify(fame));

// --- landmarks: famous non-city places with a single point location ---
// kind -> Wikidata classes (instance of, or subclass of)
const KINDS = {
  heritage: null, // World Heritage Sites, handled by P1435 below
  tower: 'wd:Q12518', monument: 'wd:Q4989906', bridge: 'wd:Q12280', palace: 'wd:Q16560',
  temple: 'wd:Q44539', church: 'wd:Q2977', castle: 'wd:Q23413', stadium: 'wd:Q483110',
  skyscraper: 'wd:Q11303',
};
// Natural features (mountains, waterfalls...) time out on the public endpoint, so they come from the
// hand-picked list in tools/extra_landmarks.json instead.
const out = new Map();
async function landmarkQuery(kind, pattern, minLinks) {
  const b = await sparql(`
    SELECT ?item ?itemLabel ?coord ?sl ?cc WHERE {
      ${pattern}
      ?item wikibase:sitelinks ?sl. FILTER(?sl >= ${minLinks})
      ?item p:P625/psv:P625 [ wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lon; wikibase:geoGlobe wd:Q2 ].
      BIND(CONCAT(STR(?lat), " ", STR(?lon)) AS ?coord)
      OPTIONAL { ?item wdt:P17 ?country. ?country wdt:P297 ?cc. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`);
  for (const r of b) {
    const qid = r.item.value.split('/').pop();
    const [lat, lon] = r.coord.value.split(' ').map(Number);
    if (out.has(qid)) continue; // first coordinate wins
    out.set(qid, { qid, name: r.itemLabel.value, lat, lon, sitelinks: +r.sl.value, country: r.cc?.value ?? '', kind });
  }
  console.error(`${kind}: ${out.size} total`);
}
await landmarkQuery('heritage', '?item wdt:P1435 wd:Q9259.', 40);
for (const [kind, cls] of Object.entries(KINDS)) {
  if (!cls) continue;
  await landmarkQuery(kind, `?item wdt:P31/wdt:P279? ${cls}.`, 60);
}
writeFileSync(join(dir, 'landmarks_raw.json'), JSON.stringify([...out.values()], null, 1));
console.error(`wrote ${Object.keys(fame).length} city fame scores, ${out.size} landmarks`);
