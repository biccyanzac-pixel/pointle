import { test } from 'node:test';
import assert from 'node:assert/strict';
import geodesicPkg from 'geographiclib-geodesic';
import {
  trueDirection, toAzEl, fromAzEl, compareDirections, angleBetween, meanDirection, centralAngle,
  initialBearing, tunnelFacts, exitPoint, aeqd, toEcef, wrap180, destination, MEAN_RADIUS_KM,
} from '../site/js/geo.js';

const { Geodesic } = geodesicPkg;
const WGS84 = Geodesic.WGS84;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

const P = {
  london: { lat: 51.5074, lon: -0.1278 },
  newYork: { lat: 40.7128, lon: -74.006 },
  tokyo: { lat: 35.6762, lon: 139.6503 },
  sydney: { lat: -33.8688, lon: 151.2093 },
  lima: { lat: -12.0464, lon: -77.0428 },
  cairo: { lat: 30.0444, lon: 31.2357 },
  paris: { lat: 48.8566, lon: 2.3522 },
  reykjavik: { lat: 64.1466, lon: -21.9426 },
  capeTown: { lat: -33.9249, lon: 18.4241 },
  quito: { lat: -0.1807, lon: -78.4678 },
};
const pairs = [
  ['london', 'newYork'], ['london', 'tokyo'], ['london', 'sydney'], ['london', 'lima'], ['london', 'cairo'],
  ['london', 'paris'], ['newYork', 'tokyo'], ['sydney', 'reykjavik'], ['capeTown', 'quito'], ['tokyo', 'lima'],
];

test('azimuth of the through-Earth line matches the WGS84 geodesic azimuth (GeographicLib)', () => {
  // On an ellipsoid the chord's azimuth and the geodesic's initial azimuth differ only slightly
  // (exactly equal on a sphere). They drift apart as the pair nears antipodal (London-Sydney: 0.26 deg),
  // where azimuth matters least because the line is nearly vertical. Both are far below compass error.
  for (const [a, b] of pairs) {
    const g = WGS84.Inverse(P[a].lat, P[a].lon, P[b].lat, P[b].lon);
    const { az } = toAzEl(trueDirection(P[a], P[b]));
    near(wrap180(az - g.azi1), 0, centralAngle(P[a], P[b]) < 120 ? 0.1 : 0.5, `${a}->${b}`);
  }
});

test('reference bearings and distances for well-known pairs', () => {
  // spherical great-circle values, widely published
  near(initialBearing(P.london, P.newYork), 288.3, 0.3, 'LON->NYC bearing');
  near(centralAngle(P.london, P.newYork) * Math.PI / 180 * MEAN_RADIUS_KM, 5570, 15, 'LON-NYC km');
  near(centralAngle(P.london, P.sydney) * Math.PI / 180 * MEAN_RADIUS_KM, 16990, 30, 'LON-SYD km');
  near(centralAngle(P.london, P.paris) * Math.PI / 180 * MEAN_RADIUS_KM, 344, 3, 'LON-PAR km');
  // GeographicLib ellipsoidal distance vs our spherical one: within 0.5%
  for (const [a, b] of pairs) {
    const s = WGS84.Inverse(P[a].lat, P[a].lon, P[b].lat, P[b].lon).s12 / 1000;
    const ours = tunnelFacts(P[a], P[b]).flightKm;
    near(ours / s, 1, 0.005, `${a}-${b} distance ratio`);
  }
});

test('downward angle: chord dips by half the central angle', () => {
  for (const [a, b] of pairs) {
    const { el } = toAzEl(trueDirection(P[a], P[b]));
    near(-el, centralAngle(P[a], P[b]) / 2, 0.25, `${a}->${b} dip`);
  }
  // Paris from London is just below the horizon (~1.5 deg)
  const { el } = toAzEl(trueDirection(P.london, P.paris));
  assert.ok(el < -1.2 && el > -1.9, `LON->PAR el ${el}`);
});

test('chord length equals the straight-line ECEF distance', () => {
  for (const [a, b] of pairs) {
    const p = toEcef(P[a].lat, P[a].lon), q = toEcef(P[b].lat, P[b].lon);
    const chordKm = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / 1000;
    near(tunnelFacts(P[a], P[b]).tunnelKm / chordKm, 1, 0.004, `${a}-${b}`);
  }
});

test('antipode points straight down', () => {
  // On the equator and at the poles the ellipsoid normal passes through the centre: exactly down.
  for (const p of [{ lat: 0, lon: 0 }, { lat: 0, lon: 100 }, { lat: 90, lon: 0 }]) {
    const anti = { lat: -p.lat, lon: wrap180(p.lon + 180) };
    near(toAzEl(trueDirection(p, anti)).el, -90, 1e-6, `antipode of ${p.lat},${p.lon}`);
  }
  // At mid-latitudes, "down" (the ellipsoid normal) misses the Earth's centre by up to ~0.19 deg.
  const anti = { lat: -P.london.lat, lon: P.london.lon + 180 };
  near(toAzEl(trueDirection(P.london, anti)).el, -90, 0.2, 'London antipode');
  near(tunnelFacts(P.london, anti).deepestKm, MEAN_RADIUS_KM, 1e-6, 'tunnel passes through the centre');
});

test('3D error between guess and truth, with horizontal/vertical components', () => {
  const truth = fromAzEl(30, -40);
  assert.equal(Math.round(compareDirections(truth, truth).error * 1e6), 0);
  const g = compareDirections(fromAzEl(42, -32), truth);
  near(g.horizontal, 12, 1e-9, 'too far right');
  near(g.vertical, 8, 1e-9, 'too high');
  // pure elevation difference => error equals that difference
  near(compareDirections(fromAzEl(30, -10), truth).error, 30, 1e-9);
  // pure azimuth difference on the horizon => equal
  near(compareDirections(fromAzEl(350, 0), fromAzEl(10, 0)).error, 20, 1e-9);
  near(compareDirections(fromAzEl(350, 0), fromAzEl(10, 0)).horizontal, -20, 1e-9, 'wraps across north');
  // opposite directions
  near(angleBetween(fromAzEl(0, 0), fromAzEl(180, 0)), 180, 1e-9);
  // azimuth differences shrink near the vertical: 90 deg of azimuth at -80 elevation is only ~14 deg
  near(compareDirections(fromAzEl(0, -80), fromAzEl(90, -80)).error, 14.1, 0.1);
});

test('meanDirection averages unit vectors', () => {
  const m = meanDirection([fromAzEl(10, -20), fromAzEl(20, -20), fromAzEl(15, -25), fromAzEl(15, -15)]);
  const { az, el } = toAzEl(m);
  near(az, 15, 0.1); near(el, -20, 0.1);
});

test('exit point of a pointing ray lands on the target', () => {
  for (const [a, b] of pairs) {
    const t = trueDirection(P[a], P[b]);
    const { az, el } = toAzEl(t);
    const out = exitPoint(P[a], az, el);
    assert.ok(centralAngle(out, P[b]) < 0.5, `${a}->${b} exits ${centralAngle(out, P[b])} deg away`);
  }
  assert.equal(exitPoint(P.london, 0, 5), null);
});

test('azimuthal equidistant projection keeps bearings and distances from the centre', () => {
  const [x, y] = aeqd(P.london, P.newYork);
  near(Math.hypot(x, y), centralAngle(P.london, P.newYork), 1e-9);
  near((Math.atan2(x, y) * 180 / Math.PI + 360) % 360, initialBearing(P.london, P.newYork), 1e-9);
  const d = destination(P.london, 45, 30);
  near(centralAngle(P.london, d), 30, 1e-9);
});
