// Tyre tracks: ring buffer of ground-hugging quads that fade with age.
import * as THREE from 'three';

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
  }
  // key identifies a wheel; returns nothing
  add(key, x, y, z, nx, nz, width, color, alpha = 0.35) {
    const prev = this.last.get(key);
    if (!prev) { this.last.set(key, { x, y, z, nx, nz, t: this.time }); return; }
    const dx = x - prev.x, dz = z - prev.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.5 * 0.5) return;
    if (d2 > 9 || this.time - prev.t > 0.3) { this.last.set(key, { x, y, z, nx, nz, t: this.time }); return; }
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
    this.last.set(key, { x, y, z, nx, nz, t: this.time });
    this.dirty = true;
  }
  update(dt) {
    this.time += dt;
    // fade a slice each frame
    const c = this.col;
    for (let i = 0; i < this.cap; i++) {
      const age = this.time - this.birth[i];
      if (age > this.life * 0.6) {
        const a = Math.max(0, 0.35 * (1 - (age - this.life * 0.6) / (this.life * 0.4)));
        const co = i * 16;
        if (c[co + 3] > a) { for (let k = 0; k < 4; k++) c[co + k * 4 + 3] = a; this.dirty = true; }
      }
    }
    if (this.dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.dirty = false;
    }
  }
  forget(key) { this.last.delete(key); }
}
