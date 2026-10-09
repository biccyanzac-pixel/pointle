// Live pointing direction from the phone's orientation sensors (browser side of orientation.js).
//
// Platforms:
//  - Android Chrome/Edge/Samsung: `deviceorientationabsolute`, alpha referenced to MAGNETIC north.
//  - Firefox Android: `deviceorientation` with event.absolute === true (magnetic north).
//  - iOS Safari/Chrome (all WebKit): `deviceorientation` with alpha relative to an ARBITRARY direction,
//    plus `webkitCompassHeading` (magnetic) and `webkitCompassAccuracy`. Needs a tap to grant permission.
// Every reading is converted to TRUE north with the World Magnetic Model declination for the origin.
// Nothing here touches the network.
import { pointingDirection, rotateAboutUp, HeadingOffset, flatness } from './orientation.js';
import { meanDirection, toAzEl } from './geo.js';
import { declination } from './wmm.js';

export function screenAngle() {
  const a = screen.orientation?.angle ?? window.orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

export function sensorsLikelyAvailable() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;
}

export function needsPermissionTap() {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
}

export class SensorPointer {
  constructor({ method = 'camera' } = {}) {
    this.method = method;
    this.decl = 0;
    this.samples = [];          // { t, v } true-north ENU unit vectors
    this.kind = 'none';         // 'absolute' | 'ios' | 'relative' | 'none'
    this.accuracy = null;       // degrees (iOS only)
    this.offset = new HeadingOffset();
    this.last = null;           // last raw event values, for the test page
    this.listeners = new Set();
    this.onAbs = (e) => this.handle(e, true);
    this.onRel = (e) => this.handle(e, false);
    this.gotAbsolute = false;
  }

  /** Must run inside a user gesture on iOS. Resolves to true if allowed. */
  async requestPermission() {
    if (!needsPermissionTap()) return true;
    try {
      return (await DeviceOrientationEvent.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  setOrigin(lat, lon) {
    this.decl = declination(lat, lon, new Date());
  }

  /** Use a fixed declination instead (e.g. 0 when the player's region is unknown). */
  setDeclination(d) { this.decl = d; }

  start() {
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', this.onAbs);
    window.addEventListener('deviceorientation', this.onRel);
  }

  stop() {
    window.removeEventListener('deviceorientationabsolute', this.onAbs);
    window.removeEventListener('deviceorientation', this.onRel);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  handle(e, fromAbsoluteEvent) {
    if (e.alpha == null && e.beta == null) return;
    const now = performance.now();
    const { alpha, beta, gamma } = e;
    const ios = typeof e.webkitCompassHeading === 'number';
    const absolute = fromAbsoluteEvent || e.absolute === true;
    if (absolute) this.gotAbsolute = true;
    // Chrome fires both events; once absolute ones arrive, ignore the relative stream
    if (!absolute && !ios && this.gotAbsolute) return;
    const sa = screenAngle();
    let v = pointingDirection(alpha, beta, gamma, this.method, sa);
    if (ios) {
      this.kind = 'ios';
      this.accuracy = typeof e.webkitCompassAccuracy === 'number' && e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : null;
      this.offset.update(alpha, beta, gamma, e.webkitCompassHeading);
      v = rotateAboutUp(v, this.offset.value + this.decl);
    } else if (absolute) {
      this.kind = 'absolute';
      v = rotateAboutUp(v, this.decl);
    } else {
      this.kind = 'relative';   // no compass reference: direction is unusable for the game
    }
    this.last = { alpha, beta, gamma, absolute, ios, compassHeading: e.webkitCompassHeading, accuracy: this.accuracy,
      screenAngle: sa, flat: flatness(alpha, beta, gamma), t: now };
    this.samples.push({ t: now, v });
    while (this.samples.length && now - this.samples[0].t > 1500) this.samples.shift();
    for (const fn of this.listeners) fn(this);
  }

  /** Usable for play: a north reference exists (and on iOS, the offset has been learnt). */
  get ready() {
    return this.kind === 'absolute' || (this.kind === 'ios' && this.offset.ready);
  }

  /** iOS only: we still need the phone held flat for a moment to find north. */
  get needsFlat() {
    return this.kind === 'ios' && !this.offset.ready;
  }

  /** Mean direction over the last `ms` milliseconds (null if no data). */
  direction(ms = 120) {
    if (!this.samples.length) return null;
    const end = this.samples[this.samples.length - 1].t;
    const recent = this.samples.filter((s) => end - s.t <= ms).map((s) => s.v);
    return meanDirection(recent);
  }

  /** The locked-in guess: mean over the last 0.5 s, to remove hand jitter. */
  lock() {
    return this.direction(500);
  }

  azEl(ms) {
    const d = this.direction(ms);
    return d ? toAzEl(d) : null;
  }
}
