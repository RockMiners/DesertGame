// Tactical driving AI for NPC cars: steering, obstacle avoidance, combat styles, formation following.
import * as THREE from 'three';
import { clamp, angleWrap } from '../core/math.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _t = new THREE.Vector3();

// Formation offset [lateral, longitudinal] (negative = behind) rotated into world space for a leader heading
export function slotOffset(h, off) {
  return [-Math.cos(h) * off[0] + Math.sin(h) * off[1], Math.sin(h) * off[0] + Math.cos(h) * off[1]];
}

// Slots for a group (index 0 is the leader). Column: nose to tail, gaps sized to the cars either side.
// Wedge: alternating sides, folding into two files after the second rank so big warbands stay compact.
export function formationSlots(sizes, shape = 'wedge', back0 = 0) {
  const out = [[0, 0]];
  const sp = 9 * Math.sqrt(Math.max(1, ...sizes));
  let back = back0;
  for (let i = 1; i < sizes.length; i++) {
    if (shape === 'column') {
      back += 9 * Math.sqrt(Math.max(1, sizes[i - 1], sizes[i]));
      out.push([0, -back]);
    } else {
      const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      out.push([side * sp * 0.75 * Math.min(rank, 2), -back0 - sp * rank]);
    }
  }
  return out;
}

export class DriverAI {
  constructor(car, game, opts = {}) {
    this.car = car;
    this.game = game;
    this.order = opts.order || { type: 'idle' };
    this.skill = opts.skill ?? 0.5;
    this.courage = opts.courage ?? 0.5;
    this.aggro = opts.aggro ?? 160;
    this.target = null;
    this.think = Math.random() * 0.3;
    this.stuckT = 0;
    this.reverseT = 0;
    this.reverseSteer = 0;
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.joustPhase = 0;
    this.avoid = 0;
    this.lastPos = new THREE.Vector3().copy(car.body.pos);
    this.fleeing = false;
    this.honk = 0;
    this.thrS = 0; // smoothed throttle for formation driving
    this.lsS = 0; // smoothed leader speed
    this.overrun = false; // ahead of our formation slot: allowed to brake
    this.slotDist = 0; // how far a follower is from its formation slot (read by the bridge)
    this.boostWish = false;
    const ws = car.weapons;
    const hasTurret = ws.some((w) => w.kind === 'turret');
    const range = ws.reduce((m, w) => Math.max(m, w.def.range || 40), 30);
    this.prefRange = clamp(range * 0.45, 14, 90);
    this.style = car.stats.flags.ram || car.stats.flags.spikes || (car.stats.mass > 3000 && !hasTurret) ? 'ram' : hasTurret ? 'orbit' : 'joust';
    car.skill = this.skill;
  }

  // re-issuing the same kind of order (the bridge refreshes them) must not reset combat manoeuvres
  setOrder(o) { if (!this.order || o.type !== this.order.type) this.joustPhase = 0; this.order = o; }

  update(dt) {
    const car = this.car, g = this.game, b = car.body;
    const ctl = b.controls;
    if (!car.alive) { ctl.throttle = 0; ctl.steer = 0; return; }
    if (car.stun > 0) { car.stun -= dt; ctl.throttle *= 0.9; }
    ctl.boost = 0;
    this.boostWish = false;
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.25 + Math.random() * 0.15;
      this.perceive();
    }
    // flip recovery
    if (b.flipTimer > 1.6) b.flipUpright(g.terrain);

    let dest = null, wantSpeed = 1, mode = 'move', hold;
    const tgt = this.target && this.target.alive ? this.target : null;
    const o = this.order;
    if (tgt && !this.fleeing) {
      mode = 'fight';
      dest = this.combatDest(tgt, dt);
    } else if (this.fleeing && this.fleeFrom) {
      _v.subVectors(b.pos, this.fleeFrom).setY(0).normalize().multiplyScalar(80);
      dest = _t.copy(b.pos).add(_v);
    } else if (o.type === 'goto' || o.type === 'patrol') {
      dest = _t.set(o.x, 0, o.z);
      const d = Math.hypot(o.x - b.pos.x, o.z - b.pos.z);
      if (d < (o.radius || 18)) {
        if (o.type === 'patrol' && o.points) { o.i = ((o.i || 0) + 1) % o.points.length; o.x = o.points[o.i][0]; o.z = o.points[o.i][1]; }
        else { wantSpeed = 0; this.arrived = true; }
      } else wantSpeed = o.speed ?? 1;
      if (o.slowNear && d < 40) wantSpeed = Math.min(wantSpeed, 0.4);
    } else if (o.type === 'follow' && o.leader && o.leader.alive) {
      const L = o.leader.body;
      const h = L.heading(), fx = Math.sin(h), fz = Math.cos(h);
      const [ox, oz] = slotOffset(h, o.offset || [6, -10]);
      const sx = L.pos.x + ox, sz = L.pos.z + oz;
      const d = Math.hypot(sx - b.pos.x, sz - b.pos.z);
      const along = (sx - b.pos.x) * fx + (sz - b.pos.z) * fz; // + = we trail our slot
      const ls = (this.lsS += (Math.max(0, L.forwardSpeed()) - this.lsS) * Math.min(1, dt * 2));
      this.slotDist = d;
      this.overrun = along < -6;
      if (d > 30) {
        // dropped out of formation: flat out (nitro too, if fitted) back to the slot
        dest = _t.set(sx + fx * 6, 0, sz + fz * 6);
        wantSpeed = 1;
        this.boostWish = true;
      } else {
        // in formation: aim ahead of the slot along the leader's heading, match its pace and close the gap gently
        const look = clamp(6 + ls * 0.7, 8, 24) + Math.max(0, -along);
        dest = _t.set(sx + fx * look, 0, sz + fz * look);
        hold = d < 4 && ls < 1.5 ? 0 : Math.max(0, ls + clamp(along, -15, 20) * 0.45);
        wantSpeed = clamp(hold / Math.max(10, car.stats.topSpeed), 0, 1);
      }
    } else if (o.type === 'siege') {
      // circle the compound and shoot the buildings, turrets first
      const st = this.structTarget;
      const a = g.time * 0.12 * this.orbitDir + (car.id.charCodeAt(car.id.length - 1) % 7);
      dest = _t.set(o.x + Math.cos(a) * o.r, 0, o.z + Math.sin(a) * o.r);
      if (st && this.style === 'ram') dest = _t.set(st.x, 0, st.z);
      wantSpeed = 0.6;
      mode = 'fight';
    } else if (o.type === 'guard') {
      const a = g.time * 0.05 + (car.id.charCodeAt(car.id.length - 1) % 7); // spread guards round the ring
      dest = _t.set(o.x + Math.cos(a) * (o.r || 30), 0, o.z + Math.sin(a) * (o.r || 30));
      wantSpeed = 0.35;
    } else {
      wantSpeed = 0;
    }
    if (!dest) { ctl.throttle = 0; ctl.steer = 0; ctl.handbrake = 1; this.fireControl(null, dt); return; }
    ctl.handbrake = 0;
    this.drive(dest, wantSpeed, dt, mode, mode === 'move' ? hold : undefined);
    if (!tgt && this.structTarget && !this.fleeing) this.fireAtStructure(this.structTarget, dt);
    else this.fireControl(tgt, dt);
  }

  perceive() {
    const car = this.car, g = this.game;
    const b = car.body;
    if (g.inSafeZone(b.pos.x, b.pos.z)) { this.target = null; return; }
    let best = null, bestScore = Infinity;
    const range = this.order.aggro ?? this.aggro;
    // followers only fight what threatens the group: targets near their leader
    const o = this.order;
    const anchor = o.type === 'follow' && o.leader?.alive ? o.leader.body.pos : null;
    const leash = o.leash ?? 120;
    for (const c of g.cars) {
      if (c === car || !c.alive || !g.hostile(car, c)) continue;
      if (g.inSafeZone(c.body.pos.x, c.body.pos.z)) continue;
      const d = c.body.pos.distanceTo(b.pos);
      if (d > range) continue;
      if (anchor && c.body.pos.distanceTo(anchor) > leash * (c === car.lastHitBy ? 1.5 : 1)) continue;
      let score = d;
      if (c === car.lastHitBy && g.time - car.lastHitTime < 8) score *= 0.4;
      if (this.order.focus && c.id === this.order.focus) score *= 0.3;
      if (c.isPlayer) score *= g.director ? g.director.playerTargetBias(car) : 1;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    this.target = best;
    this.structTarget = null;
    if (!best && (this.order.type === 'siege' || (this.order.aggro ?? this.aggro) > 150) && g.structures && range > 0) {
      this.structTarget = g.structures.nearestHostile(car.team, b.pos.x, b.pos.z, this.order.type === 'siege' ? 170 : 90);
    }
    // morale: flee when badly hurt (courage dependent), regroup when healed
    const hpFrac = car.hp / car.stats.hp;
    if (!this.fleeing && best && hpFrac < 0.22 * (1.4 - this.courage) && !this.order.noFlee) {
      this.fleeing = true; this.fleeFrom = best.body.pos.clone();
      g.onNpcFlee?.(car);
    } else if (this.fleeing && (!best || hpFrac > 0.5)) this.fleeing = false;
    // Honk at the player when idle nearby (cute)
    if (!best && g.player?.car && g.player.car.alive && b.pos.distanceTo(g.player.car.body.pos) < 12 && Math.random() < 0.03) g.audio?.play('honk', b.pos);
  }

  combatDest(tgt, dt) {
    const b = this.car.body, tb = tgt.body;
    const d = tb.pos.distanceTo(b.pos);
    if (this.style === 'ram') {
      // lead the target
      const t = Math.min(1.2, d / Math.max(10, b.speed()));
      this.car.controls.boost = d < 60 && d > 12 ? 1 : 0;
      return _t.copy(tb.pos).addScaledVector(tb.vel, t);
    }
    if (this.style === 'joust') {
      // charge, overshoot, loop around
      if (this.joustPhase === 0) {
        if (d < 12) { this.joustPhase = 1; this.joustT = 2.2; }
        return _t.copy(tb.pos).addScaledVector(tb.vel, 0.4);
      }
      this.joustT -= dt;
      if (this.joustT <= 0 || d > 70) this.joustPhase = 0;
      _v.subVectors(b.pos, tb.pos).setY(0).normalize();
      return _t.copy(b.pos).addScaledVector(_v, 30).addScaledVector(b.fwd, 25);
    }
    // orbit at preferred range
    _v.subVectors(b.pos, tb.pos).setY(0);
    const cur = _v.length() || 1;
    _v.divideScalar(cur);
    const perp = new THREE.Vector3(-_v.z * this.orbitDir, 0, _v.x * this.orbitDir);
    const radial = clamp((cur - this.prefRange) / 20, -1, 1);
    _t.copy(tb.pos).addScaledVector(_v, this.prefRange).addScaledVector(perp, 22);
    _t.addScaledVector(_v, -radial * 10);
    if (Math.random() < 0.002) this.orbitDir *= -1;
    return _t;
  }

  // hold: optional target speed (m/s) for smooth formation keeping instead of throttle-or-brake
  drive(dest, wantSpeed, dt, mode, hold) {
    const car = this.car, g = this.game, b = car.body, ctl = b.controls;
    const T = g.terrain;
    _v.set(dest.x - b.pos.x, 0, dest.z - b.pos.z);
    const dist = _v.length();
    const heading = b.heading();
    const desired = Math.atan2(_v.x, _v.z);
    let ang = angleWrap(desired - heading); // + = target to the left (since +x is left when facing +z)
    // obstacle & terrain avoidance probes
    if (this.think > 0.24 || this.avoidCache === undefined) {
      const look = 10 + b.speed() * 0.9 + car.stats.size * 4;
      let bias = 0;
      const h0 = T.heightAt(b.pos.x, b.pos.z);
      for (const off of [-0.45, 0, 0.45]) {
        const a = heading + off;
        const px = b.pos.x + Math.sin(a) * look, pz = b.pos.z + Math.cos(a) * look;
        const hh = T.heightAt(px, pz);
        const climb = (hh - h0) / look;
        let bad = 0;
        if (climb > 0.55 - car.stats.size * 0.05 + (car.design.wheels === 'tracks' ? 0.25 : 0)) bad += 1;
        if (car.design.wheels !== 'hover') { const L = T.liquidAt(px, pz); if (L && (L.damage > 0 || L.depth > 1)) bad += 1.2; }
        if (g.solidNear(px, pz, 3 + car.stats.chassis.wid)) bad += 1;
        if (!T.inBounds(px * 1.04, pz * 1.04)) bad += 2;
        if (bad) bias += (off === 0 ? (ang >= 0 ? 1 : -1) : -Math.sign(off)) * bad;
      }
      this.avoidCache = bias;
    }
    const avoid = this.avoidCache;
    ang += avoid * 0.6;
    // stuck detection
    const moved = b.pos.distanceTo(this.lastPos);
    this.lastPos.copy(b.pos);
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      ctl.throttle = -1;
      ctl.steer = this.reverseSteer;
      return;
    }
    if (wantSpeed > 0.2 && moved / Math.max(dt, 1e-3) < 1.2 && ctl.throttle > 0.3) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 1.4) { this.stuckT = 0; this.reverseT = 1.1 + Math.random() * 0.6; this.reverseSteer = ang > 0 ? 1 : -1; return; }
    // steer: our steer +1 turns right, which is negative angle
    let steer = clamp(-ang * 2.2, -1, 1);
    let thr = wantSpeed;
    const behind = Math.abs(ang) > 2.2;
    if (behind && dist < 22 && mode !== 'fight') { thr = -0.8; steer = clamp(ang * 2, -1, 1); }
    else {
      const spd = b.forwardSpeed();
      if (hold !== undefined) {
        // feed-forward + proportional, low-passed: no pumping between brake and throttle in formation
        let h = hold / Math.max(10, car.stats.topSpeed) + (hold - spd) * 0.08;
        h = spd > hold + 4 && this.overrun ? clamp((hold - spd) * 0.06, -0.6, 0) : clamp(h, 0, 1); // brake only when overrunning the slot
        this.thrS += (h - this.thrS) * Math.min(1, dt * 4);
        thr = this.thrS;
      } else {
        const target = wantSpeed * car.stats.topSpeed;
        if (spd > target + 2) thr = spd > target + 8 ? -0.5 : 0;
        if (dist < 10 && mode !== 'fight') thr = Math.min(thr, 0.3);
        this.thrS = thr;
      }
      if (Math.abs(ang) > 0.9) thr = Math.min(thr, 0.55);
      if (this.boostWish && car.stats.flags.nitro && car.nitro > 0.15 && Math.abs(ang) < 0.3) ctl.boost = 1;
    }
    ctl.throttle = thr;
    ctl.steer = steer;
    ctl.handbrake = mode === 'fight' && Math.abs(ang) > 1.3 && b.speed() > 12 ? 1 : 0;
    ctl.pitch = 0;
  }

  fireAtStructure(st, dt) {
    const car = this.car, b = car.body;
    car.aimPoint.set(st.x, st.y + Math.min(4, st.h * 0.5), st.z);
    const d = Math.hypot(st.x - b.pos.x, st.z - b.pos.z);
    if (car.weapons.some((w) => w.def.id === 'cannon')) car.aimPoint.y += d * d * 0.00035;
    car.aimTurrets(dt);
    car.triggers[0] = car.weapons.some((w) => w.kind !== 'rear' && d < (w.def.range || 50) * 0.9) && Math.random() < 0.9;
    car.triggers[1] = false;
  }

  fireControl(tgt, dt) {
    const car = this.car, g = this.game, b = car.body;
    car.triggers[0] = false; car.triggers[1] = false;
    if (!tgt) { car.aimPoint.copy(b.pos).addScaledVector(b.fwd, 30); car.aimPoint.y += 1; car.aimTurrets(dt); return; }
    const tb = tgt.body;
    const d = tb.pos.distanceTo(b.pos);
    const hasToken = !tgt.isPlayer || !g.director || g.director.hasToken(car, tgt);
    const w0 = car.weapons.find((w) => w.kind !== 'rear');
    const speed = w0?.def.speed || 200;
    const lead = Math.min(1.5, d / speed);
    const err = (1 - this.skill) * (hasToken ? 1 : 3) * (tgt.isPlayer ? (g.director?.accuracyMult() ?? 1) : 1);
    car.aimPoint.copy(tb.pos).addScaledVector(tb.vel, lead * (0.6 + this.skill * 0.4));
    car.aimPoint.y += 0.8;
    car.aimPoint.x += Math.sin(g.time * 1.7 + this.orbitDir) * err * 3.5;
    car.aimPoint.z += Math.cos(g.time * 1.3) * err * 3.5;
    if (w0?.def.id === 'cannon') car.aimPoint.y += d * d * 0.00035; // arc
    car.aimTurrets(dt);
    const inRange = car.weapons.some((w) => w.kind !== 'rear' && d < (w.def.range || 50) * 0.95);
    const fireChance = hasToken ? 1 : 0.4;
    if (inRange && (this._burst = (this._burst || 0) - dt) < 0) {
      if (Math.random() < fireChance) car.triggers[0] = true;
      if (this._burst < -1.5 - Math.random() * 1.5) this._burst = 0.8 + Math.random() * 1.2;
    }
    // drop mines when being chased
    _v.subVectors(tb.pos, b.pos);
    if (_v.dot(b.fwd) < -5 && d < 30) car.triggers[1] = true;
  }
}
