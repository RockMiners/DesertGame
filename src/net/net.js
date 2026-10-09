// Player-hosted co-op. The host's browser runs the whole world; friends get compact snapshots of the cars
// near them (interpolated ~100-180 ms in the past so motion is smooth), the slow world state in sections that
// are re-sent only when they change, and they send back their own car, the damage they deal and their commands.
import * as THREE from 'three';
import { packCar, unpackCar, packFast, unpackFast, packSquads, carMeta, SECTIONS, buildSection, applySection, pushSample, sampleAt, samplePose, FLAG } from './protocol.js';
import { PeerTransport, LocalTransport, RoomTransport, artifactCaps } from './transports.js';
import { DEFAULT_DESIGN } from '../vehicle/parts.js';
import { dayOf } from '../sim/defs.js';

const VIEW_R = 650;                      // cars farther than this from every friend are not sent
const FAST_HZ = { peer: 20, local: 20, room: 12 };
const SECTION_EVERY = { peer: 2, local: 2, room: 4 };
const MAX_DMG = 2000;

// artifact builds use the claude.ai room; ?net=local (same-browser tabs) and ?net=room (with a stand-in) are for testing
const NET_PARAM = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('net') : null;
export const NET_KIND = import.meta.env?.MODE === 'artifact' ? 'room' : NET_PARAM === 'local' || NET_PARAM === 'room' ? NET_PARAM : 'peer';

function randomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

// Replays a sender's timeline a little in the past. The playback clock runs at real speed and is only
// steered (a few percent faster or slower) toward the estimate, so packet jitter never jerks the motion.
export class Clock {
  constructor() { this.off = null; this.iv = 60; this.last = 0; this.rt = null; this.at = 0; }
  see(t) {
    const now = performance.now();
    const o = t - now;
    if (this.off === null || Math.abs(o - this.off) > 1500) this.off = o;
    else this.off += (o - this.off) * 0.05;
    if (this.last) this.iv += (Math.min(600, now - this.last) - this.iv) * 0.08;
    this.last = now;
  }
  delay() { return Math.min(450, this.iv * 1.7 + 40); }
  now(at = performance.now()) {
    const target = at + (this.off || 0) - this.delay();
    if (this.rt === null || Math.abs(target - this.rt) > 400) { this.rt = target; this.at = at; return target; }
    const el = at - this.at;
    if (el <= 0) return this.rt;
    this.at = at;
    const err = target - (this.rt + el);
    this.rt += el + Math.max(-el * 0.06, Math.min(el * 0.06, err * 0.04));
    return this.rt;
  }
}

export class Net {
  constructor(app, kind = NET_KIND) {
    this.app = app;
    this.kind = kind;
    this.isHost = false;
    this.isClient = false;
    this.peers = new Map();     // host: pid -> { name, car, known:Set<nid>, clock, meta, hurt:[] }
    this.pending = new Map();
    this.reqId = 1;
    this.fastT = 0; this.secT = 0; this.flushT = 0; this.metaT = 0; this.sweepT = 0;
    this.ent = new Map();       // host: car -> { nid, dv, sig }
    this.byNid = new Map();     // host: nid -> car · client: nid -> replica car
    this.metas = new Map();     // client: nid -> meta
    this.seen = new Map();      // client: nid -> last time seen
    this.nextNid = 1;
    this.secJson = {};
    this.secRecv = {};
    this.hostClock = new Clock();
    this.evQ = [];
    this.dmgAcc = new Map();    // client: nid -> [amount, kind]
    this.sdAcc = new Map();     // client: base|struct -> [b, s, amount, team]
    this.needMeta = new Set();
  }

  get game() { return this.app.game; }
  get sim() { return this.app.sim; }

  async makeTransport() {
    if (this.kind === 'room') return new RoomTransport(await artifactCaps());
    if (this.kind === 'local') return new LocalTransport();
    return new PeerTransport();
  }

  inviteLink() {
    if (this.kind === 'room') return null;
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('join', this.code);
    if (this.kind === 'local') u.searchParams.set('net', 'local');
    return u.toString();
  }

  // ======================================================== host
  async host() {
    this.isHost = true;
    this.t = await this.makeTransport();
    this.t.onJoin = (pid, name) => this.onPeerJoin(pid, name);
    this.t.onLeave = (pid) => this.onPeerLeave(pid);
    this.t.onMsg = (pid, m) => this.onHostMsg(pid, m);
    this.t.onFast = (pid, s) => this.onHostFast(pid, s);
    this.t.onLost = (why) => { if (why === 'not_permitted') this.app.ui?.toast('Only the owner or editors of this artifact can host co-op here.', 'bad'); };
    for (let tries = 0; ; tries++) {
      this.code = randomCode();
      try { await this.t.host(this.code, this.info()); break; }
      catch (e) { if (e?.type !== 'unavailable-id' || tries > 3) throw e; }
    }
    this.game.on('kill', (car, killer) => {
      for (const [pid, p] of this.peers) if (killer && p.car === killer) this.t.send(pid, { t: 'kill', n: car.title || car.name });
    });
    this.publishSections(true);
    return this.code;
  }

  info() { return { name: this.sim.s?.group.leaderName || this.app.playerName || 'Host', seed: this.sim.s?.seed, day: this.sim.s ? dayOf(this.sim.s.time) : 1, n: this.peers.size + 1 }; }

  onPeerJoin(pid, name) {
    if (this.peers.has(pid)) return;
    this.peers.set(pid, { name: name || 'Friend', car: null, known: new Set(), clock: new Clock(), meta: null, hurt: [], done: new Map() });
    this.t.send(pid, { t: 'welcome', you: pid, seed: this.sim.s.seed, hostName: this.sim.s.group.leaderName, time: this.sim.s.time });
    if (!this.t.sectionsViaDb) for (const k of SECTIONS) if (this.secJson[k]) this.t.send(pid, { t: 'sec', k, d: this.secJson[k] });
    this.t.advertise(this.info());
  }

  // announced when their car first rolls in (a friend who has to regenerate their world reconnects first)
  announceArrival(p) {
    if (p.announced) return;
    p.announced = true;
    this.app.ui?.toast(`🚗 ${p.name} joined your group!`, 'good');
    this.sim.chronicle('player', { title: `${p.name} Joins the Crew`, text: `${p.name} rolled in from the dunes and threw in their lot with ${this.sim.s.group.leaderName || 'the stranger'}.`, importance: 1 });
  }

  onPeerLeave(pid) {
    const p = this.peers.get(pid);
    if (!p) return;
    if (p.car) this.game.removeCar(p.car);
    this.peers.delete(pid);
    delete this.sim.s.players[pid];
    this.app.ui?.toast(`${p.name} left.`, 'info');
    this.t.advertise(this.info());
  }

  onHostFast(pid, str) {
    const p = this.peers.get(pid);
    if (!p || typeof str !== 'string' || str.length > 400) return;
    const sep = str.indexOf('|');
    if (sep < 0) return;
    const t = num(parseInt(str.slice(0, sep), 36));
    let r;
    try { r = unpackCar(str.slice(sep + 1)); } catch { return; }
    if (!r.p.every(Number.isFinite)) return;
    const g = this.game;
    if (!p.car || p.car.removed) {
      const opts = { id: 'p_' + pid, name: p.name, team: this.sim.groupTeam(), x: r.p[0], z: r.p[2], isRemote: true };
      try { p.car = g.spawnCar({ ...opts, design: p.meta?.design || { ...DEFAULT_DESIGN, paint: '#00bbf9' } }); }
      catch { p.car = g.spawnCar({ ...opts, design: { ...DEFAULT_DESIGN, paint: '#00bbf9' } }); }
      p.car.isRemotePlayer = true;
      p.car.title = `🎮 ${p.name}`;
      p.car.netClock = p.clock;
      this.announceArrival(p);
    }
    p.clock.see(t);
    pushSample(p.car, t, r);
    this.applyRec(p.car, r);
    p.car.team = this.sim.groupTeam();
    this.sim.cmd('playerPos', { x: r.p[0], z: r.p[2], name: p.name }, pid);
  }

  onHostMsg(pid, m) {
    const p = this.peers.get(pid);
    if (!p || !m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'meta': {
        if (!m.design || typeof m.design !== 'object') return;
        p.meta = { design: m.design };
        if (typeof m.name === 'string' && m.name.trim()) p.name = m.name.slice(0, 20);
        if (p.car && !p.car.removed) {
          try { p.car.setDesign(m.design); p.car.view?.build(); } catch (e) { console.warn('[net] bad design from', p.name, e); }
          p.car.title = `🎮 ${p.name}`;
        }
        break;
      }
      case 'cmd': {
        // a resent request (its answer was lost) gets the same answer, never a second purchase
        let res = p.done.get(m.id);
        if (res === undefined) {
          try { res = safe(this.sim.cmd(String(m.n), m.a || {}, pid)); } catch (e) { res = { ok: false, msg: String(e.message || e) }; }
          p.done.set(m.id, res);
          if (p.done.size > 64) p.done.delete(p.done.keys().next().value);
        }
        this.t.send(pid, { t: 'res', id: m.id, r: res });
        this.secT = Math.min(this.secT, 0.2); // let the friend see the result (wallet, missions…) right away
        break;
      }
      case 'dmg': {
        if (!Array.isArray(m.h)) return;
        for (const [nid, amt, kind] of m.h) {
          const car = this.byNid.get(nid);
          const a = Math.min(MAX_DMG, num(amt));
          if (car && !car.removed && a > 0) this.game.applyDamage(car, a, p.car, { kind: String(kind || 'bullet'), quiet: true, fromNet: true });
        }
        break;
      }
      case 'sd': {
        if (!Array.isArray(m.h)) return;
        for (const [bid, sid, amt, team] of m.h) {
          const b = this.sim.s.bases[bid];
          const st = b?.structs.find((s) => s.id === sid);
          const a = Math.min(MAX_DMG, num(amt));
          if (st && a > 0) {
            this.sim.damageStructure(b, st, a, team || this.sim.groupTeam());
            if (!this.sim.s.bases[bid]) this.game.emit('razedBase', b);
          }
        }
        break;
      }
      case 'nm': if (Array.isArray(m.l)) for (const nid of m.l.slice(0, 64)) p.known.delete(nid); break;
      case 'ping': this.t.send(pid, { t: 'pong', c: m.c }); break;
      case 'pong': p.rtt = rttFrom(p.rtt, m.c); break;
    }
  }

  // ---- host → friends ----
  entry(car) {
    let e = this.ent.get(car);
    if (!e) { e = { nid: this.nextNid++, dv: 1, sig: null }; this.ent.set(car, e); this.byNid.set(e.nid, car); }
    const sig = `${car.team}|${car.title || car.name}|${car.factionColor || ''}`;
    if (e.design !== car.design || e.sig !== sig) {
      if (e.sig !== null) { e.dv++; for (const p of this.peers.values()) p.known.delete(e.nid); }
      e.design = car.design; e.sig = sig;
    }
    return e;
  }

  // snapshot of the cars near the given anchors, closest first, within a byte budget
  buildFast(anchors, limit, skip) {
    const g = this.game, list = [];
    for (const c of g.cars) {
      if (c.removed || c === skip || c.id === 'titlecam') continue;
      let d = Infinity;
      for (const a of anchors) { const dx = c.body.pos.x - a.x, dz = c.body.pos.z - a.z; d = Math.min(d, dx * dx + dz * dz); }
      if (c.isPlayer || c.isRemotePlayer) d = -1;
      if (d > VIEW_R * VIEW_R) continue;
      list.push([d, c]);
    }
    list.sort((a, b) => a[0] - b[0]);
    const squads = packSquads(Object.values(this.sim.s.squads).slice(0, 40));
    const recs = [], nids = [];
    let bytes = 40 + squads.length;
    for (const [, c] of list) {
      const e = this.entry(c);
      c.designVer = e.dv;
      const s = packCar(e.nid, c);
      if (bytes + s.length + 1 > limit) break;
      bytes += s.length + 1;
      recs.push(s); nids.push(e.nid);
    }
    return { str: packFast(this.sim.s.time, performance.now(), recs, squads, this.sim.s.group.wallet), nids };
  }

  sendMetas(pid, p, nids) {
    const l = [];
    for (const nid of nids) {
      if (p.known.has(nid)) continue;
      const car = this.byNid.get(nid);
      if (!car) continue;
      const m = carMeta(nid, car);
      if (car.isRemotePlayer) for (const [opid, op] of this.peers) if (op.car === car) m.pid = opid;
      if (car.isPlayer) m.title = `🎮 ${this.app.playerName}`;
      l.push(m);
      p.known.add(nid);
      if (l.length >= 4) { this.t.send(pid, { t: 'meta', l: l.splice(0) }); }
    }
    if (l.length) this.t.send(pid, { t: 'meta', l });
  }

  hostTick(dt) {
    const hz = FAST_HZ[this.kind];
    this.fastT -= dt;
    if (this.fastT <= 0 && this.peers.size) {
      this.fastT = 1 / hz;
      if (this.kind === 'room') {
        // one broadcast snapshot covering every friend
        const anchors = [];
        for (const p of this.peers.values()) if (p.car) anchors.push(p.car.body.pos);
        if (!anchors.length) anchors.push({ x: 0, z: 150 });
        const f = this.buildFast(anchors, this.t.fastLimit, null);
        for (const [pid, p] of this.peers) this.sendMetas(pid, p, f.nids);
        this.t.fastAll(f.str);
      } else {
        for (const [pid, p] of this.peers) {
          const anchor = p.car ? p.car.body.pos : { x: 0, z: 150 };
          const f = this.buildFast([anchor], this.t.fastLimit, p.car);
          this.sendMetas(pid, p, f.nids);
          this.t.fastTo(pid, f.str);
        }
      }
    }
    this.secT -= dt;
    if (this.secT <= 0) { this.secT = SECTION_EVERY[this.kind]; this.publishSections(false); }
    this.flushT -= dt;
    if (this.flushT <= 0) {
      this.flushT = 0.1;
      if (this.evQ.length && this.peers.size) { for (const e of this.evQ) this.t.sendAll(e); }
      this.evQ.length = 0;
      for (const [pid, p] of this.peers) if (p.hurt.length) { this.t.send(pid, { t: 'hurt', h: p.hurt.splice(0) }); }
    }
    this.sweepT -= dt;
    if (this.sweepT <= 0) {
      this.sweepT = 5;
      for (const [car, e] of this.ent) if (car.removed) { this.ent.delete(car); this.byNid.delete(e.nid); for (const p of this.peers.values()) p.known.delete(e.nid); }
      this.t.advertise(this.info());
    }
    this.pingT = (this.pingT ?? 0) - dt;
    if (this.pingT <= 0) {
      this.pingT = 2;
      for (const [pid, p] of this.peers) {
        this.t.send(pid, { t: 'ping', c: performance.now() });
        this.t.route?.(pid).then((r) => { if (r) p.route = r; });
      }
    }
  }

  publishSections(force) {
    if (!this.sim.s) return;
    for (const k of SECTIONS) {
      let json;
      try { json = JSON.stringify(buildSection(this.sim, k)); } catch (e) { console.warn('[net] section', k, e); continue; }
      if (!force && json === this.secJson[k]) continue;
      this.secJson[k] = json;
      if (this.t.sectionsViaDb) this.t.section(k, json);
      else if (this.peers.size) this.t.sendAll({ t: 'sec', k, d: json });
    }
  }

  // ======================================================== client
  async join(code, name) {
    this.isClient = true;
    this.code = code.toUpperCase().trim();
    this.t = await this.makeTransport();
    const sections = {};
    let welcome = null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(welcome ? 'The host is not sending the world. Try again.' : 'Could not reach the host. Check the code, and that they opened their game to friends.')), 25000);
      const done = () => {
        if (!welcome || SECTIONS.some((k) => !sections[k])) return;
        clearTimeout(timer);
        this.t.onSection = (k, json) => this.onSection(k, json);
        this.ready = true;
        resolve({ ...welcome, sections });
      };
      this.t.onSection = (k, json) => { sections[k] = json; done(); };
      this.t.onMsg = (m) => {
        if (m.t === 'welcome' && !welcome) {
          welcome = m; this.myPid = m.you;
          if (m.time !== undefined) { this.gtBase = num(m.time); this.gtAt = performance.now(); }
          done(); return;
        }
        if (m.t === 'sec' && !this.ready) { if (SECTIONS.includes(m.k) && typeof m.d === 'string') { sections[m.k] = m.d; done(); } return; }
        if (this.ready) this.onClientMsg(m);
      };
      this.t.onFast = (s) => { if (this.ready) this.onClientFast(s); };
      this.t.onLost = (why) => {
        if (!this.ready) { clearTimeout(timer); reject(new Error(why === 'nodb' ? 'This game cannot share its world here.' : 'The host closed the game.')); return; }
        this.app.onHostLost();
      };
      this.t.join(this.code, name, this.app.seed).then((info) => {
        // the artifact room tells us the host's seed before the welcome: reboot early if the worlds differ
        if (info?.seed !== undefined && info.seed !== this.app.seed) { clearTimeout(timer); resolve({ seed: info.seed, hostName: info.hostName, early: true }); }
      }).catch((e) => { clearTimeout(timer); reject(e); });
    });
  }

  // apply the sections received during the join (called once the app has a fresh sim to fill)
  applyJoinSections(sections) {
    for (const k of SECTIONS) applySection(this.sim, k, JSON.parse(sections[k]));
    if (this.gtBase !== undefined) this.sim.s.time = this.gtBase;
  }

  onSection(k, json) {
    if (!SECTIONS.includes(k) || !this.sim.s) return;
    let d;
    try { d = JSON.parse(json); } catch { return; }
    applySection(this.sim, k, d);
    if (k === 'core' || k === 'factions') this.app.onTeamChanged?.();
  }

  onClientMsg(m) {
    switch (m.t) {
      case 'sec': if (SECTIONS.includes(m.k) && typeof m.d === 'string') this.onSection(m.k, m.d); break;
      case 'meta': if (Array.isArray(m.l)) for (const meta of m.l) this.onMeta(meta); break;
      case 'res': { const r = this.pending.get(m.id); if (r) { this.pending.delete(m.id); r(m.r); } break; }
      case 'ev': {
        // chronicle entries show up in the journal now rather than with the next world-state section
        const c = Array.isArray(m.d) ? m.d[0] : null;
        const chron = this.sim.s?.chronicle;
        if (m.e === 'chronicle' && c?.id && chron && !chron.some((x) => x.id === c.id)) chron.push(c);
        this.app.onSimEvent(m.e, m.d);
        break;
      }
      case 'hurt': {
        const car = this.game.player?.car;
        if (!car || !Array.isArray(m.h)) return;
        for (const [amt, kind, src] of m.h) this.game.applyDamage(car, Math.min(MAX_DMG, num(amt)), this.byNid.get(src) || null, { kind, fromNet: true });
        break;
      }
      case 'kill': this.game.emit('playerKill', { title: String(m.n || 'someone'), name: String(m.n || '') }, null); break;
      case 'ping': this.t.send({ t: 'pong', c: m.c }); break;
      case 'pong': this.rtt = rttFrom(this.rtt, m.c); break;
    }
  }

  onMeta(meta) {
    if (!meta || typeof meta.n !== 'number') return;
    this.metas.set(meta.n, meta);
    this.needMeta.delete(meta.n);
    const car = this.byNid.get(meta.n);
    if (car && !car.removed && car.netDv !== meta.dv) {
      car.netDv = meta.dv;
      try { car.setDesign(meta.design); car.view?.build(); } catch (e) { console.warn('[net] design', e); }
      this.dressReplica(car, meta);
    }
  }

  dressReplica(car, meta) {
    car.title = meta.title || meta.name;
    car.name = meta.name;
    car.team = meta.team;
    car.isRemotePlayer = !!meta.player;
    car.vip = !!meta.vip;
    car.factionColor = meta.fc;
    car.traffic = !!meta.traffic;
  }

  onClientFast(str) {
    let f;
    try { f = unpackFast(str); } catch { return; }
    this.hostClock.see(f.t);
    this.gtBase = f.gt; this.gtAt = performance.now();
    const g = this.game, now = performance.now();
    for (const r of f.cars) {
      const meta = this.metas.get(r.nid);
      if (!meta) { this.needMeta.add(r.nid); continue; }
      if (meta.pid && meta.pid === this.myPid) continue;
      if (meta.dv !== r.dv) this.needMeta.add(r.nid);
      let car = this.byNid.get(r.nid);
      if (!car || car.removed) {
        const opts = { id: 'r' + r.nid, name: meta.name, team: meta.team, x: r.p[0], z: r.p[2], isRemote: true };
        try { car = g.spawnCar({ ...opts, design: meta.design }); } catch { car = g.spawnCar({ ...opts, design: DEFAULT_DESIGN }); }
        car.netDv = meta.dv;
        car.netNid = r.nid;
        this.dressReplica(car, meta);
        this.byNid.set(r.nid, car);
      }
      this.seen.set(r.nid, now);
      pushSample(car, f.t, r);
      this.applyRec(car, r);
    }
    if (f.wallet !== null && this.sim.s) this.sim.s.group.wallet = f.wallet;
    const sq = this.sim.s?.squads;
    if (sq) for (const [id, p] of Object.entries(f.squads)) { const q = sq[id]; if (q) { q.x = p.x; q.z = p.z; q.tx = p.tx; q.tz = p.tz; } }
  }

  applyRec(car, r) {
    const wasAlive = car.alive;
    car.alive = !!(r.f & FLAG.alive);
    car.hp = r.hp;
    if (wasAlive && !car.alive && car.netBuf?.length > 1) {
      const p = car.body.pos;
      this.game.fx.explosion(p.x, p.y + 1, p.z, 1.2 + car.stats.size * 0.35);
      this.game.fx.wreckDebris(p.x, p.y, p.z, car.design.paint || '#888', 8);
      this.game.audio?.play('bigexplosion', p);
    }
    car.netFire0 = !!(r.f & FLAG.fire0);
    car.netFire1 = !!(r.f & FLAG.fire1);
    car.boostVisual = !!(r.f & FLAG.boost);
    car.body.controls.throttle = r.thr;
    car.body.controls.steer = r.st;
    for (const w of car.weapons) if (w.kind !== 'rear') { w.yaw = r.wy; w.pitch = r.wp; }
  }

  clientTick(dt) {
    const g = this.game, now = performance.now();
    const pc = g.player?.car;
    // world clock follows the host smoothly
    const s = this.sim.s;
    if (s && this.gtBase !== undefined) {
      const target = this.gtBase + (now - this.gtAt) / 1000;
      if (Math.abs(target - s.time) > 4) s.time = target;
      else s.time += dt + (target - s.time) * Math.min(1, dt * 2);
    }
    this.fastT -= dt;
    if (this.fastT <= 0 && pc) {
      this.fastT = 1 / FAST_HZ[this.kind];
      pc.designVer = 0;
      this.t.fast(`${Math.round(now).toString(36)}|${packCar(0, pc)}`);
    }
    this.metaT -= dt;
    if (this.metaT <= 0 && pc) {
      this.metaT = 1;
      // also re-sent now and then, in case the host lost us for a while and forgot our car
      if (pc.design !== this.sentDesign || this.app.playerName !== this.sentName || now - (this.metaAt || 0) > 15000) {
        this.sentDesign = pc.design; this.sentName = this.app.playerName; this.metaAt = now;
        this.t.send({ t: 'meta', name: this.app.playerName, design: pc.design });
      }
    }
    this.flushT -= dt;
    if (this.flushT <= 0) {
      this.flushT = this.kind === 'room' ? 0.2 : 0.1;
      if (this.dmgAcc.size) { this.t.send({ t: 'dmg', h: [...this.dmgAcc.values()].map(([nid, a, k]) => [nid, Math.round(a * 10) / 10, k]) }); this.dmgAcc.clear(); }
      if (this.sdAcc.size) { this.t.send({ t: 'sd', h: [...this.sdAcc.values()].map(([b, st, a, team]) => [b, st, Math.round(a * 10) / 10, team]) }); this.sdAcc.clear(); }
      if (this.needMeta.size && now - (this.nmAt || 0) > 600) { this.nmAt = now; this.t.send({ t: 'nm', l: [...this.needMeta].slice(0, 32) }); }
    }
    this.sweepT -= dt;
    if (this.sweepT <= 0) {
      this.sweepT = 0.5;
      for (const [nid, car] of this.byNid) {
        if (car.removed || now - (this.seen.get(nid) || 0) > 2500) { if (!car.removed) g.removeCar(car); this.byNid.delete(nid); this.seen.delete(nid); }
      }
    }
    this.pingT = (this.pingT ?? 0) - dt;
    if (this.pingT <= 0) {
      this.pingT = 2;
      this.t.send({ t: 'ping', c: performance.now() });
      this.t.route?.().then((r) => { if (r) this.route = r; });
    }
  }

  // ======================================================== shared API used by the rest of the game
  // move replicas along their snapshot timeline; they fire visual-only shots from their triggers
  preStep(dt) {
    const g = this.game;
    const now = performance.now();
    for (const car of g.cars) {
      if (!car.isRemote || !car.netBuf) continue;
      const clock = car.netClock || this.hostClock;
      if (!sampleAt(car, clock.now(now))) continue;
      const b = car.body;
      b.updateFrame();
      const sp = b.vel.length();
      for (const w of b.wheels) {
        w.world.copy(w.local).applyQuaternion(b.quat).add(b.pos);
        const gh = g.terrain.heightAt(w.world.x, w.world.z);
        w.contact = w.world.y - gh < b.rest + b.wheelR + 0.3;
        w.compression = Math.max(0, b.rest + b.wheelR - (w.world.y - gh));
        w.contactPoint.set(w.world.x, gh, w.world.z);
        w.spin += (sp / b.wheelR) * dt;
      }
      if (!car.alive) continue;
      for (const w of car.weapons) {
        w.cooldown = Math.max(0, w.cooldown - dt);
        const trig = w.kind === 'rear' ? car.netFire1 : car.netFire0;
        if (!trig) continue;
        w.aligned = true;
        car.ammo = car.energy = car.fuel = 1e6;
        g.combat.tryFire(car, w, dt);
      }
    }
  }

  // the renderer asks for a replica's pose at this frame's time, so motion is smooth at any refresh rate
  renderPose(car, pos, quat) {
    if (!car.netBuf) return false;
    const clock = car.netClock || this.hostClock;
    return samplePose(car, clock.now(performance.now()), pos, quat, _vel);
  }

  // all damage is decided where the shooter lives; replicas only forward it
  sendDamage(target, amount, source, opts) {
    if (opts.fromNet) return;
    if (this.isClient) {
      if (!source?.isPlayer || !target.netNid) return;
      // keyed by damage type too: explosive resistance applies per kind on the host
      const key = `${target.netNid}|${opts.kind || 'bullet'}`;
      const acc = this.dmgAcc.get(key) || [target.netNid, 0, opts.kind || 'bullet'];
      acc[1] += amount;
      this.dmgAcc.set(key, acc);
      return;
    }
    for (const p of this.peers.values()) {
      if (p.car !== target) continue;
      const src = source ? this.ent.get(source)?.nid || 0 : 0;
      const last = p.hurt[p.hurt.length - 1];
      if (last && last[1] === (opts.kind || 'bullet') && last[2] === src) last[0] += amount;
      else p.hurt.push([amount, opts.kind || 'bullet', src]);
    }
  }

  // legacy entry point (structure damage from a client)
  send(d) {
    if (this.isClient && d?.t === 'structDmg') {
      const key = d.b + '|' + d.s;
      const acc = this.sdAcc.get(key) || [d.b, d.s, 0, d.team];
      acc[2] += d.amt;
      this.sdAcc.set(key, acc);
    }
  }

  request(name, args) {
    const id = this.reqId++;
    const msg = { t: 'cmd', id, n: name, a: safe(args) };
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.t.send(msg);
      // answers can be lost on the artifact room; the host de-duplicates by id, so asking again is safe
      let tries = 0;
      const timer = setInterval(() => {
        if (!this.pending.has(id)) { clearInterval(timer); return; }
        if (++tries <= 3) { this.t.send(msg); return; }
        clearInterval(timer);
        this.pending.delete(id);
        resolve({ ok: false, msg: 'The host did not answer.' });
      }, 3500);
    });
  }

  event(ev, data) { if (this.isHost && this.peers.size) this.evQ.push({ t: 'ev', e: ev, d: data }); }

  update() {
    if (!this.t) return;
    // wall-clock: network cadence must not slow down when the frame rate does
    const now = performance.now();
    const dt = Math.min(1, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;
    if (this.isHost) this.hostTick(dt);
    else if (this.ready) this.clientTick(dt);
    this.t.update(dt);
  }

  statusHTML() {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (this.isClient) return `<div class="center-msg"><h3>Riding with your host</h3><p>Game <b>${esc(this.code)}</b>. The host's world is the real one: you share their crew, wallet and faction.</p></div>`;
    const list = [...this.peers.values()].map((p) => `<li>🚗 ${esc(p.name)}</li>`).join('');
    const link = this.inviteLink();
    const how = this.kind === 'room'
      ? '<p>Friends open this same artifact and pick your game under <b>Join a Friend</b>. Share it with them by email from the artifact\'s Share menu: they must be signed in to claude.ai, and visitors on a public link can\'t join co-op.</p>'
      : `<p>Send friends this link. It opens the game with your code filled in; they pick a name and press Join:</p><div class="invite"><input readonly value="${esc(link)}" onclick="this.select()"/><button data-action="copyInvite">Copy link</button></div><p class="muted small">Or they press <b>Join a Friend</b> and type the code.</p>`;
    return `<div class="center-msg"><h3>Co-op is open</h3><div class="bigcode">${esc(this.code)}</div>${how}<h4>In your group</h4><ul>${list || '<li class="muted">Nobody yet</li>'}</ul><p class="muted small">${this.kind === 'room' ? 'Runs through claude.ai: no setup, but updates are a little slower than a direct connection.' : 'Peer-to-peer: your browser runs the world and friends connect straight to you.'} Keep this tab open while friends play.</p></div>`;
  }

  close() { this.t?.close(); }
}

const _vel = new THREE.Vector3();
// round-trip time from a pong carrying our own send time, lightly smoothed
function rttFrom(prev, sent) {
  const ms = performance.now() - Number(sent);
  if (!(ms >= 0 && ms < 60000)) return prev;
  return prev ? prev + (ms - prev) * 0.3 : ms;
}
function safe(v) { try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch { return null; } }
