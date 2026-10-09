// Magnetic declination from the World Magnetic Model, computed entirely on the device.
//
// Phone compasses measure heading from MAGNETIC north. Declination is the angle from true north to
// magnetic north at a place (positive = magnetic north is east of true north), so
//   true heading = magnetic heading + declination.
// Algorithm: NOAA Technical Report "The US/UK World Magnetic Model for 2025-2030", sections 1.2-1.3.
import { WMM_COEFFS, WMM_EPOCH, WMM_VALID_UNTIL } from './wmm-coeffs.js';

const DEG = Math.PI / 180;
const A = 6378.137;                  // WGS84 semi-major axis (km)
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const REF_RADIUS = 6371.2;           // geomagnetic reference radius (km)
const N_MAX = 12;

/** Decimal year for a Date (UTC). */
export function decimalYear(date) {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

/**
 * Magnetic field components at a place and time.
 * lat, lon: geodetic degrees; heightKm: height above the WGS84 ellipsoid; year: decimal year.
 * Returns { X (north), Y (east), Z (down) } in nT, and declination D / inclination I in degrees.
 */
export function magneticField(lat, lon, heightKm = 0, year = WMM_EPOCH) {
  const dt = year - WMM_EPOCH;
  // geodetic -> geocentric spherical
  const sinLat = Math.sin(lat * DEG), cosLat = Math.cos(lat * DEG);
  const rc = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const p = (rc + heightKm) * cosLat;
  const z = (rc * (1 - E2) + heightKm) * sinLat;
  const r = Math.hypot(p, z);
  const latC = Math.asin(z / r);                       // geocentric latitude (rad)
  const cosT = Math.sin(latC), sinT = Math.max(Math.cos(latC), 1e-10); // colatitude theta

  // Schmidt semi-normalised associated Legendre functions P[n][m] and dP/dtheta
  const P = [], dP = [];
  for (let n = 0; n <= N_MAX; n++) { P.push(new Array(n + 1).fill(0)); dP.push(new Array(n + 1).fill(0)); }
  P[0][0] = 1;
  for (let n = 1; n <= N_MAX; n++) {
    if (n === 1) { P[1][1] = sinT; dP[1][1] = cosT; }
    else {
      const k = Math.sqrt((2 * n - 1) / (2 * n));
      P[n][n] = k * sinT * P[n - 1][n - 1];
      dP[n][n] = k * (cosT * P[n - 1][n - 1] + sinT * dP[n - 1][n - 1]);
    }
    for (let m = 0; m < n; m++) {
      const d = Math.sqrt(n * n - m * m);
      const b = n >= 2 && m <= n - 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) : 0;
      const p2 = b ? P[n - 2][m] : 0, dp2 = b ? dP[n - 2][m] : 0;
      P[n][m] = ((2 * n - 1) * cosT * P[n - 1][m] - b * p2) / d;
      dP[n][m] = ((2 * n - 1) * (cosT * dP[n - 1][m] - sinT * P[n - 1][m]) - b * dp2) / d;
    }
  }

  let Xc = 0, Yc = 0, Zc = 0;
  const lonR = lon * DEG;
  for (const [n, m, g0, h0, gd, hd] of WMM_COEFFS) {
    const g = g0 + dt * gd, h = h0 + dt * hd;
    const ar = (REF_RADIUS / r) ** (n + 2);
    const cm = Math.cos(m * lonR), sm = Math.sin(m * lonR);
    Xc += ar * (g * cm + h * sm) * dP[n][m];
    Yc += ar * m * (g * sm - h * cm) * P[n][m];
    Zc -= ar * (n + 1) * (g * cm + h * sm) * P[n][m];
  }
  Yc /= sinT;

  // rotate from geocentric back to geodetic axes
  const psi = latC - lat * DEG;
  const X = Xc * Math.cos(psi) - Zc * Math.sin(psi);
  const Z = Xc * Math.sin(psi) + Zc * Math.cos(psi);
  const Y = Yc;
  const H = Math.hypot(X, Y);
  return { X, Y, Z, H, D: Math.atan2(Y, X) / DEG, I: Math.atan2(Z, H) / DEG };
}

/** Declination in degrees (east positive) at a place, for a Date (defaults to now). */
export function declination(lat, lon, date = new Date(), heightKm = 0) {
  // Outside the model's validity the secular-variation extrapolation degrades slowly; clamp rather than fail.
  const year = Math.min(Math.max(decimalYear(date), WMM_EPOCH), WMM_VALID_UNTIL);
  return magneticField(lat, lon, heightKm, year).D;
}

export { WMM_VALID_UNTIL };
