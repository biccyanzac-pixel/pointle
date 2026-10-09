import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointingDirection, rotateAboutUp, HeadingOffset, rotationMatrix, topEdgeAzimuth, flatness } from '../site/js/orientation.js';
import { toAzEl, fromAzEl, wrap180 } from '../site/js/geo.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const azel = (...args) => toAzEl(pointingDirection(...args));

test('flat phone, top edge to north: top points north on the horizon, camera points straight down', () => {
  const top = azel(0, 0, 0, 'top');
  near(top.az, 0, 1e-9); near(top.el, 0, 1e-9);
  near(azel(0, 0, 0, 'camera').el, -90, 1e-9);
});

test('alpha is anticlockwise: compass heading of the top edge = 360 - alpha', () => {
  for (const alpha of [10, 90, 200, 300]) near(azel(alpha, 0, 0, 'top').az, (360 - alpha) % 360, 1e-9, `alpha ${alpha}`);
});

test('upright phone (beta = 90): camera points horizontally ahead, top edge points up', () => {
  const cam = azel(0, 90, 0, 'camera');
  near(cam.el, 0, 1e-9); near(cam.az, 0, 1e-9);
  near(azel(0, 90, 0, 'top').el, 90, 1e-9);
  // turned to face east (alpha = 270)
  near(azel(270, 90, 0, 'camera').az, 90, 1e-9);
});

test('tilting the top of an upright phone back aims the camera upward; forward aims it down', () => {
  near(azel(0, 120, 0, 'camera').el, 30, 1e-9);
  near(azel(0, 60, 0, 'camera').el, -30, 1e-9);
  // top-edge method: a phone tilted 30 deg nose-down from flat points 30 deg below the horizon
  near(azel(0, -30, 0, 'top').el, -30, 1e-9);
});

test('top edge follows screen rotation; camera does not', () => {
  // Screen rotated 90 (device turned anticlockwise, lying flat, alpha 0): the visual top is the
  // physical right edge, which points east.
  near(azel(0, 0, 0, 'top', 90).az, 90, 1e-9);
  near(azel(0, 0, 0, 'top', 270).az, 270, 1e-9);
  near(azel(0, 0, 0, 'top', 180).az, 180, 1e-9);
  const a = toAzEl(pointingDirection(30, 70, 10, 'camera', 0)), b = toAzEl(pointingDirection(30, 70, 10, 'camera', 90));
  near(a.az, b.az, 1e-9); near(a.el, b.el, 1e-9);
});

test('rotation matrix is orthonormal', () => {
  const R = rotationMatrix(37, -52, 81);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const d = R[0][i] * R[0][j] + R[1][i] * R[1][j] + R[2][i] * R[2][j];
    near(d, i === j ? 1 : 0, 1e-12);
  }
});

test('declination correction: magnetic azimuth + declination = true azimuth, elevation unchanged', () => {
  const v = rotateAboutUp(fromAzEl(100, -35), 12.5);
  const r = toAzEl(v);
  near(r.az, 112.5, 1e-9); near(r.el, -35, 1e-9);
  near(toAzEl(rotateAboutUp(fromAzEl(5, 10), -10)).az, 355, 1e-9);
});

test('iOS heading offset is learnt only while flat and maps the arbitrary frame to magnetic north', () => {
  const trueOffset = 73; // arbitrary alpha reference sits 73 deg away from magnetic north
  const off = new HeadingOffset();
  // upright readings are ignored
  assert.equal(off.update(10, 90, 0, 50), false);
  for (let i = 0; i < 30; i++) {
    const alpha = 40 + i, beta = (i % 5) - 2, gamma = (i % 3) - 1;
    const heading = (topEdgeAzimuth(alpha, beta, gamma) + trueOffset + (i % 2 ? 0.5 : -0.5) + 360) % 360;
    assert.ok(off.update(alpha, beta, gamma, heading));
  }
  assert.ok(off.ready);
  near(wrap180(off.value - trueOffset), 0, 0.3);
  // applying it to an upright camera direction gives the magnetic azimuth
  const v = rotateAboutUp(pointingDirection(10, 90, 0, 'camera'), off.value);
  near(wrap180(toAzEl(v).az - (350 + trueOffset)), 0, 0.3);
  assert.ok(flatness(0, 0, 0) > 0.99 && flatness(0, 90, 0) < 0.01);
});
