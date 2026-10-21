// Multi-resolution coastlines for the reveal radar, pre-simplified offline so the radar only rasterises
// the detail its zoom needs (it used to draw all ~60k points of land-50m on every reveal).
//
//   node tools/build_radar_land.mjs     -> site/data/radar/land-50m.json, site/data/radar/land-110m.json
//
// Re-run it whenever site/data/land-*.json change (node tools/build_land.mjs). No dependencies.
// The globe keeps using site/data/land-*.json; only the radar loads these files, and the leaderboard
// worker bundles neither.
//
// How it works
// - The radar's "zoom" is continuous: the map circle (radius 0.4 x canvas width) spans from you to the
//   target, so its scale is mapR / extent px per degree of arc, extent = max(distance to target, 0.5 deg).
//   The largest canvas the reveal uses is about 1200 device px (the 42rem page column minus the up/down
//   bar, at the devicePixelRatio cap of 2), so mapR <= 480 px and the scale is at most 960 px/deg.
// - Every ring keeps ALL of its original vertices, in order, so the full-detail drawing is the same
//   data as before. Each vertex gets a zoom-level tag: the coarsest level on a ladder of tolerances
//   (LADDER[j] = 0.0005 * 2^j degrees) at which Douglas-Peucker still needs it. The tags are nested, so
//   "the vertices tagged >= j" is exactly the Douglas-Peucker simplification at tolerance LADDER[j].
//   Segments of a simplification at tolerance e are also never longer than MAX_SPAN * e degrees (unless
//   the original segment already was), which keeps far-away chords short.
// - Rings are cut into chunks of CHUNK vertices whose end vertices are always kept, with a bounding cap
//   (centre, radius) per chunk. For each chunk the radar picks the coarsest level whose error stays
//   below 0.25 device px where the chunk is on screen (allowing for the projection's sideways stretch),
//   or, for chunks wholly off the map circle, the coarsest level whose chords still can't reach it.
//   Chunks under 4 px across on screen (specks of islands) are always drawn at full detail, because the
//   coast stroke's mitred corners make them look bigger than their outline. Near the player that is
//   usually full detail; far away it is a few points per chunk.
//
// Format: { _credit, ladder, chunk, maxSpan, rings: [[flat lon/lat..., ], tags, caps] }
//   tags: one base-36 character per vertex: 0 = full detail only, j+1 = kept at tolerance LADDER[j],
//         'z' = always kept (chunk ends, and a triangle of each one-chunk island).
//   caps: [lon, lat, radiusDeg] per chunk; chunk k covers vertices k*CHUNK .. min((k+1)*CHUNK, n-1).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CHUNK = 48;
const LADDER = Array.from({ length: 16 }, (_, j) => 0.0005 * 2 ** j);   // 0.0005 .. 16.4 degrees
const MAX_SPAN = 50;                                                     // span length <= 50 x tolerance
const DEG = Math.PI / 180;

const vec = (lon, lat) => {
  const l = lon * DEG, p = lat * DEG;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) / DEG;   // degrees

/** Angular distance (deg) from P to the great-circle arc A-B. */
function arcDistance(p, a, b) {
  const n = cross(a, b), nl = Math.hypot(...n);
  if (nl < 1e-12) return angle(p, a);
  if (dot(cross(a, p), n) >= 0 && dot(cross(p, b), n) >= 0) return Math.asin(Math.min(1, Math.abs(dot(p, n)) / nl)) / DEG;
  return Math.min(angle(p, a), angle(p, b));
}

/** Nested Douglas-Peucker importance (deg) for vertices a+1..b-1 of v. */
function importance(v, a, b, imp) {
  const stack = [[a, b, Infinity]];
  while (stack.length) {
    const [i, j, parent] = stack.pop();
    if (j - i < 2) continue;
    let best = -1, dev = -1;
    for (let k = i + 1; k < j; k++) {
      const d = arcDistance(v[k], v[i], v[j]);
      if (d > dev) { dev = d; best = k; }
    }
    const need = Math.min(parent, Math.max(dev, angle(v[i], v[j]) / MAX_SPAN));
    imp[best] = need;
    stack.push([i, best, need], [best, j, need]);
  }
  // A whole small island in one chunk starts and ends on the same vertex: keep a triangle of it at every
  // level (the first split and the larger of the next two), so it never collapses to a point and vanishes.
  if (angle(v[a], v[b]) < 1e-9 && b - a >= 3) {
    let first = a + 1;
    for (let k = a + 1; k < b; k++) if (imp[k] > imp[first]) first = k;
    imp[first] = Infinity;
    let second = -1;
    for (let k = a + 1; k < b; k++) if (k !== first && (second < 0 || imp[k] > imp[second])) second = k;
    if (second >= 0) imp[second] = Infinity;
  }
}

const tag = (imp) => {
  let q = 0;
  while (q < LADDER.length && imp >= LADDER[q]) q++;
  return q.toString(36);
};

mkdirSync('site/data/radar', { recursive: true });
for (const res of ['50m', '110m']) {
  const src = JSON.parse(readFileSync(`site/data/land-${res}.json`, 'utf8'));
  const out = [];
  let total = 0;
  const kept = new Array(LADDER.length + 1).fill(0);
  for (const flat of src.rings) {
    const n = flat.length / 2;
    const v = [];
    for (let i = 0; i < n; i++) v.push(vec(flat[2 * i], flat[2 * i + 1]));
    const imp = new Array(n).fill(0);
    const caps = [];
    for (let a = 0; a < n - 1; a += CHUNK) {
      const b = Math.min(a + CHUNK, n - 1);
      imp[a] = imp[b] = Infinity;
      importance(v, a, b, imp);
      // bounding cap: normalised mean of the vectors, radius = farthest vertex (rounded outwards)
      const m = [0, 0, 0];
      for (let k = a; k <= b; k++) for (let d = 0; d < 3; d++) m[d] += v[k][d];
      const ml = Math.hypot(...m) || 1;
      const clat = Math.round((Math.asin(Math.max(-1, Math.min(1, m[2] / ml))) / DEG) * 1000) / 1000;
      const clon = Math.round((Math.atan2(m[1], m[0]) / DEG) * 1000) / 1000;
      const c = vec(clon, clat);
      let rad = 0;
      for (let k = a; k <= b; k++) rad = Math.max(rad, angle(c, v[k]));
      caps.push(clon, clat, Math.ceil(rad * 1000 + 1) / 1000);
    }
    const tags = imp.map((x) => (x === Infinity ? 'z' : tag(x))).join('');
    for (let j = 0; j <= LADDER.length; j++) kept[j] += [...tags].filter((t) => t === 'z' || parseInt(t, 36) >= j).length;
    total += n;
    out.push([flat, tags, caps]);
  }
  writeFileSync(`site/data/radar/land-${res}.json`, JSON.stringify({
    _credit: 'Natural Earth (public domain) via world-atlas; built from site/data/land-' + res + '.json by tools/build_radar_land.mjs',
    ladder: LADDER, chunk: CHUNK, maxSpan: MAX_SPAN, rings: out,
  }));
  console.log(res, out.length, 'rings', total, 'vertices; kept per level:', kept.map((k, j) => (j ? `${LADDER[j - 1]}°:${k}` : `all:${k}`)).join(' '));
}
