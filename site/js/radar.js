// The reveal "radar": a world map centred on the player in azimuthal equidistant projection (every place
// in its true compass direction), scaled so the target sits on the edge. Rotates heading-up in sensor
// mode like a maps app. Plus the vertical "spirit level" bar for up/down.
import { centralAngle, initialBearing, DEG, wrap360 } from './geo.js';

// Theme colours, read once (not per frame) and re-read when the colour scheme flips.
const cssCache = new Map();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => cssCache.clear());
const css = (name) => {
  if (!cssCache.has(name)) cssCache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  return cssCache.get(name);
};

// Drawn base layers, shared by every Radar (three reveals a day, redraws, resizes), keyed by baseKey().
// A colour-scheme flip changes the colours in the key, so the next draw renders afresh.
const baseCache = new Map();
const BASE_CACHE_MAX = 4;
const BASE_COLOURS = ['--sea', '--land', '--coast', '--grid', '--ink-2'];
const TOL_PX = 0.25;   // max simplification error on screen, device px
const EDGE_PX = 4;     // detail kept this far outside the map circle (coast line width + antialiasing)
const SPECK_PX = 4;    // chunks smaller than this on screen are drawn at full detail
const level = (code) => (code < 58 ? code - 48 : code - 87);   // base-36 vertex tag

export class Radar {
  /**
   * origin, target: { lat, lon }; trueAzEl: { az, el } of the true line; land: multi-resolution coastlines
   * from data/radar/land-*.json (tools/build_radar_land.mjs), with res '50m' or '110m'.
   */
  constructor(canvas, { origin, target, targetName, trueAzEl, land }) {
    this.canvas = canvas;
    this.origin = origin;
    this.target = target;
    this.targetName = targetName;
    this.truth = trueAzEl;
    this.land = land;
    this.extent = Math.max(centralAngle(origin, target), 0.5); // degrees of arc at the map edge
    this.headingUp = null;  // degrees, or null for north-up
    this.pointer = null;    // { az, el } live
    this.guess = null;      // { az, el } locked
    this.base = null;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this.canvas.clientWidth || 300;
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.px = this.canvas.width;
    this.R = this.px / 2;
    this.mapR = this.R * 0.8;     // map circle radius; the compass ring sits outside it
    this.scale = this.mapR / this.extent;
  }

  /** Pixel offset (north-up, y down) of a ground point from the centre. */
  project(p) {
    const c = centralAngle(this.origin, p), b = initialBearing(this.origin, p) * DEG;
    return [c * Math.sin(b) * this.scale, -c * Math.cos(b) * this.scale, c];
  }

  /**
   * project() and centralAngle() for many points: the same formulas as geo.js, with the origin's trig
   * worked out once and no objects per point (the coastline loop calls these tens of thousands of times).
   */
  projector() {
    const p1 = this.origin.lat * DEG, lon1 = this.origin.lon, cp1 = Math.cos(p1), sp1 = Math.sin(p1), scale = this.scale;
    const arc = (lon, lat) => {
      const p2 = lat * DEG, dl = (lon - lon1) * DEG;
      const h = Math.sin((p2 - p1) / 2) ** 2 + cp1 * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / DEG;
    };
    const project = (lon, lat) => {
      const p2 = lat * DEG, dl = (lon - lon1) * DEG, cp2 = Math.cos(p2);
      const h = Math.sin((p2 - p1) / 2) ** 2 + cp1 * cp2 * Math.sin(dl / 2) ** 2;
      const c = (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / DEG;
      const b = Math.atan2(Math.sin(dl) * cp2, cp1 * Math.sin(p2) - sp1 * cp2 * Math.cos(dl));
      return [c * Math.sin(b) * scale, -c * Math.cos(b) * scale, c];
    };
    return { arc, project };
  }

  /** Where a pointing direction lands on the map: the exit point of the ray, or the edge if it's skyward. */
  directionToXY(az, el) {
    const c = el < 0 ? -2 * el : Infinity;   // a chord dipping d degrees spans 2d degrees of arc
    const clipped = c > this.extent * 1.12;
    const r = clipped ? this.mapR * 1.04 : c * this.scale;
    return { x: Math.sin(az * DEG) * r, y: -Math.cos(az * DEG) * r, clipped };
  }

  /** Cache key for the base layer: everything it depends on (origin, zoom, size, colours). */
  baseKey() {
    const { origin: o } = this;
    return `${o.lat},${o.lon}|${this.extent}|${this.px}|${this.land.res}|${BASE_COLOURS.map(css).join(',')}`;
  }

  renderBase() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = this.px;
    const g = cv.getContext('2d');
    g.translate(this.R, this.R);
    g.beginPath(); g.arc(0, 0, this.mapR, 0, Math.PI * 2);
    g.fillStyle = css('--sea'); g.fill();
    g.save(); g.clip();
    const fill = new Path2D(), stroke = new Path2D();
    const limit = Math.min(179, this.extent * 1.6);
    const { ladder, chunk: CH, maxSpan, rings } = this.land;
    // Level of detail per chunk (see tools/build_radar_land.mjs): on the map circle, the coarsest
    // tolerance that stays under TOL_PX after the projection's sideways stretch (c / sin c); off it, the
    // coarsest whose chords can't reach the circle. 'tags >= need' selects that simplification.
    const s = this.scale, vis = this.extent + EDGE_PX / s;
    const sinHalfSpan = ladder.map((e) => Math.sin((Math.min(maxSpan * e, 180) * DEG) / 2));
    const needFor = (dmin, dmax, r) => {
      let j = -1;
      if (dmin <= vis) {
        // a speck of an island stays exact: its stroke's mitred corners make it look bigger than its outline
        if (r * s < SPECK_PX) return 0;
        const c = Math.min(dmax, vis, 179) * DEG, stretch = c > 1e-6 ? c / Math.sin(c) : 1;
        const tol = TOL_PX / (s * stretch);
        while (j + 1 < ladder.length && ladder[j + 1] <= tol) j++;
      } else {
        // a chord of length L between points at least dmin away turns by 2 asin(sin(L/2) / sin c) at most,
        // so it stays at least dmin cos(that / 2) from the centre
        const sinMin = Math.min(Math.sin(dmin * DEG), Math.sin(Math.min(dmax, 180) * DEG));
        const room = (vis / dmin) ** 2;
        while (j + 1 < ladder.length) {
          const half = sinHalfSpan[j + 1] / sinMin;
          if (half >= 1 || 1 - half * half < room) break;
          j++;
        }
      }
      return j + 1;
    };
    const { arc, project } = this.projector();
    const pts = [];
    for (const [ring, tags, caps] of rings) {
      let pen = false, wrapped = false;
      pts.length = 0;
      const n = ring.length / 2;
      for (let k = 0, a = 0; a < n - 1; k++, a += CH) {
        const b = Math.min(a + CH, n - 1);
        const dc = arc(caps[3 * k], caps[3 * k + 1]), r = caps[3 * k + 2];
        const dmin = Math.max(0, dc - r), dmax = dc + r;
        // a ring reaching within 2 degrees of your antipode can't be filled; test every vertex, as before
        if (!wrapped && dmax > 178) {
          if (dmin > 178) wrapped = true;
          else for (let i = a; i <= b && !wrapped; i++) if (arc(ring[2 * i], ring[2 * i + 1]) > 178) wrapped = true;
        }
        const need = needFor(dmin, dmax, r);
        for (let i = a ? a + 1 : a; i <= b; i++) {
          if (need && level(tags.charCodeAt(i)) < need) continue;
          pts.push(project(ring[2 * i], ring[2 * i + 1]));
        }
      }
      // fill() closes each ring itself; an explicit closePath() costs Chrome time in proportion to the
      // whole path so far, which made this loop quadratic
      if (!wrapped) pts.forEach(([x, y], i) => (i ? fill.lineTo(x, y) : fill.moveTo(x, y)));
      for (const [x, y, c] of pts) {
        if (c > limit) { pen = false; continue; }
        if (pen) stroke.lineTo(x, y); else { stroke.moveTo(x, y); pen = true; }
      }
    }
    g.fillStyle = css('--land'); g.fill(fill, 'evenodd');
    g.strokeStyle = css('--coast'); g.lineWidth = Math.max(1, this.px / 400); g.stroke(stroke);
    // distance rings at quarter, half, three quarters of the way to the target
    g.strokeStyle = css('--grid'); g.setLineDash([4, 6]);
    for (const f of [0.25, 0.5, 0.75]) { g.beginPath(); g.arc(0, 0, this.mapR * f, 0, Math.PI * 2); g.stroke(); }
    g.restore();
    g.beginPath(); g.arc(0, 0, this.mapR, 0, Math.PI * 2);
    g.strokeStyle = css('--ink-2'); g.lineWidth = 2; g.setLineDash([]); g.stroke();
    return cv;
  }

  /** The base layer (sea, land, coast, distance rings), drawn once per origin, zoom, size and colours. */
  baseLayer() {
    const key = this.baseKey();
    if (this.base?.key !== key) {
      let cv = baseCache.get(key);
      if (cv) baseCache.delete(key);   // re-insert: most recently used last
      else cv = this.renderBase();
      baseCache.set(key, cv);
      while (baseCache.size > BASE_CACHE_MAX) baseCache.delete(baseCache.keys().next().value);
      this.base = { key, cv };
    }
    return this.base.cv;
  }

  draw() {
    const base = this.baseLayer();
    const g = this.canvas.getContext('2d');
    const R = this.R, rot = this.headingUp == null ? 0 : -this.headingUp * DEG;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.px, this.px);
    g.translate(R, R);
    g.save();
    g.rotate(rot);
    g.drawImage(base, -R, -R);
    this.drawCompass(g);
    // target on the edge, in its true direction
    const ta = this.truth.az * DEG;
    const tx = Math.sin(ta) * this.mapR, ty = -Math.cos(ta) * this.mapR;
    g.fillStyle = css('--good');
    g.beginPath(); g.arc(tx, ty, this.px / 40, 0, Math.PI * 2); g.fill();
    g.strokeStyle = css('--bg'); g.lineWidth = 2; g.stroke();
    // label just inside the edge, so it never collides with the compass letters outside
    this.label(g, this.targetName, tx * 0.8, ty * 0.8, rot);
    // centre (you)
    g.fillStyle = css('--ink'); g.beginPath(); g.arc(0, 0, this.px / 70, 0, Math.PI * 2); g.fill();
    if (this.guess) this.marker(g, this.guess, css('--ink'), true);
    if (this.pointer) this.marker(g, this.pointer, css('--bad'), false);
    g.restore();
    if (this.headingUp != null) {   // fixed "you are facing" notch at the top
      g.fillStyle = css('--bad');
      g.beginPath(); g.moveTo(0, -R + 2); g.lineTo(-R * 0.05, -R + R * 0.11); g.lineTo(R * 0.05, -R + R * 0.11); g.closePath(); g.fill();
    }
  }

  marker(g, { az, el }, colour, cross) {
    const p = this.directionToXY(az, el);
    const s = this.px / 34;
    g.strokeStyle = colour; g.fillStyle = colour; g.lineWidth = Math.max(2, this.px / 150);
    // line from you towards it, so the direction reads even when the exit point is off the map
    g.globalAlpha = 0.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(p.x, p.y); g.stroke(); g.globalAlpha = 1;
    if (cross) {
      g.beginPath(); g.moveTo(p.x - s, p.y - s); g.lineTo(p.x + s, p.y + s); g.moveTo(p.x + s, p.y - s); g.lineTo(p.x - s, p.y + s); g.stroke();
    } else {
      g.beginPath(); g.arc(p.x, p.y, s * 0.8, 0, Math.PI * 2);
      if (p.clipped) g.stroke(); else g.fill();
    }
  }

  label(g, text, x, y, rot) {
    g.save();
    g.translate(x, y); g.rotate(-rot);
    g.font = `600 ${Math.round(this.px / 26)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.lineWidth = 4; g.strokeStyle = css('--bg'); g.fillStyle = css('--good');
    g.textBaseline = 'middle';
    g.strokeText(text, 0, 0); g.fillText(text, 0, 0);
    g.restore();
  }

  drawCompass(g) {
    const R = this.R, inner = this.mapR + R * 0.03;
    g.strokeStyle = css('--ink-2'); g.fillStyle = css('--ink');
    g.lineWidth = 1;
    for (let d = 0; d < 360; d += 10) {
      const a = d * DEG, len = d % 90 === 0 ? R * 0.07 : d % 30 === 0 ? R * 0.045 : R * 0.025;
      g.beginPath();
      g.moveTo(Math.sin(a) * inner, -Math.cos(a) * inner);
      g.lineTo(Math.sin(a) * (inner + len), -Math.cos(a) * (inner + len));
      g.stroke();
    }
    g.font = `700 ${Math.round(R / 9)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [d, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
      const a = d * DEG, r = R * 0.94;
      g.save(); g.translate(Math.sin(a) * r, -Math.cos(a) * r);
      g.rotate(this.headingUp == null ? 0 : this.headingUp * DEG);
      g.fillStyle = d === 0 ? css('--bad') : css('--ink');
      g.fillText(t, 0, 0); g.restore();
    }
  }

  /** Compass azimuth of a point on the canvas (CSS px), for drag-to-sweep in map mode. */
  azimuthAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left - r.width / 2, y = clientY - r.top - r.height / 2;
    return wrap360(Math.atan2(x, -y) / DEG + (this.headingUp ?? 0));
  }
}

/** Vertical up/down bar: horizon line, the target's true angle, the live tilt and the locked guess. */
export class TiltBar {
  constructor(canvas, { trueEl }) {
    this.canvas = canvas;
    this.trueEl = trueEl;
    this.top = 45; this.bottom = -90;
    this.live = null; this.guess = null;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round((this.canvas.clientWidth || 70) * dpr);
    this.canvas.height = Math.round((this.canvas.clientHeight || 300) * dpr);
  }

  y(el) {
    const h = this.canvas.height, pad = h * 0.05;
    const t = (this.top - Math.max(this.bottom, Math.min(this.top, el))) / (this.top - this.bottom);
    return pad + t * (h - 2 * pad);
  }

  elAt(clientY) {
    const r = this.canvas.getBoundingClientRect();
    const h = r.height, pad = h * 0.05;
    const t = (clientY - r.top - pad) / (h - 2 * pad);
    return Math.max(-90, Math.min(90, this.top - t * (this.top - this.bottom)));
  }

  draw() {
    const g = this.canvas.getContext('2d');
    const w = this.canvas.width, h = this.canvas.height, bx = w * 0.3, bw = w * 0.4;
    g.clearRect(0, 0, w, h);
    const sky = g.createLinearGradient(0, this.y(this.top), 0, this.y(0));
    sky.addColorStop(0, css('--sky')); sky.addColorStop(1, css('--sky-2'));
    g.fillStyle = sky; g.fillRect(bx, this.y(this.top), bw, this.y(0) - this.y(this.top));
    const earth = g.createLinearGradient(0, this.y(0), 0, this.y(this.bottom));
    earth.addColorStop(0, css('--earth')); earth.addColorStop(1, css('--core'));
    g.fillStyle = earth; g.fillRect(bx, this.y(0), bw, this.y(this.bottom) - this.y(0));
    g.font = `${Math.round(w / 6)}px system-ui, sans-serif`; g.fillStyle = css('--ink-2'); g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const d of [30, 0, -30, -60, -90]) {
      g.fillText(`${Math.abs(d)}°`, bx - 4, this.y(d));   // sky above, earth below: no minus signs to clip
      g.fillRect(bx, this.y(d), bw * 0.2, 1);
    }
    g.fillStyle = css('--ink'); g.fillRect(bx - 2, this.y(0) - 1, bw + 4, 2);
    const mark = (el, colour, width, label) => {
      const yy = this.y(el);
      g.fillStyle = colour; g.fillRect(bx - w * 0.08, yy - width / 2, bw + w * 0.16, width);
      if (label) { g.textAlign = 'left'; g.fillText(label, bx + bw + w * 0.1, yy); g.textAlign = 'right'; }
    };
    mark(this.trueEl, css('--good'), Math.max(3, h / 90), '');
    if (this.guess != null) mark(this.guess, css('--ink'), Math.max(2, h / 140), '');
    if (this.live != null) mark(this.live, css('--bad'), Math.max(3, h / 100), '');
  }
}
