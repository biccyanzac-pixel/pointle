// On-screen compass dial (SVG) and tilt gauge. The rose turns so that the direction you're pointing is
// always at the top marker, like a phone's compass app: north on the dial points to real north.
import { wrap360 } from './geo.js';

const NS = 'http://www.w3.org/2000/svg';
const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const cardinal = (az) => CARD[Math.round(wrap360(az) / 22.5) % 16];

function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

export class Compass {
  /** size: 'big' (phone play screen) or 'small' (map overlay). */
  constructor(container, { size = 'big' } = {}) {
    this.root = svg('svg', { viewBox: '-110 -110 220 220', class: `compass compass-${size}`, role: 'img', 'aria-label': 'Compass' });
    container.append(this.root);
    svg('circle', { r: 104, class: 'cmp-bezel' }, this.root);
    this.rose = svg('g', { class: 'cmp-rose' }, this.root);
    for (let d = 0; d < 360; d += 5) {
      const major = d % 30 === 0;
      svg('line', { x1: 0, y1: -98, x2: 0, y2: major ? -84 : d % 10 === 0 ? -89 : -93, class: major ? 'cmp-tick major' : 'cmp-tick', transform: `rotate(${d})` }, this.rose);
    }
    for (const [d, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [45, 'NE'], [135, 'SE'], [225, 'SW'], [315, 'NW']]) {
      const g = svg('g', { transform: `rotate(${d}) translate(0 -68)` }, this.rose);
      const txt = svg('text', { class: `cmp-label${t.length > 1 ? ' minor' : ''}${t === 'N' ? ' north' : ''}`, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      txt.textContent = t;
      this[`lbl${d}`] = g;
    }
    // north needle on the rose
    svg('path', { d: 'M0 -50 L7 -30 L-7 -30 Z', class: 'cmp-needle' }, this.rose);
    // fixed "you're pointing here" marker at the top
    svg('path', { d: 'M0 -108 L9 -94 L-9 -94 Z', class: 'cmp-lubber' }, this.root);
    this.deg = svg('text', { y: -2, class: 'cmp-deg', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, this.root);
    this.card = svg('text', { y: 26, class: 'cmp-card', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, this.root);
    this.rot = 0;
    this.set(null);
  }

  /** heading in degrees (null = unknown / pointing straight up or down). */
  set(heading) {
    if (heading == null) {
      this.deg.textContent = '—';
      this.card.textContent = '';
      return;
    }
    // unwrap so the rose turns the short way round
    const target = -heading;
    this.rot += ((((target - this.rot) % 360) + 540) % 360) - 180;
    this.rose.setAttribute('transform', `rotate(${this.rot})`);
    // keep letters upright
    for (const d of [0, 45, 90, 135, 180, 225, 270, 315]) {
      this[`lbl${d}`].firstChild.setAttribute('transform', `rotate(${-(this.rot + d)})`);
    }
    this.deg.textContent = `${Math.round(wrap360(heading))}°`;
    this.card.textContent = cardinal(heading);
  }
}

/** Vertical tilt gauge: horizon in the middle, +90 at the top, -90 at the bottom. */
export class TiltGauge {
  constructor(container) {
    this.root = svg('svg', { viewBox: '0 0 60 220', class: 'tilt-gauge', role: 'img', 'aria-label': 'Tilt' });
    container.append(this.root);
    svg('rect', { x: 20, y: 10, width: 20, height: 100, rx: 4, class: 'tg-sky' }, this.root);
    svg('rect', { x: 20, y: 110, width: 20, height: 100, rx: 4, class: 'tg-earth' }, this.root);
    for (const d of [90, 45, 0, -45, -90]) {
      const y = 110 - (d / 90) * 100;
      svg('line', { x1: 14, x2: 20, y1: y, y2: y, class: 'tg-tick' }, this.root);
    }
    svg('line', { x1: 12, x2: 48, y1: 110, y2: 110, class: 'tg-horizon' }, this.root);
    this.mark = svg('path', { d: 'M8 0 L52 0 L46 -6 M52 0 L46 6', class: 'tg-mark' }, this.root);
    this.set(0);
  }

  set(el) {
    const y = 110 - (Math.max(-90, Math.min(90, el)) / 90) * 100;
    this.mark.setAttribute('transform', `translate(0 ${y})`);
  }
}
