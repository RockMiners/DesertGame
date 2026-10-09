// Wire format shared by every transport: compact packed car/squad snapshots, car metadata, and
// world-state sections. Snapshots are strings of base-36 integers so a busy scene fits in 4 KiB.
import * as THREE from 'three';

const b36 = (v) => Math.round(v).toString(36);
const n36 = (s) => parseInt(s, 36) || 0;

export const FLAG = { alive: 1, boost: 2, fire0: 4, fire1: 8, traffic: 16, player: 32, vip: 64 };

// One car record: nid, pos*10, quat*1000, vel*10 (x,z), hp, flags, turret yaw/pitch*100, design version, steer*100, throttle*10
export function packCar(nid, car) {
  const b = car.body, q = b.quat, w = car.weapons.find((x) => x.kind !== 'rear');
  let f = 0;
  if (car.alive) f |= FLAG.alive;
  if (car.boostVisual) f |= FLAG.boost;
  if (car.triggers[0]) f |= FLAG.fire0;
  if (car.triggers[1]) f |= FLAG.fire1;
  if (car.traffic) f |= FLAG.traffic;
  if (car.isPlayer || car.isRemotePlayer) f |= FLAG.player;
  if (car.vip) f |= FLAG.vip;
  return [nid, b.pos.x * 10, b.pos.y * 10, b.pos.z * 10, q.x * 1000, q.y * 1000, q.z * 1000, q.w * 1000,
    b.vel.x * 10, b.vel.y * 10, b.vel.z * 10, Math.max(0, car.hp), f, w ? w.yaw * 100 : 0, w ? w.pitch * 100 : 0,
    car.designVer || 0, b.controls.steer * 100, b.controls.throttle * 10].map(b36).join(',');
}

export function unpackCar(s) {
  const a = s.split(',').map(n36);
  return {
    nid: a[0], p: [a[1] / 10, a[2] / 10, a[3] / 10], q: [a[4] / 1000, a[5] / 1000, a[6] / 1000, a[7] / 1000],
    v: [a[8] / 10, a[9] / 10, a[10] / 10], hp: a[11], f: a[12], wy: a[13] / 100, wp: a[14] / 100, dv: a[15], st: a[16] / 100, thr: a[17] / 10,
  };
}

export function packSquads(squads) {
  const out = [];
  for (const q of squads) out.push([q.id, b36(q.x), b36(q.z), b36(q.tx), b36(q.tz)].join(','));
  return out.join(';');
}
export function unpackSquads(s) {
  const out = {};
  if (!s) return out;
  for (const e of s.split(';')) { const [id, x, z, tx, tz] = e.split(','); out[id] = { x: n36(x), z: n36(z), tx: n36(tx), tz: n36(tz) }; }
  return out;
}

// Fast snapshot: "gameTime|hostClock|cars|squads|wallet". Cars past the byte budget are dropped farthest-first by the caller.
// The shared wallet rides along so purchases show up for everyone at once.
export function packFast(gt, t, cars, squads, wallet = 0) { return `${b36(gt * 10)}|${b36(t)}|${cars.join(';')}|${squads}|${b36(wallet)}`; }
export function unpackFast(s) {
  const [gt, t, cars, squads, w] = s.split('|');
  return { gt: n36(gt) / 10, t: n36(t), cars: cars ? cars.split(';').map(unpackCar) : [], squads: unpackSquads(squads), wallet: w === undefined ? null : n36(w) };
}

export function carMeta(nid, car) {
  return {
    n: nid, id: car.id, name: car.name, title: car.title || car.name, team: car.team, design: car.design,
    fc: car.factionColor || null, vip: !!car.vip, traffic: !!car.traffic, player: !!(car.isPlayer || car.isRemotePlayer), dv: car.designVer || 0,
  };
}

// ---- world state sections ----
// Fast-changing values (clock, squad positions) ride the snapshot instead, so these change only on real events.
export const SECTIONS = ['core', 'factions', 'bases', 'squads', 'npcs', 'chron'];

const round1 = (v) => Math.round(v * 10) / 10;

export function buildSection(sim, key) {
  const s = sim.s;
  switch (key) {
    case 'core': {
      // story pacing drifts every tick and only matters to the host; player positions ride the snapshots
      const { time, factions, bases, squads, npcs, chronicle, missions, story, players, ...rest } = s;
      void time; void factions; void bases; void squads; void npcs; void chronicle; void story;
      const { waypoint, ...shared } = missions; // the host's personal map marker stays theirs
      void waypoint;
      const ps = {};
      for (const [id, p] of Object.entries(players || {})) ps[id] = { id, name: p.name, sleepBase: p.sleepBase };
      return { ...rest, missions: shared, players: ps };
    }
    case 'factions': {
      const out = {};
      for (const [id, f] of Object.entries(s.factions)) out[id] = { ...f, memberCount: f.alive ? sim.members(id).length : 0, powerCache: Math.round(f.powerCache || 0), treasury: Math.round(f.treasury), aiTimer: 0, dipTimer: 0 };
      return out;
    }
    case 'bases': {
      const out = {};
      for (const [id, b] of Object.entries(s.bases)) out[id] = { ...b, structs: b.structs.map((st) => ({ ...st, hp: Math.round(st.hp) })), storage: roundObj(b.storage), lastProd: roundObj(b.lastProd || {}) };
      return out;
    }
    case 'squads': {
      // positions arrive through snapshots; keep the slow parts here
      const out = {};
      for (const [id, q] of Object.entries(s.squads)) {
        const { x, z, tx, tz, battleT, startPower, startValue, ...rest } = q;
        void x; void z; void tx; void tz; void battleT; void startPower; void startValue;
        out[id] = rest;
      }
      return out;
    }
    case 'npcs': {
      // clients only need their own crew, recruits, leaders and mission targets
      const keep = new Set(s.recruitPool);
      for (const f of Object.values(s.factions)) if (f.leaderId) keep.add(f.leaderId);
      for (const m of Object.values(s.missions)) if (m.obj?.npcId) keep.add(m.obj.npcId);
      const out = {};
      for (const [id, n] of Object.entries(s.npcs)) {
        if (!n.alive) continue;
        if (keep.has(id) || n.factionId === s.group.factionId) out[id] = { ...n, hp: round1(n.hp), loyalty: Math.round(n.loyalty) };
      }
      return out;
    }
    case 'chron': {
      const c = s.chronicle;
      const hist = c.filter((e) => e.tags?.includes('history'));
      return { list: hist.concat(c.filter((e) => !e.tags?.includes('history')).slice(-90)) };
    }
  }
  return null;
}

function roundObj(o) { const out = {}; for (const [k, v] of Object.entries(o)) out[k] = Math.round(v * 10) / 10; return out; }

export function applySection(sim, key, data) {
  const s = sim.s;
  switch (key) {
    case 'core': {
      const wp = s.missions?.waypoint;
      for (const [k, v] of Object.entries(data)) s[k] = v;
      if (wp && s.missions) s.missions.waypoint = wp;
      break;
    }
    case 'factions': s.factions = data; break;
    case 'bases': s.bases = data; break;
    case 'squads': {
      // keep the last known positions
      const old = s.squads || {};
      for (const [id, q] of Object.entries(data)) { const o = old[id]; q.x = o?.x ?? 0; q.z = o?.z ?? 0; q.tx = o?.tx ?? 0; q.tz = o?.tz ?? 0; }
      s.squads = data;
      break;
    }
    case 'npcs': s.npcs = data; break;
    case 'chron': s.chronicle = data.list; break;
  }
}

// ---- snapshot interpolation for replicas (remote players and, on clients, every NPC) ----
export function pushSample(car, t, d) {
  const buf = (car.netBuf ||= []);
  const last = buf[buf.length - 1];
  if (last && t <= last.t) return;
  // a respawn or teleport: start a fresh timeline so the replica snaps instead of flying across the map
  if (last) {
    const dt = (t - last.t) / 1000, dx = d.p[0] - last.p.x, dz = d.p[2] - last.p.z;
    if (Math.hypot(dx, dz) > 30 + (last.v.length() + 20) * dt * 2) buf.length = 0;
  }
  buf.push({ t, p: new THREE.Vector3(d.p[0], d.p[1], d.p[2]), q: new THREE.Quaternion(d.q[0], d.q[1], d.q[2], d.q[3]).normalize(), v: new THREE.Vector3(d.v[0], d.v[1], d.v[2]) });
  if (buf.length > 8) buf.shift();
}

// Place car at remote clock time `rt` (interpolating, or extrapolating up to 250 ms past the newest sample)
export function sampleAt(car, rt) {
  const b = car.body;
  return samplePose(car, rt, b.pos, b.quat, b.vel);
}

// The pose at remote time `rt`, written into the given vectors (the renderer uses this every frame)
export function samplePose(car, rt, pos, quat, vel) {
  const buf = car.netBuf;
  if (!buf || !buf.length) return false;
  const b = { pos, quat, vel };
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].t > rt) i--;
  const hi = buf[i], lo = buf[i - 1];
  if (lo && rt >= lo.t && rt <= hi.t) {
    const span = Math.max(1, hi.t - lo.t);
    const k = (rt - lo.t) / span;
    if (span < 300) {
      // cubic Hermite through both samples using their velocities: no corners where the path bends
      const T = span / 1000, k2 = k * k, k3 = k2 * k;
      const h00 = 2 * k3 - 3 * k2 + 1, h10 = (k3 - 2 * k2 + k) * T, h01 = -2 * k3 + 3 * k2, h11 = (k3 - k2) * T;
      b.pos.set(
        h00 * lo.p.x + h10 * lo.v.x + h01 * hi.p.x + h11 * hi.v.x,
        h00 * lo.p.y + h10 * lo.v.y + h01 * hi.p.y + h11 * hi.v.y,
        h00 * lo.p.z + h10 * lo.v.z + h01 * hi.p.z + h11 * hi.v.z);
    } else b.pos.lerpVectors(lo.p, hi.p, k);
    b.quat.slerpQuaternions(lo.q, hi.q, k);
    b.vel.lerpVectors(lo.v, hi.v, k);
  } else if (rt > hi.t) {
    const ex = Math.min(250, rt - hi.t) / 1000;
    b.pos.copy(hi.p).addScaledVector(hi.v, ex);
    b.quat.copy(hi.q);
    b.vel.copy(hi.v);
  } else {
    b.pos.copy(buf[0].p); b.quat.copy(buf[0].q); b.vel.copy(buf[0].v);
  }
  return true;
}
