// Coastlines for the radar and the globe, from Natural Earth (public domain) via the world-atlas package.
//   node tools/build_land.mjs   -> site/data/land-110m.json, site/data/land-50m.json
// Format: { rings: [[lon, lat, lon, lat, ...], ...] } (flat arrays keep the files small).
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

for (const [res, dp] of [['110m', 1], ['50m', 2]]) {
  const topo = JSON.parse(readFileSync(`node_modules/world-atlas/land-${res}.json`, 'utf8'));
  const land = feature(topo, topo.objects.land);
  const rings = [];
  const f = 10 ** dp;
  for (const feat of land.features ?? [land]) {
    const g = feat.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) {
      const flat = [];
      let pl = null, pa = null;
      for (const [lon, lat] of ring) {
        const a = Math.round(lon * f) / f, b = Math.round(lat * f) / f;
        if (a === pl && b === pa) continue;
        flat.push(a, b); pl = a; pa = b;
      }
      if (flat.length >= 6) rings.push(flat);
    }
  }
  writeFileSync(`site/data/land-${res}.json`, JSON.stringify({ _credit: 'Natural Earth (public domain) via world-atlas', rings }));
  console.log(res, rings.length, 'rings');
}
