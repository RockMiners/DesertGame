// 3D bases & the Hub: meshes, colliders, turret AI, structure damage. Mirrors sim state.
import * as THREE from 'three';
import { structureGeometry, turretHeadGeometry, hubParts, structureParts } from '../render/buildings.js';
import { vcMat, makeOutlinedMesh, propGeometry } from '../render/models.js';
import { outlineGeometry, outlineMat, mergeColored, M } from '../render/toon.js';
import { ColliderGrid } from './worldgen.js';
import { STRUCTS, TILE } from '../sim/defs.js';
import { WEAPONS } from '../vehicle/parts.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export const HUB_SPOTS = {
  bazaar: { x: 0, z: 34, label: 'Bazaar', icon: '🏪' },
  garage: { x: 64, z: -38, label: "Wrench Wendy's Garage", icon: '🔧' },
  cantina: { x: -62, z: -30, label: 'The Leaky Radiator', icon: '🍺' },
  inn: { x: -52, z: 62, label: 'Snooze Cruise Inn', icon: '🛏️' },
  mayor: { x: 58, z: 58, label: "Auntie Tallow's Office", icon: '📜' },
};

export class Structures {
  constructor(game, sim) {
    this.game = game;
    this.sim = sim;
    this.grid = new ColliderGrid(24);
    this.views = new Map(); // baseId -> view
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.buildHub();
    this.checkT = 0;
  }

  // ---------- Hub ----------
  buildHub() {
    const g = this.game, T = g.terrain;
    const hub = new THREE.Group();
    const add = (geo, x, z, rot = 0, scale = 1, outline = 0.07) => {
      const m = makeOutlinedMesh(geo, outline);
      m.position.set(x, T.heightAt(x, z), z);
      m.rotation.y = rot;
      m.scale.setScalar(scale);
      hub.add(m);
      return m;
    };
    add(mergeColored(hubParts()), 0, 0, 0, 1);
    this.grid.add({ x: 0, z: 0, r: 7, h: 30, y: T.heightAt(0, 0), kind: 'hub' });
    // walls
    const wallGeo = mergeColored(structureParts('wall', 3, 1, 0xd9572b, 0xffd166));
    for (const w of g.world.hubWall) {
      const m = add(wallGeo, w.x, w.z, -w.a + Math.PI / 2, 1, 0.06);
      m.scale.set(1, 1.5, 1.4);
    }
    // gate arches
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      for (const side of [-1, 1]) {
        const aa = a + side * 0.12;
        const x = Math.cos(aa) * 192, z = Math.sin(aa) * 192;
        add(mergeColored([{ geo: new THREE.CylinderGeometry(1.4, 1.8, 12, 8), color: 0xb5651d, matrix: M(0, 6, 0) }, { geo: new THREE.SphereGeometry(1.6, 8, 6), color: 0xffd166, matrix: M(0, 12.5, 0) }]), x, z);
        this.grid.add({ x, z, r: 1.8, h: 12, y: T.heightAt(x, z), kind: 'hub' });
      }
      const x = Math.cos(a) * 192, z = Math.sin(a) * 192;
      const sign = add(mergeColored([{ geo: new THREE.BoxGeometry(22, 2.6, 0.6), color: 0x3a86ff, matrix: M(0, 13, 0) }, { geo: new THREE.BoxGeometry(18, 1.4, 0.7), color: 0xffd166, matrix: M(0, 13, 0) }]), x, z, -a + Math.PI / 2);
      void sign;
    }
    // town buildings
    const town = [
      ['garage', HUB_SPOTS.garage, 2, 2, 1.6, 0xff8c42, 0x3a86ff],
      ['bunkhouse', HUB_SPOTS.cantina, 2, 1, 1.8, 0xe76f51, 0xffd166],
      ['bunkhouse', HUB_SPOTS.inn, 2, 1, 1.5, 0x8ac926, 0xff8fab],
      ['hq', HUB_SPOTS.mayor, 2, 2, 1.1, 0x5fb3d9, 0xffffff],
    ];
    for (const [type, p, w, d, sc, col, acc] of town) {
      const geo = structureGeometry(type, w, d, col, acc);
      const rot = Math.atan2(-p.x, -p.z);
      add(geo, p.x, p.z, rot, sc);
      this.grid.add({ x: p.x, z: p.z, r: (w * TILE * sc) / 2.4, h: 12, y: T.heightAt(p.x, p.z), kind: 'hub' });
    }
    // giant radiator sign on the cantina
    const rad = add(mergeColored([{ geo: new THREE.BoxGeometry(6, 4, 0.6), color: 0xb8c0c8, matrix: M(0, 9, 0) }, ...Array.from({ length: 6 }, (_, i) => ({ geo: new THREE.BoxGeometry(0.3, 3.6, 0.8), color: 0x8d99ae, matrix: M(-2.4 + i * 0.95, 9, 0) })), { geo: new THREE.SphereGeometry(0.4, 6, 4), color: 0x4fc3e8, matrix: M(2.6, 6.8, 0.3) }]), HUB_SPOTS.cantina.x, HUB_SPOTS.cantina.z, Math.atan2(-HUB_SPOTS.cantina.x, -HUB_SPOTS.cantina.z));
    void rad;
    // bazaar stalls around the tower
    const stall = structureGeometry('market', 1, 1, '#e76f51', '#ffd166');
    const stall2 = structureGeometry('market', 1, 1, '#2a9d8f', '#ffffff');
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      add(i % 2 ? stall : stall2, Math.cos(a) * 30, Math.sin(a) * 30, -a - Math.PI / 2, 1);
    }
    // palms and junk
    const palm = propGeometry('palm');
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, r = 120 + (i % 3) * 18;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if ([0, 1, 2, 3].some((k) => Math.abs(((a - (k * Math.PI) / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.25)) continue;
      add(palm, x, z, i, 0.9 + (i % 4) * 0.1, 0.05);
      this.grid.add({ x, z, r: 0.7, h: 9, y: T.heightAt(x, z), kind: 'hub' });
    }
    this.group.add(hub);
    this.hub = hub;
  }

  // ---------- Bases ----------
  hashBase(b) { return `${b.factionId}|${b.level}|${b.structs.map((s) => s.id).join(',')}`; }

  sync() {
    const bases = this.sim.s.bases;
    for (const [id, view] of this.views) {
      const b = bases[id];
      if (!b) { this.removeView(id, true); continue; }
      if (view.hash !== this.hashBase(b)) this.rebuild(b, view);
      else {
        view.base = b; // co-op clients get fresh base objects with every state update
        for (const t of view.turrets) { const st = b.structs.find((x) => x.id === t.stId); if (st) t.st = st; }
      }
    }
    for (const b of Object.values(bases)) if (!this.views.has(b.id)) this.rebuild(b, null);
  }

  removeView(id, boom) {
    const view = this.views.get(id);
    if (!view) return;
    if (boom) {
      const p = view.group.position;
      if (p.distanceTo(this.game.camera.position) < 500) { this.game.fx.explosion(p.x, p.y + 3, p.z, 2.5); this.game.audio?.play('bigexplosion', p); }
    }
    this.group.remove(view.group);
    for (const c of view.colliders) this.grid.remove(c);
    this.views.delete(id);
  }

  rebuild(b, old) {
    const prevStructs = old ? old.structIds : new Set();
    if (old) { this.group.remove(old.group); for (const c of old.colliders) this.grid.remove(c); }
    const f = this.sim.s.factions[b.factionId];
    const col = f?.color || '#888', acc = f?.accent || '#fff';
    const g = new THREE.Group();
    g.position.set(b.x, b.y, b.z);
    const view = { id: b.id, group: g, colliders: [], turrets: [], hash: this.hashBase(b), structIds: new Set(), meshes: new Map(), base: b };
    const T = this.game.terrain;
    for (const st of b.structs) {
      const def = STRUCTS[st.type];
      const p = this.sim.structWorld(b, st);
      const geo = structureGeometry(st.type, def.w, def.d, col, acc);
      const m = makeOutlinedMesh(geo, 0.07);
      const gy = b.factionId === this.sim.s.group.factionId ? Math.max(b.y, T.heightAt(p.x, p.z)) : b.y;
      m.position.set(p.x - b.x, gy - b.y, p.z - b.z);
      g.add(m);
      view.meshes.set(st.id, m);
      view.structIds.add(st.id);
      const r = st.type === 'wall' ? TILE * 0.55 : Math.max(def.w, def.d) * TILE * 0.42;
      const h = st.type === 'hq' ? 10 : st.type === 'radio' ? 15 : def.weapon ? 4 : st.type === 'solar' || st.type === 'farm' ? 2.5 : 5;
      const c = this.grid.add({ x: p.x, z: p.z, r, h, y: gy, kind: 'struct', baseId: b.id, stId: st.id, team: b.factionId, solid: !['solar', 'farm'].includes(st.type) });
      view.colliders.push(c);
      if (def.weapon) {
        const head = new THREE.Group();
        head.position.set(p.x - b.x, gy - b.y + 3.4, p.z - b.z);
        const hg = turretHeadGeometry(st.type);
        const hm = new THREE.Mesh(hg, vcMat()); hm.castShadow = true;
        head.add(hm, new THREE.Mesh(outlineGeometry(hg), outlineMat(0.05)));
        g.add(head);
        view.turrets.push({ stId: st.id, st, head, weapon: WEAPONS[def.weapon], range: def.range, cd: Math.random(), yaw: Math.random() * 6, world: new THREE.Vector3(p.x, gy + 4, p.z), target: null });
      }
      // new structure pop-in
      if (old && !prevStructs.has(st.id)) { m.scale.setScalar(0.01); m.userData.grow = 0; }
    }
    // corner flags mark the compound
    const half = (b.size * TILE) / 2;
    const flagGeo = mergeColored([{ geo: new THREE.CylinderGeometry(0.1, 0.1, 6, 6), color: 0x3a3a44, matrix: M(0, 3, 0) }, { geo: new THREE.BoxGeometry(1.8, 1.1, 0.06), color: new THREE.Color(col).getHex(), matrix: M(0.9, 5.3, 0) }]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const m = makeOutlinedMesh(flagGeo, 0.04);
      const x = b.x + sx * half, z = b.z + sz * half;
      m.position.set(sx * half, T.heightAt(x, z) - b.y, sz * half);
      g.add(m);
    }
    this.group.add(g);
    this.views.set(b.id, view);
  }

  // ---------- queries used by combat & AI ----------
  hostileTo(team, c) {
    if (!team) return true;
    const sim = this.sim;
    return sim.hostileTeams(team, c.team);
  }

  at(x, y, z, team) {
    const list = this.grid.query(x, z, 1);
    for (const c of list) {
      if (c.kind !== 'struct') continue;
      if (y > c.y + c.h || y < c.y - 1) continue;
      if (Math.hypot(c.x - x, c.z - z) > c.r) continue;
      if (team && team === c.team) continue;
      return c;
    }
    return null;
  }

  near(x, z, r, team) {
    let best = null, bd = r;
    for (const c of this.grid.query(x, z, r)) {
      if (c.kind !== 'struct' || (team && !this.hostileTo(team, c))) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  nearestHostile(team, x, z, r, preferTurrets = true) {
    let best = null, bs = Infinity;
    for (const c of this.grid.query(x, z, r)) {
      if (c.kind !== 'struct' || !this.hostileTo(team, c)) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > r) continue;
      const b = this.sim.s.bases[c.baseId];
      const st = b?.structs.find((s) => s.id === c.stId);
      const score = d * (preferTurrets && st && STRUCTS[st.type].weapon ? 0.5 : 1) * (st?.type === 'hq' ? 0.8 : 1);
      if (score < bs) { bs = score; best = c; }
    }
    return best;
  }

  solidNear(x, z, r) {
    for (const c of this.grid.query(x, z, r)) if (c.solid !== false && Math.hypot(c.x - x, c.z - z) < c.r + r) return true;
    return false;
  }

  damage(c, amt, source) {
    if (!c || c.kind !== 'struct') return;
    if (source?.isRemote) return; // a co-op replica's shots are decided on its owner's machine
    const b = this.sim.s.bases[c.baseId];
    if (!b) return;
    const st = b.structs.find((s) => s.id === c.stId);
    if (!st) return;
    const team = source?.team || null;
    const byPlayer = source?.isPlayer || source?.isRemotePlayer;
    if (team && team === b.factionId) return;
    if (team && !byPlayer && !this.sim.hostileTeams(team, b.factionId)) return;
    if (byPlayer && this.sim.pact(team, b.factionId) === 'alliance') return;
    if (byPlayer && !this.sim.hostileTeams(team, b.factionId)) this.game.onAttackFriendly?.(b.factionId, null); // an act of war
    const view = this.views.get(b.id);
    const m = view?.meshes.get(st.id);
    if (m) m.userData.hit = 1;
    if (source?.isPlayer) this.game.ui?.hitMarker();
    this.game.structDamage(b, st, amt, team, source);
  }

  splash(x, y, z, dmg, r, owner, team) {
    for (const c of this.grid.query(x, z, r + 8)) {
      if (c.kind !== 'struct') continue;
      const d = Math.max(0, Math.hypot(c.x - x, c.z - z) - c.r);
      if (d > r) continue;
      if (team && !this.hostileTo(team, c)) continue;
      this.damage(c, dmg * (1 - d / r) * 0.8, owner);
    }
  }

  collide(car) {
    const b = car.body;
    for (const c of this.grid.query(b.pos.x, b.pos.z, b.radius + 10)) {
      if (c.solid === false) continue;
      if (b.pos.y > c.y + c.h + 0.5) continue;
      for (const s of b.spheres) {
        s.world.copy(s.local).applyQuaternion(b.quat).add(b.pos);
        const dx = s.world.x - c.x, dz = s.world.z - c.z;
        const d = Math.hypot(dx, dz);
        const pen = s.r + c.r - d;
        if (pen <= 0) continue;
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        b.pos.x += nx * pen; b.pos.z += nz * pen;
        const vn = b.vel.x * nx + b.vel.z * nz;
        if (vn < 0) {
          b.vel.x -= 1.3 * vn * nx; b.vel.z -= 1.3 * vn * nz;
          if (-vn > 9 && c.kind === 'struct') this.damage(c, (-vn - 9) * car.stats.mass * 0.004 * car.stats.ramMult, car);
          if (-vn > 12 && car.isPlayer) { this.game.fx.shake += 0.3; this.game.audio?.play('crash', b.pos, true); }
        }
      }
    }
  }

  // ---------- per-frame: turrets & visuals ----------
  // turrets fight near any player (the host's car or a co-op partner's), whether or not anyone is drawing
  tick(dt) {
    const g = this.game;
    this.checkT -= dt;
    if (this.checkT <= 0) { this.checkT = 0.5; this.sync(); }
    for (const view of this.views.values()) {
      const p = view.group.position;
      let near = false;
      for (const c of g.cars) {
        if (!(c.isPlayer || c.isRemotePlayer)) continue;
        const dx = c.body.pos.x - p.x, dz = c.body.pos.z - p.z;
        if (dx * dx + dz * dz < 420 * 420) { near = true; break; }
      }
      if (near) this.updateTurrets(view, dt);
    }
  }

  render(dt, camPos) {
    const g = this.game;
    for (const view of this.views.values()) {
      const d = view.group.position.distanceTo(camPos);
      view.group.visible = d < g.viewDist + 100;
      if (!view.group.visible) continue;
      for (const m of view.meshes.values()) {
        if (m.userData.grow !== undefined) {
          m.userData.grow += dt * 2.5;
          const t = Math.min(1, m.userData.grow);
          m.scale.setScalar(t >= 1 ? 1 : 0.2 + t * 0.8 + Math.sin(t * Math.PI) * 0.15);
          if (t >= 1) delete m.userData.grow;
        }
        if (m.userData.hit > 0) { m.userData.hit -= dt * 5; const s = 1 + Math.max(0, m.userData.hit) * 0.04; m.scale.set(s, 1 - Math.max(0, m.userData.hit) * 0.03, s); if (m.userData.hit <= 0) m.scale.setScalar(1); }
      }
    }
  }

  updateTurrets(view, dt) {
    const g = this.game, b = view.base;
    if (!this.sim.s.bases[b.id]) return;
    const team = b.factionId;
    const dmgMult = this.sim.isReplica ? 0 : 0.8; // co-op clients: turrets are for show, the host deals their damage
    for (const t of view.turrets) {
      if (!t.st || t.st.hp <= 0) continue;
      const def = STRUCTS[t.st.type];
      t.cd -= dt;
      // acquire
      if (!t.target || !t.target.alive || t.target.body.pos.distanceTo(t.world) > t.range || (t.retarget -= dt) < 0) {
        t.retarget = 0.6;
        t.target = null;
        let bd = t.range;
        for (const c of g.cars) {
          if (!c.alive || g.inSafeZone(c.body.pos.x, c.body.pos.z)) continue;
          if (!this.sim.hostileTeams(team, c.team)) continue;
          const dd = c.body.pos.distanceTo(t.world);
          if (dd < bd) { bd = dd; t.target = c; }
        }
      }
      if (def.power && def.power < 0 && b.power && b.power.gen < b.power.use * 0.5) continue; // unpowered laser towers sleep
      let wantYaw = t.yaw + dt * 0.4;
      if (t.target) {
        _v.copy(t.target.body.pos).sub(t.world);
        wantYaw = Math.atan2(_v.x, _v.z);
      }
      let dy = wantYaw - t.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      t.yaw += Math.max(-dt * 2.5, Math.min(dt * 2.5, dy));
      t.head.rotation.y = t.yaw;
      if (!t.target || Math.abs(dy) > 0.2) continue;
      const w = t.weapon;
      const tgt = t.target;
      const fair = tgt.isPlayer ? (g.director?.turretAccuracy() ?? 1) : 1;
      _d.set(Math.sin(t.yaw), 0, Math.cos(t.yaw));
      const muzzle = _v.copy(t.world).addScaledVector(_d, 2.2);
      const dist = tgt.body.pos.distanceTo(muzzle);
      if (w.beam) {
        const end = tgt.body.pos.clone(); end.y += 1;
        g.fx.beam(muzzle, end, 0xd08bff, 0.3);
        if (dmgMult) g.applyDamage(tgt, w.dmg * 0.6 * dt * fair, null, { kind: 'energy', quiet: true });
        continue;
      }
      if (t.cd > 0) continue;
      t.cd = 1 / (w.rate * (w.id === 'mg' ? 0.55 : 0.8));
      const aim = tgt.body.pos.clone().addScaledVector(tgt.body.vel, dist / (w.speed || 200) * 0.8);
      aim.y += 0.8 + (w.id === 'cannon' ? dist * dist * 0.0004 : 0);
      const dir = aim.sub(muzzle).normalize();
      const spread = (w.spread + 0.02) * (2 - fair);
      dir.x += (Math.random() - 0.5) * spread * 2; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      if (w.proj === 'shell') g.combat.spawn({ kind: 'shell', owner: null, team, x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: dir.x * w.speed, vy: dir.y * w.speed + 3, vz: dir.z * w.speed, dmg: w.dmg * dmgMult, splash: w.splash, knock: w.knock, life: 5, grav: -9.8 * w.gravity * 2.2, dmgKind: 'explosive' });
      else g.combat.spawn({ kind: 'bullet', owner: null, team, x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: dir.x * w.speed, vy: dir.y * w.speed, vz: dir.z * w.speed, dmg: w.dmg * dmgMult, life: t.range / w.speed + 0.2, dmgKind: 'bullet' });
      g.fx.muzzle(muzzle.x, muzzle.y, muzzle.z, dir, 0xffe08a, w.proj === 'shell' ? 1.6 : 0.7);
      g.audio?.play(w.sound, muzzle);
    }
  }

  baseAt(x, z, pad = 14) {
    for (const b of Object.values(this.sim.s.bases)) {
      const half = (b.size * TILE) / 2 + pad;
      if (Math.abs(x - b.x) < half && Math.abs(z - b.z) < half) return b;
    }
    return null;
  }
}
