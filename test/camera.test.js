import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChaseCamera } from '../src/render/camera.js';

function rig() {
  const cam = new THREE.PerspectiveCamera(68, 16 / 9, 0.3, 4500);
  const chase = new ChaseCamera(cam);
  const body = { pos: new THREE.Vector3(0, 3, 0), fwd: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), vel: new THREE.Vector3(), speed() { return this.vel.length(); } };
  const car = { body, stats: { size: 1, chassis: { hei: 1 } }, controls: {} };
  return { cam, chase, body, car, terrain: { heightAt: () => 0 } };
}
const yawOf = (v) => Math.atan2(v.x, v.z);

test('mouse look responds on the next frame', () => {
  for (const fps of [30, 60, 144]) {
    const { chase, car, terrain } = rig();
    const dt = 1 / fps;
    for (let i = 0; i < fps; i++) chase.update(dt, car, terrain, 0, { aiming: true });
    const y0 = yawOf(chase.aimDir);
    chase.orbit(300, 0);
    chase.update(dt, car, terrain, 0, { aiming: true });
    const y1 = yawOf(chase.aimDir);
    for (let i = 0; i < fps; i++) chase.update(dt, car, terrain, 0, { aiming: true });
    const y2 = yawOf(chase.aimDir);
    assert.ok(Math.abs((y1 - y0) / (y2 - y0)) > 0.95, `${fps} fps: only ${(((y1 - y0) / (y2 - y0)) * 100).toFixed(0)}% of the turn showed on the first frame`);
  }
});

test('following a car through a fast curve stays smooth', () => {
  const { cam, chase, body, car, terrain } = rig();
  const dt = 1 / 60;
  let prevStep = null, worst = 0;
  for (let i = 0; i < 600; i++) {
    const t = i * dt, a = t * 0.8; // 30 m/s round a 37 m radius bend
    body.pos.set(Math.sin(a) * 37.5, 3, Math.cos(a) * 37.5);
    body.fwd.set(Math.cos(a), 0, -Math.sin(a));
    body.vel.copy(body.fwd).multiplyScalar(30);
    const before = cam.position.clone();
    chase.update(dt, car, terrain, 0, {});
    const step = cam.position.clone().sub(before);
    if (i > 120 && prevStep) worst = Math.max(worst, step.clone().sub(prevStep).length());
    prevStep = step;
  }
  // frame-to-frame change of camera velocity: a hitch would show as a jump here
  assert.ok(worst < 0.05, `camera jerk ${worst.toFixed(3)} m per frame²`);
});
