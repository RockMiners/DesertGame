// Tyre tracks: ring buffer of ground-hugging quads that fade with age.
import * as THREE from 'three';
import { markRange } from './perf.js';

const SLICES = 8; // fade 1/SLICES of the buffer per frame

export class Tracks {
  constructor(scene, cap = 6000) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 4 * 3);
    this.col = new Float32Array(cap * 4 * 4);
    this.birth = new Float32Array(cap);
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.head = 0;
    this.time = 0;
    this.last = new Map();
    this.life = 40;
    this.slice = 0;
    this.aLo = -1; this.aHi = -1; // contiguous run of segments written since the last upload
  }
  // key identifies a wheel; returns nothing
  add(key, x, y, z, nx, nz, width, color, alpha = 0.35) {
    const prev = this.last.get(key);
    if (!prev) { this.last.set(key, { x, y, z, nx, nz, t: this.time }); return; }
    const dx = x - prev.x, dz = z - prev.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.5 * 0.5) return;
    if (d2 > 9 || this.time - prev.t > 0.3) { prev.x = x; prev.y = y; prev.z = z; prev.nx = nx; prev.nz = nz; prev.t = this.time; return; }
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const len = Math.sqrt(d2);
    const px = -dz / len * width * 0.5, pz = dx / len * width * 0.5;
    const o = i * 12;
    this.pos[o] = prev.x + px; this.pos[o + 1] = prev.y + 0.06; this.pos[o + 2] = prev.z + pz;
    this.pos[o + 3] = prev.x - px; this.pos[o + 4] = prev.y + 0.06; this.pos[o + 5] = prev.z - pz;
    this.pos[o + 6] = x + px; this.pos[o + 7] = y + 0.06; this.pos[o + 8] = z + pz;
    this.pos[o + 9] = x - px; this.pos[o + 10] = y + 0.06; this.pos[o + 11] = z - pz;
    const c = this.col, co = i * 16;
    for (let k = 0; k < 4; k++) { c[co + k * 4] = color.r; c[co + k * 4 + 1] = color.g; c[co + k * 4 + 2] = color.b; c[co + k * 4 + 3] = alpha; }
    this.birth[i] = this.time;
    prev.x = x; prev.y = y; prev.z = z; prev.nx = nx; prev.nz = nz; prev.t = this.time;
    if (this.aLo >= 0 && i === this.aHi + 1) this.aHi = i;
    else { this.flushAdds(); this.aLo = this.aHi = i; }
  }
  flushAdds() {
    if (this.aLo < 0) return;
    const n = this.aHi - this.aLo + 1;
    markRange(this.geo.attributes.position, this.aLo * 12, n * 12);
    markRange(this.geo.attributes.color, this.aLo * 16, n * 16);
    this.aLo = this.aHi = -1;
  }
  update(dt) {
    this.time += dt;
    this.flushAdds();
    // fade one slice per frame; each segment is revisited every SLICES frames
    const c = this.col, per = Math.ceil(this.cap / SLICES);
    const s0 = this.slice * per, s1 = Math.min(this.cap, s0 + per);
    this.slice = (this.slice + 1) % SLICES;
    const fadeAt = this.life * 0.6, fadeLen = this.life * 0.4;
    let lo = -1, hi = -1;
    for (let i = s0; i < s1; i++) {
      const age = this.time - this.birth[i];
      if (age <= fadeAt) continue;
      const co = i * 16;
      if (c[co + 3] <= 0) continue;
      const a = Math.max(0, 0.35 * (1 - (age - fadeAt) / fadeLen));
      if (c[co + 3] > a) {
        for (let k = 0; k < 4; k++) c[co + k * 4 + 3] = a;
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    if (lo >= 0) markRange(this.geo.attributes.color, lo * 16, (hi - lo + 1) * 16);
  }
  forget(key) { this.last.delete(key); }
}
