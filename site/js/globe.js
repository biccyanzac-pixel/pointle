// A small 3D globe: the straight line through the Earth from player to target, and the player's guess.
// Used on the reveal screen (and as the share picture) and in practice mode.
import * as THREE from '../vendor/three/three.module.min.js';
import { DEG, enuToEcef, normalize } from './geo.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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
    this.camera.position.set(0, 0, 4.4);
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
    for (const [r, c, o] of [[0.546, '--mantle', 0.25], [0.19, '--core', 0.6]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(css(c)), transparent: true, opacity: o, depthWrite: false }));
      m.renderOrder = 0; this.world.add(m);
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
    this.installDrag();
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

  dot(lat, lon, colour, size = 0.035) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), depthTest: false }));
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
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.008 * width, 6),
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
  show({ origin, target, guessEnu = null, stub = false, hideTarget = false, face = true }) {
    this.clearMarks();
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
      this.line(p, end, css('--bad'), 2.5);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(css('--bad')), depthTest: false }));
      cone.position.copy(end);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      cone.renderOrder = 6;
      this.marks.add(cone);
      this.guessEnd = end;
    }
    if (face) this.faceTowards(target && !hideTarget ? [p, spherePoint(target.lat, target.lon)] : [p]);
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

  installDrag() {
    let last = null;
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.01)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.01));
      this.world.quaternion.premultiply(q);
      this.render();
    });
    const up = () => { last = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  start() { if (!this.running) { this.running = true; requestAnimationFrame(this.loop); } }
  stop() { this.running = false; }
  loop() { if (!this.running) return; this.render(); requestAnimationFrame(this.loop); }

  dispose() { this.stop(); this.renderer.dispose(); }
}
