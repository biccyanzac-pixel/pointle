// A small 3D globe: the straight line through the Earth from player to target, and the player's guess.
// Used on the reveal screen (and as the share picture) and in practice mode.
import * as THREE from '../vendor/three/three.module.min.js';
import { DEG, enuToEcef, normalize } from './geo.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Zoom limits, as camera distance from the Earth's centre (radius 1). The default view is the furthest out:
// you can zoom in towards the surface but never shrink the world below its starting size.
const FAR = 4.4, NEAR = 1.3;

/** Unit-sphere position in three.js axes (y up = north pole). */
export function spherePoint(lat, lon, r = 1) {
  const cl = Math.cos(lat * DEG);
  return new THREE.Vector3(cl * Math.cos(lon * DEG) * r, Math.sin(lat * DEG) * r, -cl * Math.sin(lon * DEG) * r);
}

/** ENU direction at (lat, lon) -> three.js world direction. */
export function enuToWorld(v, lat, lon) {
  const e = normalize(enuToEcef(v, lat, lon));
  return new THREE.Vector3(e[0], e[2], -e[1]);
}

/** Distance along a ray from a point on (or in) the unit sphere to where it leaves the sphere. */
function exitDistance(p, d) {
  const b = p.dot(d), c = p.lengthSq() - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b + Math.sqrt(disc);
  return t > 1e-6 ? t : null;
}

export class Globe {
  constructor(canvas, rings) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.dist = FAR;
    this.camera.position.set(0, 0, FAR);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 2, 4); this.scene.add(sun);

    const sea = new THREE.Mesh(new THREE.SphereGeometry(0.995, 64, 48), new THREE.MeshPhongMaterial({
      color: new THREE.Color(css('--sea')), transparent: true, opacity: 0.45, depthWrite: false, shininess: 20,
    }));
    sea.renderOrder = 1;
    this.world.add(sea);
    // core layers, so the tunnel's depth reads at a glance
    this.layers = [];
    for (const [r, c, o] of [[0.546, '--mantle', 0.25], [0.19, '--core', 0.6]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(css(c)), transparent: true, opacity: o, depthWrite: false }));
      m.renderOrder = 0; this.world.add(m);
      this.layers.push([m, o]);
    }
    const pos = [];
    for (const ring of rings) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const a = spherePoint(ring[i + 1], ring[i], 1.001), b = spherePoint(ring[i + 3], ring[i + 2], 1.001);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.coast = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(css('--coast-globe')), transparent: true, opacity: 0.9 }));
    this.coast.renderOrder = 2;
    this.world.add(this.coast);
    this.marks = new THREE.Group();
    this.world.add(this.marks);
    this.live = new THREE.Group();   // the arrow that follows the player after the guess
    this.world.add(this.live);
    this.installDrag();
    this.addZoomButtons();
    this.resize();
    this.loop = this.loop.bind(this);
    this.running = false;
  }

  resize() {
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || w;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clearMarks() {
    for (const c of [...this.marks.children]) { this.marks.remove(c); c.geometry?.dispose(); }
  }

  /** Marker scale for the current zoom, so dots and lines keep about the same size on screen. */
  get k() { return Math.max(0.2, ((this.dist - 1) / (FAR - 1)) ** 0.85); }

  dot(lat, lon, colour, size = 0.035) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size * this.k, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), depthTest: false }));
    m.position.copy(spherePoint(lat, lon, 1.0));
    m.renderOrder = 5;
    this.marks.add(m);
    return m;
  }

  line(a, b, colour, width = 1, dashed = false) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color: new THREE.Color(colour), dashSize: 0.05, gapSize: 0.03, depthTest: false })
      : new THREE.LineBasicMaterial({ color: new THREE.Color(colour), depthTest: false, linewidth: width });
    const l = new THREE.Line(g, mat);
    if (dashed) l.computeLineDistances();
    l.renderOrder = 4;
    this.marks.add(l);
    // a thin tube too: WebGL ignores linewidth on most devices
    if (width > 1) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.008 * width * this.k, 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), depthTest: false }));
      tube.renderOrder = 4;
      this.marks.add(tube);
    }
    return l;
  }

  /**
   * Draw the scene. origin/target: {lat, lon}. guessEnu: ENU unit vector (or null).
   * opts.stub: draw the guess as a short arrow only (practice before playing: never shows where it exits).
   * opts.hideTarget: don't draw the target or the true line.
   */
  show(opts) {
    const { origin, target, guessEnu = null, stub = false, hideTarget = false, face = true, guessColour = '--bad' } = opts;
    this.lastShow = { ...opts, face: false };
    this.clearMarks();
    this.origin = origin;
    const p = spherePoint(origin.lat, origin.lon);
    this.dot(origin.lat, origin.lon, css('--you'));
    if (target && !hideTarget) {
      const q = spherePoint(target.lat, target.lon);
      this.dot(target.lat, target.lon, css('--good'));
      this.line(p, q, css('--good'), 3);
    }
    if (guessEnu) {
      const d = enuToWorld(guessEnu, origin.lat, origin.lon);
      const t = stub ? 0.35 : exitDistance(p, d) ?? 0.4;
      const end = p.clone().addScaledVector(d, t);
      this.line(p, end, css(guessColour), 2.5);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03 * this.k, 0.08 * this.k, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(css(guessColour)), depthTest: false }));
      cone.position.copy(end);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      cone.renderOrder = 6;
      this.marks.add(cone);
      this.guessEnd = end;
    }
    if (face) this.setZoom(FAR);
    if (face) this.faceTowards(target && !hideTarget ? [p, spherePoint(target.lat, target.lon)] : [p]);
    this.render();
  }

  /**
   * Live arrow from the origin along an ENU direction (phone pointing, or the swept direction in map mode).
   * Doesn't move the camera, so the player can keep spinning the globe while it updates.
   */
  setLive(enu, colour = '--bad') {
    this.lastLive = [enu, colour];
    for (const c of [...this.live.children]) { this.live.remove(c); c.geometry?.dispose(); }
    if (!enu || !this.origin) { this.render(); return; }
    const p = spherePoint(this.origin.lat, this.origin.lon);
    const d = enuToWorld(enu, this.origin.lat, this.origin.lon);
    const t = exitDistance(p, d) ?? 0.4;
    const end = p.clone().addScaledVector(d, t);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(css(colour)), depthTest: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(p, end), 1, 0.014 * this.k, 8), mat);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.04 * this.k, 0.11 * this.k, 14), mat);
    cone.position.copy(end);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    for (const m of [tube, cone]) { m.renderOrder = 7; this.live.add(m); }
    this.render();
  }

  /** Rotate the globe so the given points face the camera (their mean, or a side view of the line). */
  faceTowards(points) {
    const m = new THREE.Vector3();
    points.forEach((v) => m.add(v));
    if (m.length() < 0.3 && points.length === 2) {
      // nearly antipodal: look at the line side-on
      m.crossVectors(points[0], new THREE.Vector3(0, 1, 0));
      if (m.length() < 0.1) m.set(1, 0, 0);
    }
    m.normalize();
    // tilt a little so the line isn't edge-on: view from slightly above the plane containing the points
    const q = new THREE.Quaternion().setFromUnitVectors(m, new THREE.Vector3(0, 0, 1));
    this.world.quaternion.copy(q);
    // keep north roughly up
    const north = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const roll = Math.atan2(north.x, north.y);
    this.world.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  }

  /** Zoom to a camera distance (clamped between the default view and close to the surface). */
  setZoom(dist) {
    const before = this.dist;
    this.dist = Math.min(FAR, Math.max(NEAR, dist));
    this.camera.position.set(0, 0, this.dist);
    // the see-through core and mantle help at a glance but muddy a close-up: fade them as you zoom in
    for (const [m, o] of this.layers ?? []) m.material.opacity = o * Math.min(1, ((this.dist - 1) / (FAR - 1)) * 1.6) ** 1.5;
    // rebuild the markers at the new scale (cheap: a handful of meshes)
    if (Math.abs(before - this.dist) > 1e-9 && this.lastShow && !this.rebuilding) {
      this.rebuilding = true;
      this.show(this.lastShow);
      if (this.lastLive) this.setLive(...this.lastLive);
      this.rebuilding = false;
    }
    this.render();
    if (this.zoomOut) {
      this.zoomOut.disabled = this.dist >= FAR - 1e-6;
      this.zoomIn.disabled = this.dist <= NEAR + 1e-6;
    }
  }

  /** Zoom by a factor of the distance to the surface (so steps feel even near the ground). */
  zoomBy(f) {
    this.setZoom(1 + (this.dist - 1) * f);
  }

  /** Latitude/longitude of the globe's surface under a screen point, or null if it misses the Earth. */
  latLonAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
    if (!hit) return null;
    const p = this.world.worldToLocal(hit).normalize();   // back into spherePoint() coordinates
    return { lat: Math.asin(p.y) / DEG, lon: Math.atan2(-p.z, p.x) / DEG };
  }

  /**
   * Drag to spin; pinch (two fingers) or the mouse wheel to zoom.
   * A click or tap that doesn't drag calls this.onPick({ lat, lon }) with the spot clicked, if set.
   */
  installDrag() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    const pts = new Map();
    let pinch = null, press = null;   // press: where a single-pointer press started, until it becomes a drag
    const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      press = pts.size === 1 ? { x: e.clientX, y: e.clientY } : null;
      if (pts.size === 2) pinch = { d: spread(), dist: this.dist };
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press = null;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size >= 2 && pinch) {
        const d = spread();
        if (d > 0) this.setZoom(1 + (pinch.dist - 1) * (pinch.d / d));
        return;
      }
      // spin slower when zoomed in, so the surface under your finger moves about as fast as your finger
      const k = 0.01 * ((this.dist - 1) / (FAR - 1)) ** 0.8;
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * k)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * k));
      this.world.quaternion.premultiply(q);
      this.render();
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    el.addEventListener('pointerup', (e) => {
      const click = press && pts.size === 1;
      up(e);
      press = null;
      if (!click || !this.onPick) return;
      const ll = this.latLonAt(e.clientX, e.clientY);
      if (ll) this.onPick(ll);
    });
    el.addEventListener('pointercancel', (e) => { press = null; up(e); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
  }

  /** Semi-transparent + / − buttons in the corner (shown on phones too). */
  addZoomButtons() {
    const c = this.canvas;
    let wrap = c.parentElement;
    if (!wrap.classList.contains('globe-wrap')) {
      wrap = document.createElement('div');
      wrap.className = 'globe-wrap';
      c.replaceWith(wrap);
      wrap.append(c);
    }
    const box = document.createElement('div');
    box.className = 'globe-zoom';
    const btn = (label, aria, f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', () => this.zoomBy(f));
      box.append(b);
      return b;
    };
    this.zoomIn = btn('+', 'Zoom in', 0.6);
    this.zoomOut = btn('−', 'Zoom out', 1 / 0.6);
    wrap.append(box);
    this.setZoom(this.dist);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  start() { if (!this.running) { this.running = true; requestAnimationFrame(this.loop); } }
  stop() { this.running = false; }
  loop() { if (!this.running) return; this.render(); requestAnimationFrame(this.loop); }

  dispose() { this.stop(); this.renderer.dispose(); }
}
