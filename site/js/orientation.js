// Device orientation -> pointing direction. Pure maths (no DOM), so it can be unit tested.
//
// W3C DeviceOrientation convention: the Earth frame is x = east, y = north, z = up; the device frame is
// x = right edge, y = top edge, z = out of the screen (towards the user), in the device's NATURAL
// orientation (portrait on phones) regardless of how the screen content is rotated.
// The device-to-Earth rotation is R = Rz(alpha) * Rx(beta) * Ry(gamma).
import { DEG, normalize } from './geo.js';

/** 3x3 rotation matrix (row-major) taking device-frame vectors to the Earth frame. */
export function rotationMatrix(alpha, beta, gamma) {
  const a = (alpha || 0) * DEG, b = (beta || 0) * DEG, g = (gamma || 0) * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return [
    [ca * cg - sa * sb * sg, -cb * sa, ca * sg + cg * sa * sb],
    [cg * sa + ca * sb * sg, ca * cb, sa * sg - ca * cg * sb],
    [-cb * sg, sb, cb * cg],
  ];
}

export function applyMatrix(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}

/**
 * The device-frame axis the player is pointing with.
 *  - 'camera': out of the BACK of the phone (-z), like a torch. Unaffected by screen rotation.
 *  - 'top': out of the top edge of the SCREEN as the player currently sees it. When the screen content is
 *    rotated by `screenAngle` (screen.orientation.angle: 90 = device turned anticlockwise), the visual top
 *    edge is a different physical edge.
 */
export function pointingAxis(method, screenAngle = 0) {
  if (method === 'camera') return [0, 0, -1];
  const t = (screenAngle || 0) * DEG;
  return [Math.sin(t), Math.cos(t), 0];
}

/** The screen's visual "right" axis in device coordinates (used to orient on-screen arrows). */
export function screenRightAxis(screenAngle = 0) {
  const t = (screenAngle || 0) * DEG;
  return [Math.cos(t), -Math.sin(t), 0];
}

/**
 * Rotate an Earth-frame vector clockwise (seen from above) about the vertical by `deg`.
 * Used to turn a magnetic-north-referenced direction into a true-north one (deg = declination),
 * and to apply the iOS compass offset. A vector at azimuth a ends up at azimuth a + deg.
 */
export function rotateAboutUp(v, deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
}

/** Direction the player is pointing, in a magnetic- (or arbitrary-) north ENU frame. */
export function pointingDirection(alpha, beta, gamma, method, screenAngle = 0) {
  return normalize(applyMatrix(rotationMatrix(alpha, beta, gamma), pointingAxis(method, screenAngle)));
}

/** How flat the phone is: 1 = screen facing straight up, 0 = upright. */
export function flatness(alpha, beta, gamma) {
  return Math.abs(rotationMatrix(alpha, beta, gamma)[2][2]);
}

/** Compass azimuth (deg) of the phone's top edge in the frame implied by alpha (meaningful when flat). */
export function topEdgeAzimuth(alpha, beta, gamma) {
  const v = applyMatrix(rotationMatrix(alpha, beta, gamma), [0, 1, 0]);
  return ((Math.atan2(v[0], v[1]) / DEG) % 360 + 360) % 360;
}

/**
 * iOS gives alpha relative to an ARBITRARY direction (fixed for the page's lifetime) plus a separate
 * magnetic `webkitCompassHeading`. When the phone is close to flat every definition of "heading" agrees
 * (it's where the top edge points), so we learn offset = compassHeading - topEdgeAzimuth only then, and
 * keep using it as the phone is raised. The offset is a circular running mean so jitter averages out.
 */
export class HeadingOffset {
  constructor({ minFlatness = 0.9, weight = 0.05 } = {}) {
    this.minFlatness = minFlatness;
    this.weight = weight;
    this.s = 0; this.c = 0; this.samples = 0;
  }
  /** Feed one iOS reading; returns true if it was used. */
  update(alpha, beta, gamma, compassHeading) {
    if (compassHeading == null || compassHeading < 0 || flatness(alpha, beta, gamma) < this.minFlatness) return false;
    const off = (compassHeading - topEdgeAzimuth(alpha, beta, gamma)) * DEG;
    const w = this.samples < 10 ? 1 / (this.samples + 1) : this.weight;
    this.s += w * (Math.sin(off) - this.s);
    this.c += w * (Math.cos(off) - this.c);
    this.samples++;
    return true;
  }
  get ready() { return this.samples >= 5; }
  /** Offset in degrees to rotate the arbitrary frame onto magnetic north. */
  get value() { return Math.atan2(this.s, this.c) / DEG; }
}
