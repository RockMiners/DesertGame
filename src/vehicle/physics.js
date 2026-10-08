// Arcade raycast-suspension vehicle on a heightfield. Tuned for big air and drifting.
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { BIOMES, SURFACE_WHEEL } from '../world/biomes.js';

const G = 9.81;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const _s = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _pv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const nrm = { x: 0, y: 1, z: 0 };

export class VehicleBody {
  constructor(stats) {
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(-1, 0, 0);
    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();
    this.controls = { throttle: 0, steer: 0, handbrake: 0, boost: 0, pitch: 0, roll: 0 };
    this.steerAngle = 0;
    this.airTime = 0;
    this.groundedWheels = 0;
    this.lastLandingSpeed = 0;
    this.flipTimer = 0;
    this.slip = 0;
    this.surface = 'packed';
    this.inLiquid = null;
    this.events = [];
    this.configure(stats);
  }

  configure(stats) {
    const ch = stats.chassis;
    this.stats = stats;
    this.mass = stats.mass;
    this.invMass = 1 / this.mass;
    this.len = ch.len; this.wid = ch.wid; this.hei = ch.hei;
    const m = this.mass * 1.6; // extra inertia = calmer, more arcadey rotation
    this.inertia = new THREE.Vector3(
      (m / 12) * (ch.hei * ch.hei + ch.len * ch.len),
      (m / 12) * (ch.wid * ch.wid + ch.len * ch.len),
      (m / 12) * (ch.wid * ch.wid + ch.hei * ch.hei),
    );
    this.invInertia = new THREE.Vector3(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
    const axles = ch.axles;
    const R = ch.wheelR;
    this.wheelR = R;
    this.rest = 0.45 + R * 0.55;
    const nW = axles * 2;
    this.k = (this.mass * G) / (nW * this.rest * 0.38);
    this.c = 2 * 0.42 * Math.sqrt(this.k * this.mass / nW);
    this.wheels = [];
    const wb = ch.len * 0.72;
    for (let a = 0; a < axles; a++) {
      const z = wb / 2 - (wb * a) / Math.max(1, axles - 1);
      for (const side of [-1, 1]) {
        this.wheels.push({
          local: new THREE.Vector3(side * (ch.wid / 2 + ch.wheelW * 0.1), 0.15, z),
          steer: a === 0 || (axles >= 4 && a === 1) ? 1 : 0,
          rear: a === axles - 1,
          driven: true,
          compression: 0, contact: false, spin: 0, spinVel: 0, slip: 0,
          world: new THREE.Vector3(), contactPoint: new THREE.Vector3(),
        });
      }
    }
    // hull sample points for terrain collision
    const hl = ch.len / 2, hw = ch.wid / 2, hh = ch.hei;
    this.hull = [];
    for (const x of [-hw, hw]) for (const z of [-hl, hl]) { this.hull.push(new THREE.Vector3(x, 0.1, z)); this.hull.push(new THREE.Vector3(x * 0.8, hh, z * 0.85)); }
    this.hull.push(new THREE.Vector3(0, hh + 0.2, 0), new THREE.Vector3(0, 0.1, hl + 0.1), new THREE.Vector3(0, 0.1, -hl - 0.1));
    this.radius = Math.hypot(hl, hw) ;
    this.spheres = [];
    const nS = Math.max(1, Math.round(ch.len / ch.wid));
    for (let i = 0; i < nS; i++) {
      const z = nS === 1 ? 0 : -hl + hw + ((ch.len - ch.wid) * i) / (nS - 1);
      this.spheres.push({ local: new THREE.Vector3(0, hh * 0.5, z), r: hw * 1.05, world: new THREE.Vector3() });
    }
    this.wheelId = stats.wheelId || 'standard';
    this.hover = this.wheelId === 'hover';
    this.tracks = this.wheelId === 'tracks';
  }

  placeAt(x, z, terrain, heading = 0) {
    this.pos.set(x, terrain.heightAt(x, z) + this.rest + this.wheelR + 0.5, z);
    this.quat.setFromAxisAngle(UP, heading);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.updateFrame();
  }

  updateFrame() {
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.right.crossVectors(this.fwd, this.up);
  }

  applyForceAt(f, point) {
    this.force.add(f);
    _r.subVectors(point, this.pos);
    _t.crossVectors(_r, f);
    this.torque.add(_t);
  }

  applyImpulseAt(j, point) {
    this.vel.addScaledVector(j, this.invMass);
    _r.subVectors(point, this.pos);
    _t.crossVectors(_r, j);
    this.applyInvInertia(_t);
    this.angVel.add(_t);
  }

  // in-place: world vector -> I^-1 * vector (world)
  applyInvInertia(v) {
    _qi.copy(this.quat).invert();
    v.applyQuaternion(_qi);
    v.x *= this.invInertia.x; v.y *= this.invInertia.y; v.z *= this.invInertia.z;
    v.applyQuaternion(this.quat);
    return v;
  }

  pointVelocity(point, out) {
    _r.subVectors(point, this.pos);
    out.crossVectors(this.angVel, _r).add(this.vel);
    return out;
  }

  speed() { return this.vel.length(); }
  forwardSpeed() { return this.vel.dot(this.fwd); }

  step(dt, terrain, mods) {
    this.events.length = 0;
    const sub = 2;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.substep(h, terrain, mods);
  }

  substep(dt, terrain, mods) {
    const st = this.stats;
    const ctl = this.controls;
    this.updateFrame();
    this.force.set(0, -G * this.mass, 0);
    this.torque.set(0, 0, 0);

    const spd = this.vel.length();
    const fwdSpd = this.vel.dot(this.fwd);
    // speed-sensitive steering
    const maxSteer = 0.62 / (1 + Math.abs(fwdSpd) * 0.045) / Math.max(1, Math.sqrt(st.size) * 0.85);
    const targetSteer = ctl.steer * maxSteer;
    const steerRate = 3.2 * dt;
    this.steerAngle += clamp(targetSteer - this.steerAngle, -steerRate, steerRate);

    // environment
    const biome = terrain.biomeAt(this.pos.x, this.pos.z);
    this.surface = biome.surface;
    const wheelType = this.wheelId;
    const surfGrip = this.hover ? 0.55 : biome.grip * (SURFACE_WHEEL[wheelType][biome.surface] ?? 1) * (st.wheel?.grip ?? 1);
    const softness = this.hover ? 0 : biome.soft * (st.wheel?.soft ?? 1);
    const liquid = terrain.liquidAt(this.pos.x, this.pos.z);
    this.inLiquid = liquid && this.pos.y - this.wheelR < liquid.level + 0.3 ? liquid : null;

    // power
    const fuelOk = mods ? mods.powerFactor : 1;
    const boost = ctl.boost ? 1.65 : 1;
    const power = st.power * fuelOk * boost;
    const driveWheels = this.wheels.length;
    let grounded = 0;
    for (const w of this.wheels) if (w.contact) grounded++;
    const tractionLimit = Math.max(1, grounded);
    const absFs = Math.max(3.5, Math.abs(fwdSpd));
    let engineForce = Math.min(power / absFs, power / 7) * (st.engine?.torque || 1);
    // speed governor: past top speed the engine stops pushing (air drag does the rest)
    if (Math.abs(fwdSpd) > st.topSpeed * boost * 1.05) engineForce *= 0.2;

    grounded = 0;
    let slipSum = 0;
    const gp = clamp(st.groundPressure / 0.6, 0.5, 4);
    for (const w of this.wheels) {
      w.world.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      const gh = terrain.heightAt(w.world.x, w.world.z);
      let groundY = gh;
      if (this.hover && liquid) groundY = Math.max(gh, liquid.level);
      const upY = Math.max(this.up.y, 0.2);
      const dist = (w.world.y - groundY) / upY;
      const maxLen = this.rest + this.wheelR;
      if (dist < maxLen && this.up.y > 0.05) {
        grounded++;
        w.contact = true;
        let comp = maxLen - dist;
        w.compression = comp;
        w.contactPoint.copy(w.world).addScaledVector(this.up, -dist);
        terrain.normalAt(w.contactPoint.x, w.contactPoint.z, nrm);
        _n.set(nrm.x, nrm.y, nrm.z);
        this.pointVelocity(w.contactPoint, _v);
        const vn = _v.dot(this.up);
        let fs = this.k * comp - this.c * vn;
        if (comp > this.rest) fs += this.k * 6 * (comp - this.rest); // bump stop
        if (fs < 0) fs = 0;
        fs = Math.min(fs, this.mass * G * 8);
        _f.copy(this.up).multiplyScalar(fs);
        this.applyForceAt(_f, w.contactPoint);

        // tyre frame
        _a.copy(this.fwd);
        if (w.steer) _a.applyAxisAngle(this.up, -this.steerAngle);
        _a.addScaledVector(_n, -_a.dot(_n)).normalize();
        _s.crossVectors(_a, _n); // right
        const vf = _v.dot(_a), vs = _v.dot(_s);
        const load = fs;
        let mu = surfGrip * 1.05;
        let latMu = mu;
        if (ctl.handbrake && w.rear) latMu *= 0.32;
        // longitudinal
        let fx = 0;
        const thr = ctl.throttle;
        if (thr !== 0) {
          if (Math.sign(thr) === Math.sign(vf) || Math.abs(vf) < 1.2) fx += (thr * engineForce) / driveWheels * (thr < 0 ? 0.6 : 1);
          else fx += -Math.sign(vf) * Math.abs(thr) * this.mass * G * 0.95 / this.wheels.length; // braking
        }
        if (ctl.handbrake && w.rear) fx += -Math.sign(vf) * Math.min(Math.abs(vf) * this.mass * 2, this.mass * G * 0.6 / this.wheels.length);
        // rolling resistance + soft ground bog-down (heavy cars dig in)
        const crr = 0.012 + softness * 0.045 * gp;
        fx -= vf * crr * load * 0.12 + Math.sign(vf) * Math.min(Math.abs(vf), 1) * crr * load;
        // lateral: impulse needed to kill sideways velocity this step, clamped by friction
        const massShare = this.mass / this.wheels.length;
        let fy = (-vs * massShare) / dt * 0.55;
        const maxLat = latMu * load;
        const maxLong = mu * load;
        fx = clamp(fx, -maxLong * 1.4, maxLong * 1.4);
        const lim = Math.hypot(fx / (maxLong * 1.4 + 1e-6), fy / (maxLat + 1e-6));
        if (lim > 1) {
          fy /= lim;
          fx /= Math.max(1, lim * 0.85);
          w.slip = Math.min(1, (lim - 1) * 0.8 + Math.abs(vs) / 18);
        } else w.slip = Math.abs(vs) > 4 ? Math.min(1, Math.abs(vs) / 20) : 0;
        slipSum += w.slip;
        _f.copy(_a).multiplyScalar(fx).addScaledVector(_s, fy);
        // apply lateral force closer to centre-of-mass height to reduce rollovers
        _pv.copy(w.contactPoint).addScaledVector(this.up, (dist + 0.1) * 0.75);
        this.applyForceAt(_f, _pv);
        w.spinVel = vf / this.wheelR;
      } else {
        w.contact = false;
        w.compression = 0;
        w.slip = 0;
        w.spinVel *= 0.99;
        if (ctl.throttle) w.spinVel += ctl.throttle * 30 * dt;
      }
      w.spin += w.spinVel * dt;
    }
    this.groundedWheels = grounded;
    this.slip = slipSum / this.wheels.length;

    // aerodynamic drag + slight downforce for stability at speed
    this.force.addScaledVector(this.vel, -st.drag * spd);
    if (grounded > 0) this.force.addScaledVector(this.up, -spd * spd * 0.35 * Math.sqrt(st.size));

    // liquids: drag + buoyancy
    if (this.inLiquid && !this.hover) {
      const L = this.inLiquid;
      const sub = clamp((L.level - (this.pos.y - this.wheelR)) / (this.hei + this.wheelR), 0, 1);
      this.force.addScaledVector(this.vel, -L.drag * this.mass * 0.25 * sub);
      this.force.y += this.mass * G * 0.7 * sub;
    }

    // air control
    if (grounded === 0) {
      this.airTime += dt;
      _t.set(ctl.pitch * 2.6, ctl.steer * -2.2 + 0, ctl.roll * 2.2);
      // local axes: x = pitch (right axis), y = yaw, z = roll
      _t.x *= this.inertia.x; _t.y *= this.inertia.y; _t.z *= this.inertia.z;
      _t.applyQuaternion(this.quat);
      this.torque.add(_t);
      // gentle self-levelling so new players land wheels-down
      _w.crossVectors(this.up, UP).multiplyScalar(this.mass * 3.5 * (1 + st.size));
      this.torque.add(_w);
      this.angVel.multiplyScalar(1 - 0.25 * dt);
    } else {
      if (this.airTime > 0.35) {
        this.lastLandingSpeed = Math.abs(this.vel.y);
        this.events.push({ type: 'land', airTime: this.airTime, speed: this.lastLandingSpeed });
      }
      this.airTime = 0;
      this.angVel.multiplyScalar(1 - 1.2 * dt);
      // yaw damping when not steering (stops endless spins)
      const yawRate = this.angVel.dot(this.up);
      if (Math.abs(ctl.steer) < 0.1 && !ctl.handbrake) this.angVel.addScaledVector(this.up, -yawRate * Math.min(1, 2.5 * dt));
    }

    // integrate
    this.vel.addScaledVector(this.force, this.invMass * dt);
    _w.copy(this.torque);
    this.applyInvInertia(_w);
    this.angVel.addScaledVector(_w, dt);
    const maxAng = 14;
    if (this.angVel.lengthSq() > maxAng * maxAng) this.angVel.setLength(maxAng);
    this.pos.addScaledVector(this.vel, dt);
    _q.set(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0);
    _q.multiply(this.quat);
    this.quat.x += _q.x; this.quat.y += _q.y; this.quat.z += _q.z; this.quat.w += _q.w;
    this.quat.normalize();
    this.updateFrame();

    // hull vs terrain
    this.collideHull(terrain, dt);

    // flipped detection
    if (this.up.y < 0.25 && spd < 4) this.flipTimer += dt; else this.flipTimer = 0;
  }

  collideHull(terrain, dt) {
    let maxPen = 0;
    for (const hp of this.hull) {
      _a.copy(hp).applyQuaternion(this.quat).add(this.pos);
      const gh = terrain.heightAt(_a.x, _a.z);
      const pen = gh - _a.y;
      if (pen > 0) {
        maxPen = Math.max(maxPen, pen);
        terrain.normalAt(_a.x, _a.z, nrm);
        _n.set(nrm.x, nrm.y, nrm.z);
        this.pointVelocity(_a, _v);
        const vn = _v.dot(_n);
        if (vn < 0) {
          _r.subVectors(_a, this.pos);
          _t.crossVectors(_r, _n);
          this.applyInvInertia(_t);
          _w.crossVectors(_t, _r);
          const denom = this.invMass + _n.dot(_w);
          const jn = (-(1 + 0.15) * vn) / denom;
          _f.copy(_n).multiplyScalar(jn);
          // friction
          _s.copy(_v).addScaledVector(_n, -vn);
          const vt = _s.length();
          if (vt > 1e-3) {
            _s.multiplyScalar(-Math.min(jn * 0.6, vt / denom) / vt);
            _f.add(_s);
          }
          this.applyImpulseAt(_f, _a);
          if (-vn > 9) this.events.push({ type: 'scrape', speed: -vn, x: _a.x, y: _a.y, z: _a.z });
        }
      }
    }
    if (maxPen > 0) this.pos.y += maxPen * 0.6;
  }

  flipUpright(terrain) {
    const heading = Math.atan2(this.fwd.x, this.fwd.z);
    this.quat.setFromAxisAngle(UP, heading);
    this.pos.y = terrain.heightAt(this.pos.x, this.pos.z) + this.rest + this.wheelR + 1.2;
    this.angVel.set(0, 0, 0);
    this.vel.multiplyScalar(0.2);
    this.vel.y = 3;
    this.flipTimer = 0;
    this.updateFrame();
  }

  heading() { return Math.atan2(this.fwd.x, this.fwd.z); }
}

// Car vs car: sphere-chain collision with impulses. Returns relative impact speed (or 0).
export function collideBodies(A, B, out) {
  const dx = A.pos.x - B.pos.x, dz = A.pos.z - B.pos.z, dy = A.pos.y - B.pos.y;
  const rr = A.radius + B.radius;
  if (dx * dx + dz * dz + dy * dy > rr * rr) return 0;
  let best = null, bestPen = 0;
  for (const sa of A.spheres) {
    sa.world.copy(sa.local).applyQuaternion(A.quat).add(A.pos);
    for (const sb of B.spheres) {
      sb.world.copy(sb.local).applyQuaternion(B.quat).add(B.pos);
      const d = sa.world.distanceTo(sb.world);
      const pen = sa.r + sb.r - d;
      if (pen > bestPen) { bestPen = pen; best = [sa, sb, d]; }
    }
  }
  if (!best) return 0;
  const [sa, sb, d] = best;
  _n.subVectors(sa.world, sb.world);
  if (d < 1e-4) _n.set(1, 0, 0); else _n.divideScalar(d);
  _n.y *= 0.3; _n.normalize();
  _a.copy(sb.world).addScaledVector(_n, sb.r); // contact point approx
  const va = A.pointVelocity(_a, new THREE.Vector3());
  const vb = B.pointVelocity(_a, new THREE.Vector3());
  const rel = va.sub(vb).dot(_n);
  const totalInv = A.invMass + B.invMass;
  // positional correction
  A.pos.addScaledVector(_n, bestPen * (A.invMass / totalInv));
  B.pos.addScaledVector(_n, -bestPen * (B.invMass / totalInv));
  if (rel >= 0) return 0;
  const j = (-(1 + 0.25) * rel) / totalInv;
  _f.copy(_n).multiplyScalar(j);
  A.vel.addScaledVector(_f, A.invMass);
  B.vel.addScaledVector(_f, -B.invMass);
  // a little spin for drama
  _r.subVectors(_a, A.pos); _t.crossVectors(_r, _f).multiplyScalar(0.3); A.applyInvInertia(_t); A.angVel.add(_t);
  _r.subVectors(_a, B.pos); _t.crossVectors(_r, _f).multiplyScalar(-0.3); B.applyInvInertia(_t); B.angVel.add(_t);
  if (out) { out.x = _a.x; out.y = _a.y; out.z = _a.z; out.nx = _n.x; out.nz = _n.z; }
  return -rel;
}

// Car vs static circle colliders (props, walls, buildings)
const _hits = [];
export function collideStatic(body, grid, onHit) {
  const list = grid.query(body.pos.x, body.pos.z, body.radius + 10, _hits);
  for (const c of list) {
    if (body.pos.y > c.y + c.h + 0.5 || c.dead) continue;
    for (const s of body.spheres) {
      s.world.copy(s.local).applyQuaternion(body.quat).add(body.pos);
      const dx = s.world.x - c.x, dz = s.world.z - c.z;
      const d = Math.hypot(dx, dz);
      const pen = s.r + c.r - d;
      if (pen <= 0) continue;
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
      const vn = body.vel.x * nx + body.vel.z * nz;
      if (onHit && onHit(c, -vn) === 'pass') break;
      body.pos.x += nx * pen; body.pos.z += nz * pen;
      if (vn < 0) {
        body.vel.x -= (1 + 0.25) * vn * nx;
        body.vel.z -= (1 + 0.25) * vn * nz;
        body.vel.multiplyScalar(0.92);
        body.angVel.y += (Math.random() - 0.5) * Math.min(3, -vn * 0.08);
      }
    }
  }
}
