// Optional AR view (after a reveal): the back camera's live picture with a 3D beam overlaid along the true
// direction to the target. Uses three.js and the orientation sensors only (no WebXR). The camera picture
// is shown on screen and never recorded or sent.
import * as THREE from '../vendor/three/three.module.min.js';
import { rotationMatrix, rotateAboutUp } from './orientation.js';
import { DEG } from './geo.js';
import { screenAngle } from './sensors.js';

export class ArView {
  /** sensor: a running SensorPointer (gives the north offset); trueDir: ENU unit vector; label: target name. */
  constructor(root, { sensor, trueDir, label }) {
    this.root = root;
    this.sensor = sensor;
    this.trueDir = trueDir;
    this.video = root.querySelector('video');
    this.canvas = root.querySelector('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 500);  // typical phone camera vertical FOV
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const d = new THREE.Vector3(...trueDir);
    // the beam starts at the ground below the player (about 1.4 m below the phone) and runs into the Earth
    const start = new THREE.Vector3(0, 0, -1.4);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 60, 12), new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.85 }));
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    beam.position.copy(start).addScaledVector(d, 30);
    this.scene.add(beam);
    for (let i = 1; i <= 12; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 16), new THREE.MeshBasicMaterial({ color: 0x3ddc97 }));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      cone.position.copy(start).addScaledVector(d, i * 1.5);
      this.scene.add(cone);
    }
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.font = '700 56px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(label, 256, 64); g.fillStyle = '#fff'; g.fillText(label, 256, 64);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.copy(start).addScaledVector(d, 4).add(new THREE.Vector3(0, 0, 0.3));
    this.scene.add(sprite);
    this.loop = this.loop.bind(this);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  loop() {
    if (!this.running) return;
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const last = this.sensor.last;
    if (last) {
      // Camera axes = device axes, turned to match the screen rotation; then rotated onto true north.
      const R = rotationMatrix(last.alpha, last.beta, last.gamma);
      const t = screenAngle() * DEG;
      const north = this.sensor.kind === 'ios' ? this.sensor.offset.value + this.sensor.decl : this.sensor.decl;
      const axis = (v) => rotateAboutUp([
        R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
        R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
        R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
      ], north);
      const x = axis([Math.cos(t), -Math.sin(t), 0]), y = axis([Math.sin(t), Math.cos(t), 0]), z = axis([0, 0, 1]);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
      this.camera.quaternion.setFromRotationMatrix(m);
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.renderer.dispose();
  }
}
