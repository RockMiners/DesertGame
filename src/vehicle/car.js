// Car entity: physics body + design stats + consumables + weapons state.
import * as THREE from 'three';
import { VehicleBody } from './physics.js';
import { designStats, DEFAULT_DESIGN } from './parts.js';
import { clamp, angleWrap } from '../core/math.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Car {
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name || 'Driver';
    this.npcId = opts.npcId || null;
    this.playerId = opts.playerId || null;
    this.isPlayer = !!opts.isPlayer;
    this.isRemote = !!opts.isRemote;
    this.team = opts.team || 'neutral';
    this.squadId = opts.squadId || null;
    this.role = opts.role || 'driver';
    this.alive = true;
    this.aimPoint = new THREE.Vector3();
    this.triggers = [false, false];
    this.cargo = {};
    this.hitFlash = 0;
    this.shieldFlash = 0;
    this.burn = 0;
    this.spawnProtect = 0;
    this.lastHitBy = null;
    this.lastHitTime = -99;
    this.nitro = 1;
    this.jumpCd = 0;
    this.stunt = { air: 0, spin: 0, flips: 0 };
    this.age = 0;
    this.slick = 0;
    this.setDesign(opts.design || DEFAULT_DESIGN, true);
  }

  setDesign(design, fresh = false) {
    const oldBody = this.body;
    this.design = JSON.parse(JSON.stringify(design));
    this.stats = designStats(this.design);
    const body = new VehicleBody(this.stats);
    if (oldBody) {
      body.pos.copy(oldBody.pos); body.quat.copy(oldBody.quat); body.vel.copy(oldBody.vel);
      body.pos.y += 1.5; body.updateFrame();
    }
    this.body = body;
    if (fresh) {
      this.hp = this.stats.hp;
      this.fuel = this.stats.fuelCap;
      this.ammo = this.stats.ammoCap;
      this.energy = this.stats.energyCap;
      this.shield = this.stats.flags.shield ? 160 : 0;
    } else {
      this.hp = Math.min(this.hp, this.stats.hp);
      this.fuel = Math.min(this.fuel, this.stats.fuelCap);
      this.ammo = Math.min(this.ammo, this.stats.ammoCap);
      this.energy = Math.min(this.energy, this.stats.energyCap);
    }
    this.weapons = this.stats.weapons.map((def) => ({
      def, mount: def.mount, kind: def.kind, cooldown: 0, yaw: 0, pitch: 0, justFired: false, firing: false, heat: 0,
    }));
    if (this.view) this.view.build();
  }

  get controls() { return this.body.controls; }
  get pos() { return this.body.pos; }

  cargoUsed() { let s = 0; for (const k in this.cargo) s += this.cargo[k]; return s; }
  cargoFree() { return Math.max(0, this.stats.cargo - this.cargoUsed()); }
  addCargo(res, amt) {
    const n = Math.min(amt, this.cargoFree());
    if (n <= 0) return 0;
    this.cargo[res] = (this.cargo[res] || 0) + n;
    return n;
  }
  takeCargo(res, amt) {
    const n = Math.min(amt, this.cargo[res] || 0);
    this.cargo[res] = (this.cargo[res] || 0) - n;
    if (this.cargo[res] <= 0) delete this.cargo[res];
    return n;
  }

  // Per-frame consumables & status (physics runs separately)
  updateStatus(dt, env) {
    this.age += dt;
    const st = this.stats, ctl = this.controls;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    this.spawnProtect = Math.max(0, this.spawnProtect - dt);
    this.jumpCd = Math.max(0, this.jumpCd - dt);
    this.slick = Math.max(0, this.slick - dt);
    // fuel use
    const thr = Math.abs(ctl.throttle);
    let powerFactor = 1;
    if (st.usesFuel) {
      const use = st.fuelPerSec * (0.15 + 0.85 * thr) * (ctl.boost ? 1.8 : 1) * (env.fuelMult ?? 1);
      this.fuel = Math.max(0, this.fuel - use * dt);
      if (this.fuel <= 0 && this.cargo.fuel > 0) { const n = this.takeCargo('fuel', Math.min(this.cargo.fuel, st.fuelCap)); this.fuel += n; env.onRefuel?.(n); }
      if (this.fuel <= 0) powerFactor = 0.18; // running on fumes
    }
    // energy
    let regen = st.energyRegen;
    if (st.flags.solar) regen += st.flags.solar * env.daylight;
    if (st.usesEnergy) regen -= st.engine.energy * (0.1 + 0.9 * thr) * (ctl.boost ? 1.6 : 1);
    this.energy = clamp(this.energy + regen * dt, 0, st.energyCap);
    if (st.usesEnergy && this.energy <= 0.5) powerFactor = 0.2;
    // nitro
    if (ctl.boost) {
      if (st.flags.nitro && this.nitro > 0) this.nitro = Math.max(0, this.nitro - dt / (3.5 * st.flags.nitro));
      else ctl.boost = 0;
    } else if (st.flags.nitro) this.nitro = Math.min(1, this.nitro + dt / 14);
    // shield recharge
    if (st.flags.shield) {
      const maxS = 160 * st.flags.shield;
      if (this.shield < maxS && this.energy > 5 && env.time - this.lastHitTime > 3) {
        const n = Math.min(maxS - this.shield, 20 * dt);
        this.shield += n; this.energy -= n * 0.3;
      }
    }
    // repair drone
    if (st.flags.repair && this.hp < st.hp && env.time - this.lastHitTime > 4) {
      if ((this.cargo.scrap || 0) > 0 || !this.isPlayer) {
        const n = Math.min(st.hp - this.hp, st.flags.repair * dt * Math.max(1, st.size));
        this.hp += n;
        if (this.isPlayer) { this._repairAcc = (this._repairAcc || 0) + n / 25; if (this._repairAcc >= 1) { this.takeCargo('scrap', 1); this._repairAcc -= 1; } }
      }
    }
    this.powerFactor = powerFactor;
    this.boostVisual = !!ctl.boost;
    // weapons cooldowns & turret tracking
    for (const w of this.weapons) w.cooldown = Math.max(0, w.cooldown - dt);
  }

  // Aim turrets toward aimPoint (local yaw/pitch, rate-limited)
  aimTurrets(dt) {
    const b = this.body;
    _q.copy(b.quat).invert();
    for (const w of this.weapons) {
      if (w.kind === 'rear') continue;
      const mount = this.stats.mounts[w.mount];
      _v.copy(this.aimPoint).sub(b.pos).applyQuaternion(_q);
      _v.x -= mount.pos[0]; _v.y -= mount.pos[1]; _v.z -= mount.pos[2];
      let tYaw = Math.atan2(_v.x, _v.z);
      let tPitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
      if (w.kind === 'fixed') { tYaw = clamp(tYaw, -0.12, 0.12); tPitch = clamp(tPitch, -0.15, 0.2); }
      else tPitch = clamp(tPitch, -0.35, 0.9);
      const rate = (w.def.id === 'cannon' ? 2.2 : 4.5) * dt;
      w.yaw += clamp(angleWrap(tYaw - w.yaw), -rate, rate);
      w.pitch += clamp(tPitch - w.pitch, -rate, rate);
      w.aligned = Math.abs(angleWrap(tYaw - w.yaw)) < 0.12 && Math.abs(tPitch - w.pitch) < 0.15;
    }
  }

  // World-space muzzle position and direction for weapon w
  muzzle(w, outPos, outDir) {
    const b = this.body;
    const mount = this.stats.mounts[w.mount];
    const sc = Math.min(2.2, 0.85 + this.stats.size * 0.25);
    if (w.kind === 'rear') {
      outDir.set(0, 0, -1).applyQuaternion(b.quat);
      outPos.set(...mount.pos).applyQuaternion(b.quat).add(b.pos).addScaledVector(outDir, 0.5);
      return;
    }
    const cy = Math.cos(w.yaw), sy = Math.sin(w.yaw), cp = Math.cos(w.pitch), spp = Math.sin(w.pitch);
    outDir.set(sy * cp, spp, cy * cp).applyQuaternion(b.quat);
    outPos.set(mount.pos[0], mount.pos[1] + 0.45 * sc, mount.pos[2]).applyQuaternion(b.quat).add(b.pos).addScaledVector(outDir, 1.2 * sc);
  }

  speedKmh() { return this.body.speed() * 3.6; }
}
