// Map mode: a satellite view of the player's surroundings (north up) with a 3D arrow they turn by
// dragging and tilt with a separate slider. The view covers only the local area (about 150 km), so it
// never shows the target or where the arrow would come out of the Earth.
//
// PRIVACY: the imagery tiles are fetched from EOX for the area around the origin, so EOX's servers learn
// which ~50 km tiles were viewed. That is the only location-related request the site makes; the README
// says so. Coordinates themselves are never sent anywhere.
import * as THREE from '../vendor/three/three.module.min.js';
import { DEG, fromAzEl, wrap360 } from './geo.js';

export const IMAGERY = {
  zoom: 9,
  url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${z}/${y}/${x}.jpg`,
  attribution: 'Imagery: <a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0',
};

const TILE = 256, GRID = 4;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Fractional Web Mercator tile coordinates. */
export function tileXY(lat, lon, z) {
  const n = 2 ** z, la = Math.max(-85, Math.min(85, lat)) * DEG;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n };
}

function textSprite(text, colour) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 84px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(text, 64, 68);
  g.fillStyle = colour; g.fillText(text, 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(70, 70, 1);
  s.renderOrder = 10;
  return s;
}

export class MapView {
  constructor(container, origin, { onChange } = {}) {
    this.container = container;
    this.origin = origin;
    this.az = 0; this.el = -20;
    this.onChange = onChange;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.canvas.setAttribute('aria-label', 'Map with a pointing arrow. Drag sideways or use the arrow keys to turn.');
    this.canvas.tabIndex = 0;
    container.prepend(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(css('--bg'));
    // world axes = East-North-Up, 1 unit = 1 map pixel
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0, -620, 560);
    this.camera.lookAt(0, -40, -60);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-200, -300, 600); this.scene.add(sun);

    this.buildGround();
    this.buildArrow();
    for (const [t, x, y, c] of [['N', 0, 470, css('--bad')], ['S', 0, -470, '#fff'], ['E', 470, 0, '#fff'], ['W', -470, 0, '#fff']]) {
      const s = textSprite(t, c); s.position.set(x, y, 10); this.scene.add(s);
    }
    this.installControls();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.update();
  }

  buildGround() {
    const size = TILE * GRID;
    const tex = document.createElement('canvas'); tex.width = tex.height = size;
    const g = tex.getContext('2d');
    g.fillStyle = '#2b3a2e'; g.fillRect(0, 0, size, size);
    // faint grid while tiles load (and if they don't)
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i <= size; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.moveTo(0, i); g.lineTo(size, i); g.stroke(); }
    this.texture = new THREE.CanvasTexture(tex);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const z = IMAGERY.zoom, t = tileXY(this.origin.lat, this.origin.lon, z);
    const x0 = Math.floor(t.x) - GRID / 2 + (t.x % 1 >= 0.5 ? 1 : 0);
    const y0 = Math.floor(t.y) - GRID / 2 + (t.y % 1 >= 0.5 ? 1 : 0);
    // the player's position inside the stitched image, in pixels from its top-left corner
    const px = (t.x - x0) * TILE, py = (t.y - y0) * TILE;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.78, depthWrite: false }));
    plane.position.set(size / 2 - px, py - size / 2, 0);
    plane.renderOrder = 1;
    this.scene.add(plane);
    this.tilesFailed = 0;
    const n = 2 ** z;
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { g.drawImage(img, i * TILE, j * TILE); this.texture.needsUpdate = true; this.render(); };
      img.onerror = () => { this.tilesFailed++; };
      img.src = IMAGERY.url(z, (((x0 + i) % n) + n) % n, Math.max(0, Math.min(n - 1, y0 + j)));
    }
    // "you are here" ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(9, 14, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(css('--you')), depthTest: false }));
    ring.position.z = 1; ring.renderOrder = 3;
    this.scene.add(ring);
  }

  buildArrow() {
    const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(css('--bad')), depthTest: false, emissive: 0x330000 });
    const under = new THREE.MeshPhongMaterial({ color: new THREE.Color(css('--bad')), depthTest: false, transparent: true, opacity: 0.55 });
    this.arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 210, 16), mat);
    shaft.position.y = 105;
    const head = new THREE.Mesh(new THREE.ConeGeometry(18, 50, 20), mat);
    head.position.y = 235;
    this.arrow.add(shaft, head);
    this.arrow.traverse((o) => { o.renderOrder = 6; });
    this.arrow.userData = { mat, under };
    this.scene.add(this.arrow);
    // shadow on the ground showing the compass direction
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(6, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthTest: false }));
    this.shadow.renderOrder = 2;
    this.scene.add(this.shadow);
    // a vertical drop line from the tip to the ground, so "how far down" reads in 3D
    this.drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 8, gapSize: 6, depthTest: false }));
    this.drop.renderOrder = 7;
    this.scene.add(this.drop);
  }

  installControls() {
    let last = null;
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => { last = e.clientX; el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true }); });
    el.addEventListener('pointermove', (e) => {
      if (last == null) return;
      this.setDirection(this.az + (e.clientX - last) * 0.35, this.el);
      last = e.clientX;
    });
    const up = () => { last = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 5 : 1;
      const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!k) return;
      e.preventDefault();
      this.setDirection(this.az + k[0], this.el + k[1]);
    });
  }

  setDirection(az, el) {
    this.az = wrap360(az);
    this.el = Math.max(-90, Math.min(90, el));
    this.update();
    this.onChange?.(this.az, this.el);
  }

  update() {
    const d = fromAzEl(this.az, this.el);
    const dir = new THREE.Vector3(d[0], d[1], d[2]);
    this.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const tip = dir.clone().multiplyScalar(260);
    const flat = Math.hypot(d[0], d[1]);
    this.shadow.scale.set(1, Math.max(1, 260 * flat), 1);
    this.shadow.position.set(tip.x / 2, tip.y / 2, 0.5);
    this.shadow.rotation.z = -this.az * DEG;
    this.drop.geometry.setFromPoints([tip, new THREE.Vector3(tip.x, tip.y, 0)]);
    this.drop.computeLineDistances();
    const below = this.el < 0;
    this.arrow.children.forEach((m) => { m.material = below ? this.arrow.userData.under : this.arrow.userData.mat; });
    this.render();
  }

  resize() {
    const w = this.container.clientWidth || 320, h = this.container.clientHeight || 320;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.ro.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
