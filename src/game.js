// Game orchestrator: world, rendering, physical entities, combat, player control, and hooks into the strategic sim.
import * as THREE from 'three';
import { generateWorld } from './world/worldgen.js';
import { TerrainRenderer } from './render/terrainMesh.js';
import { PropsRenderer } from './render/propsRenderer.js';
import { Sky } from './render/sky.js';
import { FX } from './render/fx.js';
import { Tracks } from './render/tracks.js';
import { ChaseCamera } from './render/camera.js';
import { AdaptiveQuality } from './render/perf.js';
import { WheelPool, CarView } from './render/carView.js';
import { Car } from './vehicle/car.js';
import { collideBodies, collideStatic } from './vehicle/physics.js';
import { Combat } from './combat/combat.js';
import { Pickups, lootText } from './world/pickups.js';
import { DriverAI } from './ai/driver.js';
import { Input } from './core/input.js';
import { clamp, uid, RNG } from './core/math.js';
import { BIOMES } from './world/biomes.js';
import { PROP_INFO } from './world/worldgen.js';

const FIXED = 1 / 60;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ray = new THREE.Vector3(), _aimDir = new THREE.Vector3(), _hit = {};
const _q = new THREE.Quaternion(), _dark = new THREE.Color(), _mods = { powerFactor: 1 }, _deadMods = { powerFactor: 0 }, _anchors = [];
const LOD_R2 = 160 * 160; // beyond this from any player car, AI physics runs 1 substep instead of 2
import { HUB_SAFE_R } from './sim/constants.js';
export { HUB_SAFE_R };
const DESTRUCTIBLE = new Set(['cactus', 'barrel', 'sign', 'lamp', 'deadtree', 'mushroom', 'billboard', 'skull', 'pipe', 'wreck', 'palm']);

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.time = 0;
    this.acc = 0;
    this.paused = false;
    this.cars = [];
    this.carById = new Map();
    this.views = new Map();
    this.friendlyFire = false;
    this.listeners = {};
    this.quality = opts.quality ?? 1;
    this._env = { daylight: 1, time: 0, fuelMult: 1, onRefuel: null };
    this._onRefuel = (n) => this.ui?.toast(`Refuelled ${Math.round(n)} L from cargo`, 'info');
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const f of this.listeners[ev] || []) f(...a); }

  async init(seed, progress = () => {}) {
    this.seed = seed;
    progress('Shaping dunes...', 0.1);
    await tick();
    this.world = generateWorld(seed);
    this.terrain = this.world.terrain;
    this.colliders = this.world.colliders;
    progress('Painting the wasteland...', 0.45);
    await tick();
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality > 0.5, powerPreference: 'high-performance' });
    renderer.setPixelRatio(this.pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = this.quality > 0.3;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.3, 4500);
    this.chase = new ChaseCamera(this.camera);
    this.sky = new Sky(this.scene, renderer);
    this.terrainR = new TerrainRenderer(this.scene, this.terrain);
    progress('Scattering junk...', 0.65);
    await tick();
    this.propsR = new PropsRenderer(this.scene, this.world.props);
    this.wheels = new WheelPool(this.scene);
    this.fx = new FX(this.scene, this.camera);
    this.fx.terrain = this.terrain;
    this.fx.quality = this.quality;
    this.tracks = new Tracks(this.scene);
    this.combat = new Combat(this);
    this.pickups = new Pickups(this, this.world.nodeSpawns);
    this.input = new Input(this.canvas);
    this.structGrid = null; // assigned by structures module
    addEventListener('resize', () => this.resize());
    progress('Warming engines...', 0.85);
    await tick();
    this.viewDist = 900;
    // base pixel ratio / fx quality are what was set above (respects opts.quality)
    this.perf = new AdaptiveQuality(this.renderer, { fx: this.fx, enabled: this.opts.adaptive !== false });
  }

  // Sharp on small or high-DPI windows, but never more than a budget of pixels per frame: a maximised
  // window on a 1440p or 150%-scaled screen would otherwise draw 2-4x the pixels of a 1080p one.
  pixelRatio() {
    const dpr = devicePixelRatio || 1, q = this.quality;
    const maxRatio = q >= 1 ? 1.75 : q > 0.5 ? 1.25 : 1;
    const budget = (q >= 1 ? 2.4 : q > 0.5 ? 1.6 : 1.0) * 1e6;
    const fit = Math.sqrt(budget / Math.max(1, innerWidth * innerHeight));
    return Math.max(0.5, Math.min(dpr, maxRatio, fit));
  }

  // Graphics setting, applied live (anti-aliasing is fixed when the page loads)
  setQuality(q) {
    this.quality = q;
    this.fx.quality = q;
    const shadows = q > 0.3;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    }
    this.resize();
  }

  resize() {
    this.renderer.setPixelRatio(this.pixelRatio());
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  // ---------- Entities ----------
  spawnCar(opts) {
    const car = new Car({ id: opts.id || uid('c'), ...opts });
    const x = opts.x ?? 0, z = opts.z ?? 0;
    car.body.placeAt(x, z, this.terrain, opts.heading ?? 0);
    car.prevPos = car.body.pos.clone();
    car.prevQuat = car.body.quat.clone();
    if (opts.hp !== undefined) car.hp = Math.min(car.stats.hp, opts.hp);
    if (opts.ai) car.ai = new DriverAI(car, this, opts.ai);
    car.view = new CarView(this.scene, car);
    car.collects = !!opts.collects;
    this.cars.push(car);
    this.carById.set(car.id, car);
    return car;
  }

  removeCar(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    this.carById.delete(car.id);
    car.view?.dispose();
    car.removed = true;
    for (const w of car.body.wheels) this.tracks.forget(car.id + w.local.x + w.local.z);
  }

  inSafeZone(x, z) { return x * x + z * z < HUB_SAFE_R * HUB_SAFE_R; }

  hostile(a, b) {
    if (a === b) return false;
    if (this.diplomacy) return this.diplomacy.hostileTeams(a.team, b.team);
    return a.team !== b.team;
  }

  // same side: same team, allied pact, Hub locals, or co-op teammates
  isFriendly(a, b) {
    if (a.team === b.team) return true;
    if (b.traffic || a.traffic) return true;
    if ((a.isPlayer || a.isRemotePlayer) && (b.isPlayer || b.isRemotePlayer)) return true;
    if (this.diplomacy?.pact && this.diplomacy.pact(a.team, b.team) === 'alliance') return true;
    return false;
  }

  hostileTeam(a, b) {
    if (a === b) return false;
    return this.diplomacy ? this.diplomacy.hostileTeams(a, b) : true;
  }

  structDamage(b, st, amt, team, source) {
    if (this.net && this.net.isClient) { this.net.send({ t: 'structDmg', b: b.id, s: st.id, amt, team }); return; }
    this.sim.damageStructure(b, st, amt, team);
    if (source?.isPlayer && !this.sim.s.bases[b.id]) this.emit('razedBase', b);
  }

  findTarget(car, pos, dir, cone, range) {
    let best = null, bestS = -Infinity;
    for (const c of this.cars) {
      if (c === car || !c.alive || !this.hostile(car, c)) continue;
      _v.subVectors(c.body.pos, pos);
      const d = _v.length();
      if (d > range) continue;
      const dot = _v.divideScalar(d).dot(dir);
      if (dot < 1 - cone) continue;
      const s = dot * 2 - d / range;
      if (s > bestS) { bestS = s; best = c; }
    }
    return best;
  }

  applyDamage(target, amount, source, opts = {}) {
    if (!target.alive || amount <= 0) return;
    if (target.spawnProtect > 0) return;
    if (this.inSafeZone(target.body.pos.x, target.body.pos.z)) return;
    // co-op: damage is decided on the machine that owns the shooter; a replica's shots are only for show
    if (source?.isRemote && !opts.fromNet) return;
    if (target.isRemote && this.net) { this.net.sendDamage(target, amount, source, opts); return; }
    let amt = amount;
    if (this.director) amt *= this.director.damageMult(target, source);
    if (opts.kind === 'explosive') amt *= 1 - target.stats.explosiveResist;
    if (target.shield > 0) {
      const s = Math.min(target.shield, amt);
      target.shield -= s; amt -= s;
      target.shieldFlash = 1;
    }
    target.hp -= amt;
    target.hitFlash = 1;
    target.lastHitBy = source || null;
    target.lastHitTime = this.time;
    if (source && source.isPlayer && !opts.quiet && amt > 0.5) {
      this.ui?.hitMarker();
      if (opts.x !== undefined && amt >= 4) this.fx.floatText(opts.x, opts.y + 1, opts.z, Math.round(amt), '#ffe066');
    }
    if (target.isPlayer && amt > 0) { this.ui?.damageFlash(Math.min(1, amt / 40), source); this.fx.shake += Math.min(0.5, amt / 80); }
    if (source && (source.isPlayer || source.isRemotePlayer) && !this.hostile(source, target) && !target.isPlayer && !target.isRemotePlayer) this.onAttackFriendly?.(target.team, target);
    if (target.ai && source && (this.hostile(target, source) || source.isPlayer)) target.ai.target = target.ai.target || source;
    this.emit('damage', target, amt, source);
    if (target.hp <= 0) this.killCar(target, source);
  }

  killCar(car, killer) {
    if (!car.alive) return;
    car.alive = false;
    car.hp = 0;
    const p = car.body.pos;
    this.fx.explosion(p.x, p.y + 1, p.z, 1.2 + car.stats.size * 0.35);
    this.fx.wreckDebris(p.x, p.y, p.z, car.design.paint || '#888', 8 + car.stats.size * 4);
    this.audio?.play('bigexplosion', p);
    // pop the wreck into the air for drama
    car.body.vel.y += 9; car.body.angVel.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
    car.deathTime = this.time;
    // loot: part of cargo + scrap
    if (!car.isPlayer) {
      const loot = { scrap: Math.round(4 + car.stats.mass / 300) };
      for (const [k, v] of Object.entries(car.cargo)) loot[k] = (loot[k] || 0) + Math.round(v * 0.6);
      if (car.ammo > 30) loot.ammo = Math.round(car.ammo * 0.25);
      if (car.lootCaps) loot.caps = car.lootCaps;
      this.pickups.drop(p.x + 2, p.z + 2, loot);
    }
    this.emit('kill', car, killer);
  }

  // ---------- Structures (bases) — provided by sim/structures ----------
  structureAt(x, y, z, team) { return this.structures ? this.structures.at(x, y, z, team) : null; }
  structureNear(x, z, r, team) { return this.structures ? this.structures.near(x, z, r, team) : null; }
  damageStructure(s, amt, source) { this.structures?.damage(s, amt, source); }
  splashStructures(x, y, z, dmg, r, owner, team) { this.structures?.splash(x, y, z, dmg, r, owner, team); }

  solidAt(x, y, z) {
    const list = this.colliders.query(x, z, 1);
    for (const c of list) {
      if (c.dead) continue;
      if (Math.hypot(c.x - x, c.z - z) < c.r && y < c.y + c.h && y > c.y - 1) return true;
    }
    return false;
  }
  solidNear(x, z, r) {
    const list = this.colliders.query(x, z, r);
    for (const c of list) if (!c.dead && Math.hypot(c.x - x, c.z - z) < c.r + r) return true;
    return this.structures ? this.structures.solidNear(x, z, r) : false;
  }

  // ---------- Aiming ----------
  computeAim(car) {
    // ray from camera through the crosshair (pointer lock) or the mouse cursor (no lock); hit terrain/cars
    const cam = this.camera;
    const o = cam.position;
    let d = this.chase.aimDir;
    const m = this.input.mouse;
    this.cursorAim = !m.locked && m.x > 0;
    if (this.cursorAim) {
      _ray.set((m.x / innerWidth) * 2 - 1, -(m.y / innerHeight) * 2 + 1, 0.5).unproject(cam).sub(o).normalize();
      d = _aimDir.copy(_ray);
    }
    let tHit = 600;
    let prevAbove = true;
    for (let t = 3; t < 600; t += t < 60 ? 2 : 6) {
      _ray.copy(o).addScaledVector(d, t);
      const above = _ray.y > this.terrain.heightAt(_ray.x, _ray.z);
      if (!above && prevAbove) {
        let lo = t - (t < 60 ? 2 : 6), hi = t;
        for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; _ray.copy(o).addScaledVector(d, m); if (_ray.y > this.terrain.heightAt(_ray.x, _ray.z)) lo = m; else hi = m; }
        tHit = hi; break;
      }
      prevAbove = above;
    }
    // soft aim assist: snap to hostile cars near the ray
    let best = null, bestScore = 0.06;
    for (const c of this.cars) {
      if (c === car || !c.alive || !this.hostile(car, c)) continue;
      _v.subVectors(c.body.pos, o);
      const along = _v.dot(d);
      if (along < 5 || along > 400) continue;
      _v2.copy(o).addScaledVector(d, along);
      const off = _v2.distanceTo(c.body.pos) / along;
      const s = off;
      if (s < bestScore) { bestScore = s; best = c; }
    }
    car.lockTarget = best;
    if (best) {
      const d2 = best.body.pos.distanceTo(car.body.pos);
      car.aimPoint.copy(best.body.pos).addScaledVector(best.body.vel, Math.min(1, d2 / 200));
      car.aimPoint.y += 0.6;
    } else car.aimPoint.copy(o).addScaledVector(d, tHit);
    // cannons need an arc
    const cannon = car.weapons.find((w) => w.def.id === 'cannon');
    if (cannon) { const dd = car.aimPoint.distanceTo(car.body.pos); car.aimPoint.y += dd * dd * 0.00035; }
    return best;
  }

  // ---------- Simulation step ----------
  physicsStep(dt) {
    const T = this.terrain;
    const daylight = this.sky ? clamp(this.sky.sunDir.y * 2, 0, 1) : 1;
    const env = this._env;
    env.daylight = daylight; env.time = this.time;
    // physics LOD anchors: the local player and co-op partners
    const pc = this.player?.car;
    _anchors.length = 0;
    if (pc) for (const c of this.cars) if (c === pc || c.isRemotePlayer) _anchors.push(c.body.pos);
    for (const car of this.cars) {
      car.prevPos.copy(car.body.pos);
      car.prevQuat.copy(car.body.quat);
      if (car.isRemote) continue;
      const sub = lodSubsteps(car, pc);
      if (!car.alive) {
        car.body.controls.throttle = 0; car.body.controls.steer = 0; car.body.controls.boost = 0;
        car.body.step(dt, T, _deadMods, sub);
        continue;
      }
      car.ai?.update(dt);
      env.fuelMult = car.isPlayer ? 1 : 0.5; env.onRefuel = car.isPlayer ? this._onRefuel : null;
      car.updateStatus(dt, env);
      // weapons
      for (const w of car.weapons) {
        const trig = w.kind === 'rear' ? car.triggers[1] : car.triggers[0];
        if (trig) this.combat.tryFire(car, w, dt);
      }
      _mods.powerFactor = car.powerFactor ?? 1;
      if (car.slick > 0) car.body.controls.handbrake = 1;
      car.body.step(dt, T, _mods, sub);
      // burning & liquids
      if (car.burn > 0) {
        car.burn -= dt;
        this.applyDamage(car, 6 * dt, car.burnBy, { kind: 'fire', quiet: true, fromNet: !!car.burnBy?.isRemote });
        if (Math.random() < 0.5) this.fx.fire(car.body.pos.x, car.body.pos.y + 1, car.body.pos.z, 1);
      }
      const L = car.body.inLiquid;
      if (L && L.damage > 0 && car.design.wheels !== 'hover') this.applyDamage(car, L.damage * dt, null, { kind: 'fire', quiet: true });
      // keep in world
      const lim = 1480;
      if (Math.abs(car.body.pos.x) > lim) { car.body.pos.x = Math.sign(car.body.pos.x) * lim; car.body.vel.x *= -0.3; }
      if (Math.abs(car.body.pos.z) > lim) { car.body.pos.z = Math.sign(car.body.pos.z) * lim; car.body.vel.z *= -0.3; }
    }
    // car vs car
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      const A = this.cars[i];
      for (let j = i + 1; j < n; j++) {
        const B = this.cars[j];
        if (A.isRemote && B.isRemote) continue;
        const imp = collideBodies(A.body, B.body, _hit);
        if (imp > 4) this.onRam(A, B, imp, _hit);
      }
      collideStatic(A.body, this.colliders, (c, vn) => this.onPropHit(A, c, vn));
      if (this.structures) this.structures.collide(A);
    }
  }

  onRam(A, B, imp, at) {
    this.fx.sparkBurst(at.x, at.y, at.z, Math.min(20, imp), 0xffd27a, 10);
    if (imp > 8) this.audio?.play('crash', _v.set(at.x, at.y, at.z), A.isPlayer || B.isPlayer);
    if (this.inSafeZone(at.x, at.z)) return;
    const hostile = this.hostile(A, B);
    const base = Math.max(0, imp - 6) * 1.6;
    if (base <= 0) return;
    // heavier car deals more, ram plates multiply, spikes add
    const mA = A.stats.mass, mB = B.stats.mass;
    const toB = base * Math.sqrt(mA / mB) * A.stats.ramMult * (A.stats.flags.spikes ? 1.3 : 1);
    const toA = base * Math.sqrt(mB / mA) * B.stats.ramMult * (A.stats.flags.ram ? 0.5 : 1);
    if (hostile || this.friendlyFire) {
      this.applyDamage(B, toB, A, { kind: 'ram', x: at.x, y: at.y, z: at.z });
      this.applyDamage(A, toA, B, { kind: 'ram', x: at.x, y: at.y, z: at.z });
    }
    if (A.isPlayer || B.isPlayer) this.fx.shake += Math.min(0.8, imp / 40);
  }

  onPropHit(car, c, vn) {
    if (c.kind !== 'prop' || !c.prop) return;
    const t = c.prop.type;
    const heavy = car.stats.mass * Math.max(0, vn) > 4000 || car.stats.flags.plow;
    if (DESTRUCTIBLE.has(t) && heavy && (PROP_INFO[t].r < 3 || car.stats.size > 2)) {
      c.dead = true;
      this.propsR.hide(c.prop);
      this.fx.wreckDebris(c.x, c.y, c.z, t === 'cactus' ? '#5aa83c' : t === 'palm' ? '#8b5e3c' : '#b5651d', 7);
      this.fx.dust(c.x, c.y + 1, c.z, 0xd9b382, 2);
      if (t === 'barrel') this.combat.explode(c.x, c.y + 0.6, c.z, 40, 6, null, null, 6);
      else this.audio?.play('smash', car.body.pos, car.isPlayer);
      if (car.isPlayer) this.emit('smash', t);
      car.body.vel.multiplyScalar(0.94);
      return 'pass';
    }
    if (vn > 12 && car.isPlayer) {
      this.audio?.play('crash', car.body.pos, true);
      this.fx.shake += 0.3;
      if (!this.inSafeZone(car.body.pos.x, car.body.pos.z)) this.applyDamage(car, (vn - 12) * 1.2, null, { kind: 'ram', quiet: true });
    }
    return null;
  }

  // ---------- Frame ----------
  // render=false steps the world without drawing (a co-op host whose tab is in the background)
  frame(dtReal, render = true) {
    const dt = Math.min(0.1, dtReal);
    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED && steps < 5) {
        this.preStep?.(FIXED);
        this.physicsStep(FIXED);
        this.acc -= FIXED;
        this.time += FIXED;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      this.combat.update(dt);
      this.structures?.tick(dt);
      this.pickups.update(dt, this.cars, this.focusPos());
      this.postUpdate?.(dt);
    }
    if (!render) { this.input.endFrame(); return; }
    this.renderFrame(dt, dtReal);
    this.input.endFrame();
  }

  focusPos() { return this.player?.car ? this.player.car.body.pos : this.camera.position; }

  renderFrame(dt, dtReal = dt) {
    const alpha = clamp(this.acc / FIXED, 0, 1);
    const focus = this.focusPos();
    const night = this.sky.nightness;
    this.wheels.begin();
    for (const car of this.cars) {
      const d = car.body.pos.distanceTo(this.camera.position);
      const vis = d < this.viewDist;
      car.view.setVisible(vis);
      if (!vis) continue;
      // co-op replicas are drawn straight from their snapshot timeline at this frame's time
      if (!(car.isRemote && this.net?.renderPose(car, _v, _q))) {
        _v.lerpVectors(car.prevPos, car.body.pos, alpha);
        _q.copy(car.prevQuat).slerp(car.body.quat, alpha);
      }
      car.view.update(dt, this.wheels, night, _v, _q);
      if (!this.paused) this.carFx(car, dt, d);
    }
    this.wheels.end();
    if (!this.paused) {
      this.fx.update(dt);
      this.tracks.update(dt);
      this.terrainR.update(dt);
    }
    this.propsR.update(this.camera.position, this.viewDist);
    this.structures?.render(dt, this.camera.position);
    this.perf?.update(dtReal);
    this.renderer.render(this.scene, this.camera);
  }

  carFx(car, dt, dist) {
    const b = car.body;
    const spd = b.speed();
    const biome = this.terrain.biomeAt(b.pos.x, b.pos.z);
    const near = dist < 160;
    if (car.alive && near) {
      const dark = _dark.set(biome.dust).multiplyScalar(0.72); // Tracks.add copies the components
      for (let i = 0; i < b.wheels.length; i++) {
        const w = b.wheels[i];
        if (!w.contact) continue;
        if (car.design.wheels !== 'hover' && dist < 120) this.tracks.add(car.id + i, w.contactPoint.x, w.contactPoint.y, w.contactPoint.z, 0, 0, car.stats.chassis.wheelW * 1.1, dark, biome.surface === 'salt' || biome.surface === 'concrete' ? 0.18 : 0.32);
        const kick = spd > 6 && (b.surface === 'sand' || b.surface === 'ash' || b.surface === 'packed' || b.surface === 'mud' || w.slip > 0.3);
        if (kick && Math.random() < (0.08 + w.slip * 0.5 + spd / 200) * this.fx.quality * (w.rear ? 1 : 0.3)) {
          this.fx.dust(w.contactPoint.x - b.fwd.x * 0.6, w.contactPoint.y + 0.2, w.contactPoint.z - b.fwd.z * 0.6, biome.dust, (0.6 + spd / 50 + w.slip * 0.6) * Math.sqrt(car.stats.size), b.vel);
        }
        if (b.inLiquid && spd > 3 && Math.random() < 0.3) this.fx.splash(w.contactPoint.x, b.inLiquid.level, w.contactPoint.z, b.inLiquid.color, 2);
      }
      // exhaust / boost flames
      if (car.boostVisual) {
        _v.set(0, 0.5, -car.stats.chassis.len / 2 - 0.3).applyQuaternion(b.quat).add(b.pos);
        this.fx.flame(_v.x, _v.y, _v.z, -b.fwd.x * 12 + b.vel.x, -b.fwd.y * 12 + b.vel.y, -b.fwd.z * 12 + b.vel.z);
      } else if (Math.random() < 0.08 * Math.abs(b.controls.throttle)) {
        _v.set(0.4, 0.4, -car.stats.chassis.len / 2 - 0.2).applyQuaternion(b.quat).add(b.pos);
        this.fx.smoke(_v.x, _v.y, _v.z, 0.55, 0.35);
      }
      if (car.design.wheels === 'hover' && Math.random() < 0.3) this.fx.sparkBurst(b.pos.x, b.pos.y - 0.4, b.pos.z, 1, 0x7cff4f, 3);
    }
    // damage smoke
    const frac = car.hp / car.stats.hp;
    if (near && (frac < 0.4 || !car.alive) && Math.random() < (car.alive ? (0.4 - frac) * 1.5 : 0.5)) {
      this.fx.smoke(b.pos.x, b.pos.y + car.stats.chassis.hei, b.pos.z, car.alive ? 0.35 : 0.2, 1 + car.stats.size * 0.3);
      if (frac < 0.2 || !car.alive) this.fx.fire(b.pos.x, b.pos.y + car.stats.chassis.hei * 0.8, b.pos.z, 0.8 + car.stats.size * 0.2);
    }
    for (const e of b.events) {
      if (e.type === 'land' && e.speed > 4 && near) {
        for (let i = 0; i < 6; i++) this.fx.dust(b.pos.x + (Math.random() - 0.5) * 3, b.pos.y - 0.5, b.pos.z + (Math.random() - 0.5) * 3, biome.dust, 1.4 * Math.sqrt(car.stats.size));
        if (car.isPlayer) { this.fx.shake += Math.min(0.5, e.speed / 30); this.audio?.play('land', b.pos, true); }
      }
      if (e.type === 'scrape' && near) this.fx.sparkBurst(e.x, e.y, e.z, 3, 0xffd27a, 5);
    }
  }
}

function lodSubsteps(car, pc) {
  if (!pc || car === pc) return 2;
  const p = car.body.pos;
  for (let i = 0; i < _anchors.length; i++) if (p.distanceToSquared(_anchors[i]) < LOD_R2) return 2;
  return 1;
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }
export { lootText, BIOMES, RNG };
