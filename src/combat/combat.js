// Weapons firing, projectiles, beams, chain lightning, mines, oil slicks and splash damage.
import * as THREE from 'three';
import { mergeColored, M, toonMat } from '../render/toon.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const fx = ax - cx, fy = ay - cy, fz = az - cz;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? -(fx * dx + fy * dy + fz * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz <= r * r ? t : -1;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.mines = [];
    this.slicks = [];
    const scene = game.scene;
    const mk = (geo, mat, cap) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.frustumCulled = false; m.count = 0; scene.add(m); return m; };
    this.meshes = {
      bullet: mk(new THREE.BoxGeometry(0.16, 0.16, 2.4), new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false }), 700),
      shell: mk(new THREE.SphereGeometry(0.32, 8, 6), toonMat(0x333333), 100),
      rocket: mk(mergeColored([
        { geo: new THREE.CylinderGeometry(0.14, 0.14, 0.9, 8), color: 0xffffff, matrix: M(0, 0, 0, Math.PI / 2, 0, 0) },
        { geo: new THREE.ConeGeometry(0.14, 0.35, 8), color: 0xe63946, matrix: M(0, 0, 0.6, Math.PI / 2, 0, 0) },
        { geo: new THREE.BoxGeometry(0.5, 0.04, 0.2), color: 0xe63946, matrix: M(0, 0, -0.35) },
      ]), toonMat(0xffffff, { vertexColors: true }), 150),
      mine: mk(mergeColored([
        { geo: new THREE.CylinderGeometry(0.55, 0.65, 0.3, 10), color: 0x6b7a3a, matrix: M(0, 0.15, 0) },
        { geo: new THREE.SphereGeometry(0.15, 6, 4), color: 0xff3b3b, matrix: M(0, 0.32, 0) },
      ]), toonMat(0xffffff, { vertexColors: true }), 120),
      slick: mk(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x15100c, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), 60),
    };
    this.time = 0;
  }

  canHit(owner, team, c) {
    const g = this.game;
    // players may open fire on anyone who isn't on their side — it has consequences
    if (owner && (owner.isPlayer || owner.isRemotePlayer)) return c !== owner && !g.isFriendly(owner, c);
    if (owner) return c !== owner && (g.hostile(owner, c) || g.friendlyFire);
    if (team) return g.hostileTeam(team, c.team);
    return true;
  }

  // ---- Firing ----
  tryFire(car, w, dt) {
    const g = this.game;
    const def = w.def;
    if (!car.alive) return false;
    if (g.inSafeZone(car.pos.x, car.pos.z)) return false;
    if (def.beam) {
      const cost = def.energy * dt;
      if (car.energy < cost) return false;
      car.energy -= cost;
      this.fireBeam(car, w, dt);
      w.justFired = true;
      return true;
    }
    if (w.cooldown > 0) return false;
    if (w.kind !== 'rear' && def.id !== 'tesla' && !w.aligned && w.kind === 'turret' && !car.isPlayer) return false;
    if (def.ammo) { if (car.ammo < def.ammo) { if (car.isPlayer) g.ui?.toast('Out of ammo!', 'warn', 'ammo'); return false; } car.ammo -= def.ammo; }
    if (def.energy) { if (car.energy < def.energy) return false; car.energy -= def.energy; }
    if (def.fuel) { if (car.fuel < def.fuel) return false; car.fuel -= def.fuel; }
    w.cooldown = 1 / def.rate;
    w.justFired = true;
    car.muzzle(w, _p, _d);
    const team = car.team;
    const size = 1 + (car.stats.size - 1) * 0.3;
    switch (def.proj) {
      case 'bullet': {
        const n = def.pellets || 1;
        for (let i = 0; i < n; i++) {
          _v.copy(_d);
          const sp = def.spread * (car.isPlayer ? 0.8 : 1.15 - (car.skill || 0.5) * 0.4);
          _v.x += (Math.random() - 0.5) * sp * 2; _v.y += (Math.random() - 0.5) * sp * 2; _v.z += (Math.random() - 0.5) * sp * 2;
          _v.normalize();
          this.spawn({ kind: 'bullet', owner: car, team, x: _p.x, y: _p.y, z: _p.z, vx: _v.x * def.speed + car.body.vel.x, vy: _v.y * def.speed + car.body.vel.y, vz: _v.z * def.speed + car.body.vel.z, dmg: def.dmg * size, life: def.range / def.speed, dmgKind: 'bullet' });
        }
        g.fx.muzzle(_p.x, _p.y, _p.z, _d, 0xffe08a, def.pellets ? 1.1 : 0.6);
        break;
      }
      case 'shell':
        this.spawn({ kind: 'shell', owner: car, team, x: _p.x, y: _p.y, z: _p.z, vx: _d.x * def.speed + car.body.vel.x, vy: _d.y * def.speed + 3 + car.body.vel.y, vz: _d.z * def.speed + car.body.vel.z, dmg: def.dmg * size, splash: def.splash * Math.sqrt(size), knock: def.knock, life: 5, grav: -9.8 * def.gravity * 2.2, dmgKind: 'explosive' });
        g.fx.muzzle(_p.x, _p.y, _p.z, _d, 0xffc04a, 1.6);
        g.fx.smoke(_p.x, _p.y, _p.z, 0.75, 1.4);
        if (car.isPlayer) g.fx.shake += 0.25;
        car.body.vel.addScaledVector(_d, -def.dmg * 0.6 / car.stats.mass * 10);
        break;
      case 'rocket': {
        const target = car.lockTarget || g.findTarget(car, _p, _d, 0.35, def.range);
        _v.copy(_d); _v.x += (Math.random() - 0.5) * def.spread; _v.y += Math.random() * def.spread; _v.z += (Math.random() - 0.5) * def.spread;
        _v.normalize();
        this.spawn({ kind: 'rocket', owner: car, team, x: _p.x, y: _p.y, z: _p.z, vx: _v.x * def.speed * 0.6, vy: _v.y * def.speed * 0.6, vz: _v.z * def.speed * 0.6, speed: def.speed, dmg: def.dmg * size, splash: def.splash, knock: def.knock, life: def.range / def.speed + 0.6, homing: def.homing, target, dmgKind: 'explosive' });
        g.fx.muzzle(_p.x, _p.y, _p.z, _d, 0xffa04a, 0.9);
        break;
      }
      case 'flame': {
        for (let i = 0; i < 2; i++) {
          _v.copy(_d);
          _v.x += (Math.random() - 0.5) * def.spread * 2; _v.y += (Math.random() - 0.5) * def.spread; _v.z += (Math.random() - 0.5) * def.spread * 2;
          _v.normalize().multiplyScalar(def.speed);
          _v.add(car.body.vel);
          g.fx.flame(_p.x, _p.y, _p.z, _v.x, _v.y, _v.z);
          this.spawn({ kind: 'flame', owner: car, team, x: _p.x, y: _p.y, z: _p.z, vx: _v.x, vy: _v.y, vz: _v.z, dmg: def.dmg * size, burn: def.burn, life: def.range / def.speed, dmgKind: 'fire', radius: 1.6 });
        }
        break;
      }
      case 'zap': this.fireZap(car, w, _p, _d); break;
      case 'mine':
        this.mines.push({ owner: car, team, x: _p.x, y: g.terrain.heightAt(_p.x, _p.z), z: _p.z, arm: 0.8, life: 90, dmg: def.dmg, splash: def.splash });
        if (this.mines.length > 120) this.mines.shift();
        g.audio?.play('clunk', _p);
        break;
      case 'slick':
        this.slicks.push({ x: _p.x, z: _p.z, y: g.terrain.heightAt(_p.x, _p.z) + 0.08, r: 3.5 + car.stats.size, life: 30, fire: 0, owner: car, team });
        if (this.slicks.length > 60) this.slicks.shift();
        g.audio?.play('splat', _p);
        break;
    }
    if (def.sound && def.proj !== 'mine' && def.proj !== 'slick') g.audio?.play(def.sound, _p, car.isPlayer);
    return true;
  }

  fireBeam(car, w, dt) {
    const g = this.game;
    const def = w.def;
    car.muzzle(w, _p, _d);
    const step = 1.5;
    let hit = null, end = null;
    let hitStruct = null;
    for (let s = 0; s < def.range; s += step) {
      _a.copy(_p).addScaledVector(_d, s);
      if (_a.y < g.terrain.heightAt(_a.x, _a.z)) { end = _a.clone(); break; }
      for (const c of g.cars) {
        if (c === car || !c.alive || !g.hostile(car, c)) continue;
        const r = c.body.radius * 0.7;
        if (_a.distanceToSquared(c.body.pos) < r * r + 1) { hit = c; end = _a.clone(); break; }
      }
      if (hit) break;
      hitStruct = g.structureAt(_a.x, _a.y, _a.z, car.team);
      if (hitStruct) { end = _a.clone(); break; }
    }
    if (!end) end = _p.clone().addScaledVector(_d, def.range);
    g.fx.beam(_p, end, 0xd08bff, 0.22 * Math.sqrt(car.stats.size));
    if (Math.random() < 0.5) g.fx.sparkBurst(end.x, end.y, end.z, 2, 0xe0b0ff, 6);
    const dmg = def.dmg * dt * (1 + (car.stats.size - 1) * 0.3);
    if (hit) g.applyDamage(hit, dmg, car, { kind: 'energy', x: end.x, y: end.y, z: end.z, quiet: true });
    if (hitStruct) g.damageStructure(hitStruct, dmg, car);
    car.beamSound = 0.15;
  }

  fireZap(car, w, p, d) {
    const g = this.game;
    const def = w.def;
    let from = p.clone();
    const hitSet = new Set();
    let dmg = def.dmg * (1 + (car.stats.size - 1) * 0.3);
    let range = def.range;
    for (let i = 0; i < (def.chain || 1); i++) {
      let best = null, bestD = range;
      for (const c of g.cars) {
        if (c === car || !c.alive || hitSet.has(c) || !g.hostile(car, c)) continue;
        const dd = c.body.pos.distanceTo(from);
        if (dd < bestD) { bestD = dd; best = c; }
      }
      if (!best) {
        if (i === 0) {
          const s = g.structureNear(from.x, from.z, range, car.team);
          if (s) { const to = new THREE.Vector3(s.x, s.y + 2, s.z); g.fx.bolt(from, to); g.damageStructure(s, dmg, car); }
          else { const to = from.clone().addScaledVector(d, 14); to.y = g.terrain.heightAt(to.x, to.z); g.fx.bolt(from, to); }
        }
        break;
      }
      const to = best.body.pos.clone(); to.y += 1;
      g.fx.bolt(from, to);
      g.fx.sparkBurst(to.x, to.y, to.z, 5, 0xbde9ff, 8);
      g.applyDamage(best, dmg, car, { kind: 'energy', x: to.x, y: to.y, z: to.z });
      best.stun = 0.4;
      hitSet.add(best);
      from = to;
      dmg *= 0.7;
      range = 20;
    }
  }

  spawn(p) {
    if (!p.visual && this.game.net && (this.game.net.isHost || p.owner?.isPlayer)) this.game.net.shot(p);
    p.age = 0;
    p.px = p.x; p.py = p.y; p.pz = p.z;
    this.list.push(p);
    if (this.list.length > 900) this.list.shift();
    return p;
  }

  explode(x, y, z, dmg, radius, owner, team, knock = 6) {
    const g = this.game;
    g.fx.explosion(x, y, z, Math.min(2.2, 0.5 + radius / 6));
    g.audio?.play('explosion', _v.set(x, y, z));
    if (!(dmg > 0)) return; // visual-only (network mirrors)
    for (const c of g.cars) {
      if (!c.alive) continue;
      const dd = c.body.pos.distanceTo(_v.set(x, y, z));
      if (dd > radius + c.body.radius * 0.6) continue;
      const f = 1 - Math.max(0, dd - c.body.radius * 0.5) / radius;
      if (c !== owner && !this.canHit(owner, team, c)) continue;
      const amt = dmg * Math.max(0.15, f);
      if (c === owner) { g.applyDamage(c, amt * 0.25, owner, { kind: 'explosive', x, y, z }); continue; }
      g.applyDamage(c, amt, owner, { kind: 'explosive', x, y, z });
      // knockback: lighter cars fly further
      _d.subVectors(c.body.pos, _v).setY(0).normalize();
      const imp = knock * 900 * f;
      c.body.vel.addScaledVector(_d, imp / c.stats.mass * 4);
      c.body.vel.y += (imp / c.stats.mass) * 5;
      c.body.angVel.x += (Math.random() - 0.5) * f * 3; c.body.angVel.z += (Math.random() - 0.5) * f * 3;
    }
    g.splashStructures(x, y, z, dmg, radius, owner, team);
    // ignite slicks
    for (const s of this.slicks) if (Math.hypot(s.x - x, s.z - z) < s.r + radius) s.fire = 8;
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    const T = g.terrain;
    const out = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.age > p.life) {
        if (p.kind === 'rocket' || p.kind === 'shell') this.explode(p.x, p.y, p.z, p.dmg, p.splash, p.owner, p.team, p.knock);
        continue;
      }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      if (p.kind === 'rocket') {
        const sp = p.speed * Math.min(1, 0.6 + p.age * 1.8);
        _d.set(p.vx, p.vy, p.vz).normalize();
        if (p.target && p.target.alive) {
          _v.copy(p.target.body.pos); _v.y += 0.8;
          _v.sub(_a.set(p.x, p.y, p.z)).normalize();
          _d.lerp(_v, Math.min(1, p.homing * dt)).normalize();
        }
        p.vx = _d.x * sp; p.vy = _d.y * sp; p.vz = _d.z * sp;
        if (Math.random() < 0.6 * g.fx.quality) g.fx.smoke(p.x, p.y, p.z, 0.85, 0.45);
      }
      if (p.grav) p.vy += p.grav * dt;
      if (p.kind === 'flame') { p.vx *= 1 - 1.5 * dt; p.vz *= 1 - 1.5 * dt; p.vy += 2 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      // car hits
      let hit = null, ht = 2;
      const rad = p.radius || 0;
      for (const c of g.cars) {
        if (!c.alive || c === p.owner) continue;
        if (!this.canHit(p.owner, p.team, c)) continue;
        const bp = c.body.pos;
        const dx = bp.x - p.x, dz = bp.z - p.z;
        const reach = c.body.radius + 6 + rad;
        if (dx * dx + dz * dz > reach * reach) continue;
        for (const s of c.body.spheres) {
          s.world.copy(s.local).applyQuaternion(c.body.quat).add(bp);
          const t = segSphere(p.px, p.py, p.pz, p.x, p.y, p.z, s.world.x, s.world.y, s.world.z, s.r + rad + 0.15);
          if (t >= 0 && t < ht) { ht = t; hit = c; }
        }
      }
      if (hit) {
        const hx = p.px + (p.x - p.px) * ht, hy = p.py + (p.y - p.py) * ht, hz = p.pz + (p.z - p.pz) * ht;
        if (p.kind === 'bullet') {
          g.applyDamage(hit, p.dmg, p.owner, { kind: 'bullet', x: hx, y: hy, z: hz });
          g.fx.sparkBurst(hx, hy, hz, 4, 0xffe08a, 7);
          hit.body.vel.addScaledVector(_d.set(p.vx, p.vy, p.vz).normalize(), p.dmg * 3 / hit.stats.mass);
        } else if (p.kind === 'flame') {
          g.applyDamage(hit, p.dmg, p.owner, { kind: 'fire', x: hx, y: hy, z: hz, quiet: true });
          hit.burn = Math.max(hit.burn, p.burn);
          hit.burnBy = p.owner;
        } else this.explode(hx, hy, hz, p.dmg, p.splash, p.owner, p.team, p.knock);
        continue;
      }
      // terrain
      const gh = T.heightAt(p.x, p.z);
      if (p.y < gh) {
        if (p.kind === 'bullet') { if (Math.random() < 0.35) g.fx.dust(p.x, gh, p.z, T.biomeAt(p.x, p.z).dust, 0.5); }
        else if (p.kind === 'flame') { /* fizzle */ }
        else this.explode(p.x, gh + 0.3, p.z, p.dmg, p.splash, p.owner, p.team, p.knock);
        continue;
      }
      // structures & solid props
      if (p.kind !== 'flame' || Math.random() < 0.3) {
        const s = g.structureAt(p.x, p.y, p.z, p.team);
        if (s) {
          if (p.kind === 'bullet' || p.kind === 'flame') { g.damageStructure(s, p.dmg, p.owner); g.fx.sparkBurst(p.x, p.y, p.z, 3, 0xffe08a, 6); }
          else this.explode(p.x, p.y, p.z, p.dmg, p.splash, p.owner, p.team, p.knock);
          continue;
        }
        if (p.kind !== 'flame' && g.solidAt(p.x, p.y, p.z)) {
          if (p.kind === 'bullet') g.fx.sparkBurst(p.x, p.y, p.z, 3, 0xffe08a, 6);
          else this.explode(p.x, p.y, p.z, p.dmg, p.splash, p.owner, p.team, p.knock);
          continue;
        }
      }
      // flames ignite slicks
      if (p.kind === 'flame') for (const s of this.slicks) if (!s.fire && Math.hypot(s.x - p.x, s.z - p.z) < s.r) s.fire = 8;
      out.push(p);
    }
    this.list = out;

    // mines
    this.mines = this.mines.filter((m) => {
      m.life -= dt; m.arm -= dt;
      if (m.life <= 0) return false;
      if (m.arm > 0) return true;
      for (const c of g.cars) {
        if (!c.alive || c === m.owner || !this.canHit(m.owner, m.team, c)) continue;
        if (Math.hypot(c.body.pos.x - m.x, c.body.pos.z - m.z) < 2.5 + c.body.radius * 0.5) {
          this.explode(m.x, m.y + 0.5, m.z, m.dmg, m.splash, m.owner, m.team, 10);
          return false;
        }
      }
      return true;
    });
    // slicks
    this.slicks = this.slicks.filter((s) => {
      s.life -= dt;
      if (s.fire > 0) {
        s.fire -= dt;
        if (Math.random() < 0.7 * g.fx.quality) g.fx.fire(s.x + (Math.random() - 0.5) * s.r * 1.6, s.y + 0.3, s.z + (Math.random() - 0.5) * s.r * 1.6, 1.4);
        if (s.fire <= 0) return false;
      }
      for (const c of g.cars) {
        if (!c.alive) continue;
        if (Math.hypot(c.body.pos.x - s.x, c.body.pos.z - s.z) < s.r + c.body.radius * 0.4) {
          if (c !== s.owner) c.slick = 0.4;
          if (s.fire > 0) { c.burn = Math.max(c.burn, 3); c.burnBy = s.owner; }
        }
      }
      return s.life > 0;
    });
    this.render();
  }

  render() {
    const counts = { bullet: 0, shell: 0, rocket: 0, mine: 0, slick: 0 };
    for (const p of this.list) {
      const mesh = this.meshes[p.kind];
      if (!mesh) continue;
      _d.set(p.vx, p.vy, p.vz);
      const len = _d.length();
      if (len > 0.01) _q.setFromUnitVectors(Z, _d.divideScalar(len)); else _q.identity();
      _s.set(1, 1, p.kind === 'bullet' ? Math.min(1.5, len / 150) : 1);
      _m.compose(_v.set(p.x, p.y, p.z), _q, _s);
      mesh.setMatrixAt(counts[p.kind]++, _m);
    }
    for (const m of this.mines) {
      _m.compose(_v.set(m.x, m.y, m.z), _q.identity(), _s.set(1, 1, 1));
      this.meshes.mine.setMatrixAt(counts.mine++, _m);
    }
    for (const s of this.slicks) {
      _m.compose(_v.set(s.x, s.y, s.z), _q.identity(), _s.set(s.r, 1, s.r));
      this.meshes.slick.setMatrixAt(counts.slick++, _m);
    }
    for (const k in counts) {
      const mesh = this.meshes[k];
      mesh.count = Math.min(counts[k], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear() { this.list.length = 0; this.mines.length = 0; this.slicks.length = 0; }
}
