// Geometry for pointing through the Earth. Pure functions, no DOM: runs in the browser and in Node tests.
//
// Directions are unit vectors in the player's local East-North-Up (ENU) frame:
//   x = east, y = north, z = up (perpendicular to the WGS84 ellipsoid, which is what a phone's
//   gravity sensor measures as "up").
// Angles are in degrees at the API boundary.

export const DEG = Math.PI / 180;
export const WGS84_A = 6378137.0;            // semi-major axis (m)
export const WGS84_F = 1 / 298.257223563;    // flattening
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
export const MEAN_RADIUS_KM = 6371.0088;     // IUGG mean Earth radius, used for the spherical "fun facts"

// --- vectors ---
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export function normalize(a) {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

/** Angle between two vectors in degrees (numerically stable for tiny and near-180° angles). */
export function angleBetween(a, b) {
  return Math.atan2(norm(cross(a, b)), dot(a, b)) / DEG;
}

/** Wrap an angle to [-180, 180). */
export function wrap180(d) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** Wrap an angle to [0, 360). */
export function wrap360(d) {
  return ((d % 360) + 360) % 360;
}

// --- Earth frames ---

/** Geodetic latitude/longitude (deg) and height (m) to Earth-centred, Earth-fixed coordinates (m). */
export function toEcef(lat, lon, h = 0) {
  const sl = Math.sin(lat * DEG), cl = Math.cos(lat * DEG);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
  return [(n + h) * cl * Math.cos(lon * DEG), (n + h) * cl * Math.sin(lon * DEG), (n * (1 - WGS84_E2) + h) * sl];
}

/** The local East, North and Up unit vectors (in ECEF) at a geodetic position. */
export function enuBasis(lat, lon) {
  const sl = Math.sin(lat * DEG), cl = Math.cos(lat * DEG), so = Math.sin(lon * DEG), co = Math.cos(lon * DEG);
  return { e: [-so, co, 0], n: [-sl * co, -sl * so, cl], u: [cl * co, cl * so, sl] };
}

/** Express an ECEF vector in the ENU frame at (lat, lon). */
export function ecefToEnu(v, lat, lon) {
  const { e, n, u } = enuBasis(lat, lon);
  return [dot(v, e), dot(v, n), dot(v, u)];
}

/** Express an ENU vector at (lat, lon) in ECEF. */
export function enuToEcef(v, lat, lon) {
  const { e, n, u } = enuBasis(lat, lon);
  return [0, 1, 2].map((i) => v[0] * e[i] + v[1] * n[i] + v[2] * u[i]);
}

/**
 * The true straight-line direction from one place to another, through the Earth.
 * Returns a unit ENU vector at `from`. Both places are on the ellipsoid surface (height 0).
 */
export function trueDirection(from, to) {
  const p = toEcef(from.lat, from.lon), q = toEcef(to.lat, to.lon);
  return normalize(ecefToEnu([q[0] - p[0], q[1] - p[1], q[2] - p[2]], from.lat, from.lon));
}

/** Compass azimuth (deg clockwise from true north, 0-360) and elevation (deg, negative = below horizon). */
export function toAzEl(v) {
  const u = normalize(v);
  const el = Math.asin(Math.max(-1, Math.min(1, u[2]))) / DEG;
  const az = Math.hypot(u[0], u[1]) < 1e-12 ? 0 : wrap360(Math.atan2(u[0], u[1]) / DEG);
  return { az, el };
}

/** Unit ENU vector from azimuth and elevation (deg). */
export function fromAzEl(az, el) {
  const ce = Math.cos(el * DEG);
  return [ce * Math.sin(az * DEG), ce * Math.cos(az * DEG), Math.sin(el * DEG)];
}

/**
 * How far a guess is from the truth. `error` is the full 3D angle (what is scored).
 * `horizontal` > 0 means the guess was too far right (clockwise), `vertical` > 0 means too high.
 */
export function compareDirections(guess, truth) {
  const g = toAzEl(guess), t = toAzEl(truth);
  return { error: angleBetween(guess, truth), horizontal: wrap180(g.az - t.az), vertical: g.el - t.el };
}

/** Mean direction of a set of unit vectors (used to smooth the locked-in guess). */
export function meanDirection(vectors) {
  const s = [0, 0, 0];
  for (const v of vectors) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  return normalize(s);
}

// --- spherical helpers (maps, fun facts) ---

/** Central angle between two places on a sphere, in degrees. */
export function centralAngle(a, b) {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / DEG;
}

/** Initial great-circle bearing from a to b on a sphere (deg, 0-360). */
export function initialBearing(a, b) {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) / DEG);
}

/** Point reached by travelling `angleDeg` of arc from `start` along `bearingDeg` (sphere). */
export function destination(start, bearingDeg, angleDeg) {
  const p1 = start.lat * DEG, l1 = start.lon * DEG, b = bearingDeg * DEG, d = angleDeg * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / DEG, lon: wrap180(l2 / DEG) };
}

/** Distances for the reveal screen, on a sphere of mean radius. */
export function tunnelFacts(a, b) {
  const theta = centralAngle(a, b) * DEG;
  return {
    centralAngle: theta / DEG,
    flightKm: MEAN_RADIUS_KM * theta,                          // along the surface
    tunnelKm: 2 * MEAN_RADIUS_KM * Math.sin(theta / 2),        // straight chord through the Earth
    deepestKm: MEAN_RADIUS_KM * (1 - Math.cos(theta / 2)),     // depth below the surface at the chord's midpoint
    dip: theta / 2 / DEG,                                      // how far below the horizon the chord starts
  };
}

/**
 * Where a straight ray from `origin` (azimuth, elevation) comes out of a spherical Earth.
 * Rays at or above the horizon never re-enter: returns null.
 * A chord leaving at `d` degrees below the horizon spans a central angle of 2d.
 */
export function exitPoint(origin, az, el) {
  if (el >= 0) return null;
  return destination(origin, az, -2 * el);
}

/**
 * Azimuthal equidistant projection centred on `centre`: every place appears in its true compass
 * direction, at a distance proportional to its great-circle distance. Returns [x, y] in degrees of arc
 * (x east, y north). Callers scale to pixels.
 */
export function aeqd(centre, p) {
  const c = centralAngle(centre, p);
  const b = initialBearing(centre, p) * DEG;
  return [c * Math.sin(b), c * Math.cos(b)];
}
