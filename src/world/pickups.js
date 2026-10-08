// Resource nodes & loot drops: bobbing pickups that go into cargo when driven over.
import * as THREE from 'three';
import { propGeometry, vcMat } from '../render/models.js';
import { outlineGeometry, outlineMat } from '../render/toon.js';
import { RES_INFO } from './biomes.js';

const TYPES = ['scrapPile', 'oilBarrels', 'ammoCrate', 'waterTank', 'foodCrate', 'chemDrum', 'circuitBox', 'crystalNode', 'lootCrate'];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Pickups {
  constructor(game, spawns) {
    this.game = game;
    this.nodes = spawns.map((s) => ({ ...s, y: game.terrain.heightAt(s.x, s.z), active: true, respawn: 0 }));
    this.drops = [];
    this.meshes = {};
    for (const t of TYPES) {
      const geo = propGeometry(t);
      const m = new THREE.InstancedMesh(geo, vcMat(), 400);
      const ol = new THREE.InstancedMesh(outlineGeometry(geo), outlineMat(0.05), 400);
      m.frustumCulled = false; ol.frustumCulled = false;
      m.count = 0; ol.count = 0;
      m.castShadow = true;
      game.scene.add(m, ol);
      this.meshes[t] = { m, ol };
    }
    this.time = 0;
  }

  // loot drop from wrecks: {res: amount}
  drop(x, z, loot, opts = {}) {
    const entries = Object.entries(loot).filter(([, v]) => v > 0);
    if (!entries.length) return;
    const y = this.game.terrain.heightAt(x, z);
    this.drops.push({ x, z, y, loot, type: opts.type || 'lootCrate', life: opts.life ?? 120, vy: 6, dy: 2, bounce: 0 });
  }

  serialize() { return { nodes: this.nodes.filter((n) => !n.active).map((n) => [n.id, Math.round(n.respawn)]) }; }
  load(data) {
    if (!data) return;
    const map = new Map(data.nodes);
    for (const n of this.nodes) if (map.has(n.id)) { n.active = false; n.respawn = map.get(n.id); }
  }

  update(dt, cars, viewPos) {
    this.time += dt;
    const g = this.game;
    for (const n of this.nodes) {
      if (!n.active) { n.respawn -= dt; if (n.respawn <= 0) n.active = true; }
    }
    // collect
    for (const car of cars) {
      if (!car.alive || (!car.isPlayer && !car.collects)) continue;
      const reach = (car.body.radius + 2.2) * (car.stats.flags.magnet ? 3 : 1);
      const px = car.body.pos.x, pz = car.body.pos.z;
      for (const n of this.nodes) {
        if (!n.active) continue;
        const dx = n.x - px, dz = n.z - pz;
        if (dx * dx + dz * dz > reach * reach) continue;
        const got = car.addCargo(n.res, n.amount);
        if (got <= 0) { if (car.isPlayer) g.ui?.toast('Cargo full! Sell or stash it at a base.', 'warn', 'cargo'); continue; }
        n.active = false;
        n.respawn = 240 + Math.random() * 240;
        g.onCollect?.(car, { [n.res]: got }, n);
      }
      for (const d of this.drops) {
        if (d.taken) continue;
        const dx = d.x - px, dz = d.z - pz;
        if (dx * dx + dz * dz > reach * reach * 1.2) continue;
        const got = {};
        let any = false;
        for (const [res, amt] of Object.entries(d.loot)) {
          if (res === 'caps') { got.caps = amt; any = true; d.loot[res] = 0; continue; }
          const n = car.addCargo(res, amt);
          if (n > 0) { got[res] = n; d.loot[res] -= n; any = true; }
        }
        if (Object.values(d.loot).every((v) => v <= 0)) d.taken = true;
        if (any) g.onCollect?.(car, got, d);
        else if (car.isPlayer) g.ui?.toast('Cargo full!', 'warn', 'cargo');
      }
    }
    this.drops = this.drops.filter((d) => !d.taken && (d.life -= dt) > 0);
    // render
    const counts = {};
    for (const t of TYPES) counts[t] = 0;
    const lim2 = 420 * 420;
    const put = (type, x, y, z, rot, sc) => {
      const e = this.meshes[type];
      const i = counts[type]++;
      if (i >= 400) return;
      _q.setFromAxisAngle(UP, rot);
      _m.compose(_v.set(x, y, z), _q, _s.set(sc, sc, sc));
      e.m.setMatrixAt(i, _m); e.ol.setMatrixAt(i, _m);
    };
    for (const n of this.nodes) {
      if (!n.active) continue;
      const dx = n.x - viewPos.x, dz = n.z - viewPos.z;
      if (dx * dx + dz * dz > lim2) continue;
      put(n.type, n.x, n.y + 0.4 + Math.sin(this.time * 2 + n.x) * 0.25, n.z, this.time * 0.8 + n.z, 1.2);
    }
    for (const d of this.drops) {
      d.vy -= 20 * dt; d.dy += d.vy * dt;
      if (d.dy < 0.5) { d.dy = 0.5; d.vy = Math.abs(d.vy) * 0.4; }
      put(d.type, d.x, d.y + d.dy + Math.sin(this.time * 3) * 0.15, d.z, this.time * 1.5, 1.1);
    }
    for (const t of TYPES) {
      const e = this.meshes[t];
      e.m.count = e.ol.count = Math.min(400, counts[t]);
      e.m.instanceMatrix.needsUpdate = true; e.ol.instanceMatrix.needsUpdate = true;
    }
  }

  // for minimap/radar
  nearbyNodes(x, z, r) { return this.nodes.filter((n) => n.active && Math.hypot(n.x - x, n.z - z) < r); }
}

export function lootText(got) {
  return Object.entries(got).filter(([, v]) => v > 0).map(([k, v]) => k === 'caps' ? `+${v} caps` : `+${v} ${RES_INFO[k]?.icon || ''}`).join('  ');
}
