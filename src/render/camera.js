// Chase camera with mouse orbit, auto-recenter, speed FOV and screen shake.
import * as THREE from 'three';
import { clamp, damp, angleWrap } from '../core/math.js';

const _v = new THREE.Vector3(), _t = new THREE.Vector3();

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0; // offset from car heading
    this.pitch = 0.36;
    this.dist = 10;
    this.zoom = 1;
    this.idle = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.baseFov = 68;
    this.mode = 0; // 0 chase, 1 far, 2 hood
    this.initialized = false;
    this.aimDir = new THREE.Vector3(0, 0, 1);
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.0032;
    this.pitch = clamp(this.pitch + dy * 0.0026, -0.25, 1.25);
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.idle = 0;
  }

  update(dt, car, terrain, shake, opts = {}) {
    const b = car.body;
    const size = car.stats.size;
    const heading = Math.atan2(b.fwd.x, b.fwd.z);
    const speed = b.speed();
    this.idle += dt;
    // recenter behind the car when not aiming
    if (this.idle > 2.2 && !opts.aiming) this.yaw = damp(this.yaw, 0, 1.6, dt);
    this.yaw = angleWrap(this.yaw);
    const camYaw = heading + Math.PI + this.yaw;
    const zoomTarget = this.mode === 1 ? 1.8 : 1;
    this.zoom = damp(this.zoom, zoomTarget * (opts.zoom || 1), 4, dt);
    const dist = (this.dist + Math.sqrt(size) * 4.5 - 4 + Math.min(speed, 45) * 0.06) * this.zoom;
    const h = 2.2 + size * 1.4;
    _t.set(b.pos.x, b.pos.y + 1.2 + size * 0.9, b.pos.z);
    const tx = _t.x + Math.sin(camYaw) * Math.cos(this.pitch) * dist;
    const tz = _t.z + Math.cos(camYaw) * Math.cos(this.pitch) * dist;
    let ty = _t.y + Math.sin(this.pitch) * dist + h * 0.35;
    const gh = terrain.heightAt(tx, tz) + 1.5;
    if (ty < gh) ty = gh;
    if (!this.initialized) { this.pos.set(tx, ty, tz); this.look.copy(_t); this.initialized = true; }
    const k = 1 - Math.exp(-dt * 9);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.z += (tz - this.pos.z) * k;
    this.pos.y += (ty - this.pos.y) * (1 - Math.exp(-dt * 6));
    // look slightly ahead of the car
    _v.copy(b.vel).multiplyScalar(0.12);
    _v.y *= 0.3;
    const lookT = _t.add(_v);
    this.look.lerp(lookT, 1 - Math.exp(-dt * 12));
    const cam = this.camera;
    cam.position.copy(this.pos);
    if (shake > 0) {
      const s = shake * 0.6;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    if (this.mode === 2) {
      cam.position.copy(b.pos).addScaledVector(b.up, car.stats.chassis.hei + 0.8).addScaledVector(b.fwd, -0.4);
      _v.copy(b.pos).addScaledVector(b.fwd, 20).addScaledVector(b.up, 1);
      _v.applyAxisAngle(b.up, 0);
      cam.lookAt(_v.x + Math.sin(heading + this.yaw) * 0, _v.y, _v.z);
    } else cam.lookAt(this.look);
    const fov = this.baseFov + clamp((speed - 15) * 0.45, 0, 16) + (car.controls?.boost ? 6 : 0);
    cam.fov = damp(cam.fov, fov, 4, dt);
    cam.updateProjectionMatrix();
    cam.getWorldDirection(this.aimDir);
  }
}
