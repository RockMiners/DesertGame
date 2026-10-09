// Cartoon particle effects: puffy dust/smoke balls, fire, sparks, debris, beams, lightning, floating text.
import * as THREE from 'three';
import { gradientMap } from './toon.js';
import { markRange } from './perf.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const SPIN_AXIS = new THREE.Vector3(0.3, 1, 0.2).normalize(), FWD = new THREE.Vector3(0, 0, 1);

class Pool {
  constructor(scene, geo, mat, cap) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.cap = cap;
    this.parts = [];
    scene.add(this.mesh);
  }
  add(p) {
    if (this.parts.length >= this.cap) this.parts.shift();
    this.parts.push(p);
    return p;
  }
  update(dt, terrain) {
    const parts = this.parts;
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      parts[n] = p; // compact in place (n <= i)
      const t = p.age / p.life;
      p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; p.vz *= 1 - p.drag * dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.bounce && terrain) {
        const g = terrain.heightAt(p.x, p.z);
        if (p.y < g + p.size * 0.5) { p.y = g + p.size * 0.5; p.vy = Math.abs(p.vy) * 0.4; p.vx *= 0.7; p.vz *= 0.7; }
      }
      // grow then shrink (cartoon fade)
      const grow = p.grow ?? 1;
      const sc = p.size * (t < 0.25 ? 0.4 + (t / 0.25) * (grow - 0.4) : grow * (1 - (t - 0.25) / 0.75));
      p.rx += p.spin * dt;
      if (p.stretch) {
        _s.set(sc * 0.35, sc * 0.35, sc * p.stretch);
        _q.setFromUnitVectors(FWD, _v2.set(p.vx, p.vy, p.vz).normalize());
      } else { _q.setFromAxisAngle(SPIN_AXIS, p.rx); _s.set(sc, sc, sc); }
      _m.compose(_v.set(p.x, p.y, p.z), _q, _s);
      this.mesh.setMatrixAt(n, _m);
      _c.setRGB(p.r, p.g, p.b);
      if (p.r2 !== undefined) _c.lerp(_c2.setRGB(p.r2, p.g2, p.b2), t);
      this.mesh.setColorAt(n, _c);
      n++;
    }
    parts.length = n;
    this.mesh.count = n;
    // upload only the live instances
    markRange(this.mesh.instanceMatrix, 0, n * 16);
    if (this.mesh.instanceColor) markRange(this.mesh.instanceColor, 0, n * 3);
  }
}

function P(x, y, z, o) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, drag: 1.5, grav: 0, spin: 0, rx: Math.random() * 6, r: 1, g: 1, b: 1, ...o };
}

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    const lit = new THREE.MeshToonMaterial({ gradientMap: gradientMap(), color: 0xffffff });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const add = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.puffs = new Pool(scene, puffGeo, lit, 2500);
    this.glows = new Pool(scene, puffGeo, glow, 1200);
    this.sparks = new Pool(scene, new THREE.BoxGeometry(1, 1, 1), add, 900);
    this.debris = new Pool(scene, new THREE.BoxGeometry(1, 1, 1), lit.clone(), 500);
    // beams (lasers) & bolts (tesla) as dynamic line segments drawn fresh each frame
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.beamGeo.translate(0, 0.5, 0); this.beamGeo.rotateX(Math.PI / 2);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.beams = new THREE.InstancedMesh(this.beamGeo, this.beamMat, 64);
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    scene.add(this.beams);
    this.beamList = [];
    this.boltGeo = new THREE.BufferGeometry();
    this.boltPos = new Float32Array(4000 * 3);
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3));
    this.bolts = new THREE.LineSegments(this.boltGeo, new THREE.LineBasicMaterial({ color: 0xbde9ff, toneMapped: false }));
    this.bolts.frustumCulled = false;
    scene.add(this.bolts);
    this.boltList = [];
    this.texts = [];
    this.terrain = null;
    this.shake = 0;
    this.quality = 1;
  }

  hexRGB(hex) { _c.set(hex); return { r: _c.r, g: _c.g, b: _c.b }; }

  dust(x, y, z, color, amount = 1, vel) {
    if (Math.random() > this.quality) return;
    const c = this.hexRGB(color);
    const p = this.puffs.add(P(x, y, z, { ...c, size: (0.3 + Math.random() * 0.45) * amount, life: 0.7 + Math.random() * 0.7, drag: 2.5, grav: 1.0, spin: 1 }));
    p.vx = (Math.random() - 0.5) * 2 + (vel ? vel.x * 0.15 : 0);
    p.vy = 0.8 + Math.random() * 1.5;
    p.vz = (Math.random() - 0.5) * 2 + (vel ? vel.z * 0.15 : 0);
  }

  smoke(x, y, z, dark = 0.3, size = 1.2) {
    const p = this.puffs.add(P(x, y, z, { r: dark, g: dark, b: dark + 0.02, size: size * (0.7 + Math.random() * 0.6), life: 1.4 + Math.random(), drag: 1, grav: 2.5, spin: 0.6 }));
    p.vx = (Math.random() - 0.5); p.vz = (Math.random() - 0.5); p.vy = 1;
  }

  fire(x, y, z, size = 1) {
    const p = this.glows.add(P(x, y, z, { r: 1, g: 0.85, b: 0.3, r2: 1, g2: 0.3, b2: 0.05, size: size * (0.5 + Math.random() * 0.5), life: 0.45 + Math.random() * 0.3, drag: 2, grav: 4, spin: 3 }));
    p.vx = (Math.random() - 0.5) * 1.5; p.vz = (Math.random() - 0.5) * 1.5; p.vy = 1.5;
  }

  flame(x, y, z, vx, vy, vz) {
    const p = this.glows.add(P(x, y, z, { r: 1, g: 0.9, b: 0.4, r2: 1, g2: 0.25, b2: 0.05, size: 0.5 + Math.random() * 0.4, life: 0.5, drag: 1.8, grav: 2, spin: 4, grow: 2.2 }));
    p.vx = vx; p.vy = vy; p.vz = vz;
  }

  muzzle(x, y, z, dir, color = 0xffe08a, size = 0.6) {
    const c = this.hexRGB(color);
    const p = this.glows.add(P(x + dir.x * 0.3, y + dir.y * 0.3, z + dir.z * 0.3, { ...c, size, life: 0.06, drag: 0 }));
    p.vx = dir.x * 2; p.vy = dir.y * 2; p.vz = dir.z * 2;
  }

  sparkBurst(x, y, z, n = 8, color = 0xffd27a, speed = 9) {
    const c = this.hexRGB(color);
    for (let i = 0; i < n * this.quality; i++) {
      const p = this.sparks.add(P(x, y, z, { ...c, size: 0.18, life: 0.25 + Math.random() * 0.25, drag: 2, grav: -12, stretch: 4 }));
      p.vx = (Math.random() - 0.5) * speed * 2; p.vy = Math.random() * speed; p.vz = (Math.random() - 0.5) * speed * 2;
    }
  }

  explosion(x, y, z, size = 1) {
    this.shakeAt(x, y, z, size * 0.8);
    this.glows.add(P(x, y + 0.5, z, { r: 1, g: 1, b: 0.85, size: 3.2 * size, life: 0.18, drag: 0, grow: 1.6 }));
    for (let i = 0; i < 14 * size * this.quality + 4; i++) {
      const p = this.glows.add(P(x, y + 0.5, z, { r: 1, g: 0.9, b: 0.35, r2: 1, g2: 0.35, b2: 0.08, size: (1.1 + Math.random() * 1.4) * size, life: 0.35 + Math.random() * 0.35, drag: 4, grav: 3, spin: 2 }));
      const a = Math.random() * Math.PI * 2, s = (4 + Math.random() * 8) * size;
      p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = 2 + Math.random() * 7 * size;
    }
    for (let i = 0; i < 12 * size * this.quality + 3; i++) {
      const d = 0.22 + Math.random() * 0.15;
      const p = this.puffs.add(P(x, y + 1, z, { r: d, g: d, b: d, size: (1.4 + Math.random() * 1.6) * size, life: 1.6 + Math.random() * 1.2, drag: 2.5, grav: 2.5, spin: 1 }));
      const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 5) * size;
      p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = 2 + Math.random() * 4;
    }
    this.sparkBurst(x, y + 0.5, z, 14 * size, 0xffc04a, 14 * Math.sqrt(size));
  }

  wreckDebris(x, y, z, color, n = 10) {
    const c = this.hexRGB(color);
    for (let i = 0; i < n * this.quality; i++) {
      const p = this.debris.add(P(x, y + 1, z, { ...c, size: 0.3 + Math.random() * 0.5, life: 2.5 + Math.random() * 1.5, drag: 0.4, grav: -22, spin: 8, bounce: true }));
      const a = Math.random() * Math.PI * 2, s = 5 + Math.random() * 9;
      p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = 8 + Math.random() * 10;
    }
  }

  splash(x, y, z, color, n = 6) {
    const c = this.hexRGB(color);
    for (let i = 0; i < n * this.quality; i++) {
      const p = this.puffs.add(P(x, y, z, { ...c, size: 0.4 + Math.random() * 0.4, life: 0.6, drag: 1, grav: -16 }));
      p.vx = (Math.random() - 0.5) * 5; p.vy = 4 + Math.random() * 4; p.vz = (Math.random() - 0.5) * 5;
    }
  }

  beam(from, to, color = 0xd08bff, width = 0.25) { this.beamList.push({ from: from.clone(), to: to.clone(), color, width }); }

  bolt(from, to) { this.boltList.push({ from: from.clone(), to: to.clone(), life: 0.12 }); }

  shakeAt(x, y, z, amt) {
    if (!this.camera) return;
    const d = this.camera.position.distanceTo(_v.set(x, y, z));
    this.shake = Math.min(1.5, this.shake + amt * Math.max(0, 1 - d / 120));
  }

  floatText(x, y, z, text, color = '#fff', size = 22) { this.texts.push({ x, y, z, text, color, size, age: 0, life: 1.1 }); }

  update(dt) {
    this.puffs.update(dt, this.terrain);
    this.glows.update(dt, this.terrain);
    this.sparks.update(dt, this.terrain);
    this.debris.update(dt, this.terrain);
    // beams
    let n = 0;
    for (const b of this.beamList) {
      if (n >= 64) break;
      const len = b.from.distanceTo(b.to);
      _q.setFromUnitVectors(_v.set(0, 0, 1), _s.copy(b.to).sub(b.from).normalize());
      const w = b.width * (0.8 + Math.random() * 0.4);
      _m.compose(b.from, _q, _s.set(w, w, len));
      this.beams.setMatrixAt(n, _m);
      this.beams.setColorAt(n, _c.set(b.color));
      n++;
      // white core
      _m.compose(b.from, _q, _s.set(w * 0.35, w * 0.35, len));
      this.beams.setMatrixAt(n, _m);
      this.beams.setColorAt(n, _c.set(0xffffff));
      n++;
    }
    this.beams.count = n;
    markRange(this.beams.instanceMatrix, 0, n * 16);
    if (this.beams.instanceColor) markRange(this.beams.instanceColor, 0, n * 3);
    this.beamList.length = 0;
    // bolts: jagged segments
    let k = 0;
    this.boltList = this.boltList.filter((b) => (b.life -= dt) > 0);
    for (const b of this.boltList) {
      const segs = 8;
      let px = b.from.x, py = b.from.y, pz = b.from.z;
      for (let i = 1; i <= segs && k < 3990; i++) {
        const t = i / segs;
        const j = i === segs ? 0 : 0.9;
        const nx = b.from.x + (b.to.x - b.from.x) * t + (Math.random() - 0.5) * j;
        const ny = b.from.y + (b.to.y - b.from.y) * t + (Math.random() - 0.5) * j;
        const nz = b.from.z + (b.to.z - b.from.z) * t + (Math.random() - 0.5) * j;
        const bp = this.boltPos, o = k * 3;
        bp[o] = px; bp[o + 1] = py; bp[o + 2] = pz; bp[o + 3] = nx; bp[o + 4] = ny; bp[o + 5] = nz;
        k += 2;
        px = nx; py = ny; pz = nz;
      }
    }
    this.boltGeo.setDrawRange(0, k);
    markRange(this.boltGeo.attributes.position, 0, k * 3);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.texts = this.texts.filter((t) => (t.age += dt) < t.life);
  }
}
