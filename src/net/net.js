// Player-hosted co-op. The host's browser runs the world; friends connect peer-to-peer (WebRTC via PeerJS)
// and join the host's group. A BroadcastChannel transport (?net=local) allows same-machine testing.
import * as THREE from 'three';

const PREFIX = 'dustbowl-dyn-';
const CAR_RATE = 1 / 20;
const STATE_RATE = 2;

function randomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// ----- transports -----
class LocalTransport {
  constructor(code, id) {
    this.ch = new BroadcastChannel(PREFIX + code);
    this.id = id;
    this.handlers = {};
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (m.to && m.to !== this.id) return;
      if (m.from === this.id) return;
      if (m.sys === 'hello') this.handlers.connect?.(m.from, m.name);
      else if (m.sys === 'bye') this.handlers.disconnect?.(m.from);
      else this.handlers.data?.(m.from, m.data);
    };
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  hello(name) { this.ch.postMessage({ sys: 'hello', from: this.id, name }); }
  send(to, data) { this.ch.postMessage({ from: this.id, to, data }); }
  broadcast(data) { this.ch.postMessage({ from: this.id, data }); }
  close() { this.ch.postMessage({ sys: 'bye', from: this.id }); this.ch.close(); }
}

class PeerTransport {
  constructor() { this.handlers = {}; this.conns = new Map(); }
  on(ev, fn) { this.handlers[ev] = fn; }
  async open(id) {
    const { default: Peer } = await import('peerjs');
    return new Promise((resolve, reject) => {
      this.peer = id ? new Peer(id) : new Peer();
      this.peer.on('open', (pid) => { this.id = pid; resolve(pid); });
      this.peer.on('error', (e) => { this.handlers.error?.(e); reject(e); });
      this.peer.on('connection', (conn) => this.attach(conn));
    });
  }
  attach(conn) {
    conn.on('open', () => { this.conns.set(conn.peer, conn); this.handlers.connect?.(conn.peer, conn.metadata?.name); });
    conn.on('data', (d) => this.handlers.data?.(conn.peer, d));
    conn.on('close', () => { this.conns.delete(conn.peer); this.handlers.disconnect?.(conn.peer); });
  }
  connect(hostId, name) {
    const conn = this.peer.connect(hostId, { reliable: true, metadata: { name } });
    this.attach(conn);
    return conn;
  }
  send(to, data) { const c = this.conns.get(to); if (c?.open) c.send(data); }
  broadcast(data) { for (const c of this.conns.values()) if (c.open) c.send(data); }
  close() { this.peer?.destroy(); }
}

export class Net {
  constructor(app) {
    this.app = app;
    this.isHost = false;
    this.isClient = false;
    this.peers = new Map(); // peerId -> { name, car }
    this.pending = new Map();
    this.reqId = 1;
    this.carT = 0;
    this.stateT = 0;
    this.lastKeys = {};
    this.remoteCars = new Map(); // id -> car (replicas)
    this.log = [];
  }

  get game() { return this.app.game; }
  get sim() { return this.app.sim; }

  // ---------- setup ----------
  async host() {
    this.isHost = true;
    this.code = randomCode();
    const local = new URLSearchParams(location.search).get('net') === 'local';
    if (local) {
      this.t = new LocalTransport(this.code, 'host');
      this.myId = 'host';
    } else {
      this.t = new PeerTransport();
      this.myId = await this.t.open(PREFIX + this.code);
    }
    this.t.on('connect', (pid, name) => this.onPeerJoin(pid, name));
    this.t.on('disconnect', (pid) => this.onPeerLeave(pid));
    this.t.on('data', (pid, d) => this.onHostData(pid, d));
    this.app.ui?.toast(`Co-op open! Friends join with code <b>${this.code}</b>`, 'good');
    return this.code;
  }

  async join(code, name) {
    this.isClient = true;
    this.code = code.toUpperCase().trim();
    const local = new URLSearchParams(location.search).get('net') === 'local';
    return new Promise(async (resolve, reject) => {
      this.onWelcome = resolve;
      const timer = setTimeout(() => reject(new Error('Could not reach the host. Check the code and that they opened the game to friends.')), 15000);
      this.onWelcomeTimer = timer;
      try {
        if (local) {
          this.myId = 'c' + Math.random().toString(36).slice(2, 8);
          this.t = new LocalTransport(this.code, this.myId);
          this.t.on('data', (pid, d) => this.onClientData(d));
          this.t.on('disconnect', (pid) => { if (pid === 'host') this.app.onHostLost(); });
          this.hostId = 'host';
          this.t.hello(name);
        } else {
          this.t = new PeerTransport();
          this.myId = await this.t.open();
          this.t.on('data', (pid, d) => this.onClientData(d));
          this.t.on('disconnect', () => this.app.onHostLost());
          this.hostId = PREFIX + this.code;
          this.t.connect(this.hostId, name);
        }
      } catch (e) { clearTimeout(timer); reject(e); }
    });
  }

  // ---------- host side ----------
  onPeerJoin(pid, name) {
    if (this.peers.has(pid)) return;
    this.peers.set(pid, { name: name || 'Friend', car: null });
    const g = this.game, sim = this.sim;
    this.t.send(pid, { t: 'welcome', seed: sim.s.seed, state: sim.serialize(), you: pid, hostName: sim.s.group.leaderName });
    this.lastKeys = {};
    this.app.ui?.toast(`🚗 ${name || 'A friend'} joined your group!`, 'good');
    sim.chronicle('player', { title: `${name || 'A friend'} Joins the Crew`, text: `${name || 'Another driver'} rolled in from the dunes and threw in their lot with ${sim.s.group.leaderName || 'the stranger'}.`, importance: 1 });
    void g;
  }

  onPeerLeave(pid) {
    const p = this.peers.get(pid);
    if (!p) return;
    if (p.car) this.game.removeCar(p.car);
    this.peers.delete(pid);
    delete this.sim.s.players[pid];
    this.app.ui?.toast(`${p.name} left.`, 'info');
  }

  onHostData(pid, d) {
    const p = this.peers.get(pid);
    if (!p) { if (d.t === 'hello') this.onPeerJoin(pid, d.name); return; }
    switch (d.t) {
      case 'car': this.applyRemotePlayer(pid, p, d); break;
      case 'cmd': {
        const res = this.sim.cmd(d.name, d.args, pid);
        this.t.send(pid, { t: 'res', id: d.id, res });
        break;
      }
      case 'dmg': { // client hit an NPC (or the host)
        const car = this.game.carById.get(d.target) || (d.target === 'host' ? this.game.player.car : null);
        const src = p.car;
        if (car) this.game.applyDamage(car, d.amt, src, { kind: d.kind, x: d.x, y: d.y, z: d.z, quiet: true, fromNet: true });
        break;
      }
      case 'structDmg': {
        const b = this.sim.s.bases[d.b];
        const st = b?.structs.find((s) => s.id === d.s);
        if (st) this.sim.damageStructure(b, st, d.amt, d.team);
        break;
      }
      case 'shot': this.spawnVisualShot(d); this.broadcastExcept(pid, d); break;
      case 'fx': this.applyFx(d); this.broadcastExcept(pid, d); break;
    }
  }

  broadcastExcept(pid, d) { for (const k of this.peers.keys()) if (k !== pid) this.t.send(k, d); }

  applyRemotePlayer(pid, p, d) {
    const g = this.game;
    if (!p.car || p.car.removed) {
      p.car = g.spawnCar({ id: 'p_' + pid, name: d.name || p.name, design: d.design, team: this.sim.groupTeam(), x: d.p[0], z: d.p[2], isRemote: true });
      p.car.isRemotePlayer = true;
      p.car.title = `🎮 ${d.name || p.name}`;
      p.designKey = JSON.stringify(d.design);
    }
    if (d.design && JSON.stringify(d.design) !== p.designKey) { p.car.setDesign(d.design); p.designKey = JSON.stringify(d.design); }
    this.applyCarState(p.car, d);
    p.car.team = this.sim.groupTeam();
    this.sim.cmd('playerPos', { x: d.p[0], z: d.p[2], name: d.name }, pid);
  }

  // ---------- client side ----------
  onClientData(d) {
    switch (d.t) {
      case 'welcome':
        clearTimeout(this.onWelcomeTimer);
        this.myPid = d.you;
        this.onWelcome?.(d);
        break;
      case 'state': this.applyState(d); break;
      case 'cars': this.applyCars(d); break;
      case 'res': { const r = this.pending.get(d.id); if (r) { this.pending.delete(d.id); r(d.res); } break; }
      case 'dmgYou': {
        const car = this.game.player?.car;
        if (car) this.game.applyDamage(car, d.amt, this.game.carById.get(d.src) || null, { kind: d.kind, fromNet: true, x: d.x, y: d.y, z: d.z });
        break;
      }
      case 'event': this.app.onSimEvent(d.ev, d.data); break;
      case 'shot': this.spawnVisualShot(d); break;
      case 'fx': this.applyFx(d); break;
    }
  }

  applyState(d) {
    const s = this.sim.s;
    if (!s) return;
    Object.assign(s, d.parts);
    if (d.parts.chronicleTail) {
      for (const c of d.parts.chronicleTail) if (!s.chronicle.some((x) => x.id === c.id)) s.chronicle.push(c);
      delete s.chronicleTail;
    }
  }

  applyCars(d) {
    const g = this.game;
    const seen = new Set();
    for (const c of d.list) {
      if (c.id === 'p_' + this.myPid) continue;
      seen.add(c.id);
      let car = this.remoteCars.get(c.id);
      if (!car || car.removed) {
        car = g.spawnCar({ id: c.id, name: c.name, design: c.design, team: c.team, x: c.p[0], z: c.p[2], isRemote: true });
        car.title = c.title || c.name;
        car.isRemotePlayer = !!c.player;
        car.vip = !!c.vip;
        car.factionColor = c.fc;
        car.traffic = !!c.traffic;
        this.remoteCars.set(c.id, car);
      }
      this.applyCarState(car, c);
    }
    for (const [id, car] of this.remoteCars) if (!seen.has(id)) { g.removeCar(car); this.remoteCars.delete(id); }
  }

  applyCarState(car, d) {
    car.netTarget = car.netTarget || { p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3() };
    car.netTarget.p.set(d.p[0], d.p[1], d.p[2]);
    car.netTarget.q.set(d.q[0], d.q[1], d.q[2], d.q[3]);
    car.netTarget.v.set(d.v[0], d.v[1], d.v[2]);
    if (!car.netInit) { car.body.pos.copy(car.netTarget.p); car.body.quat.copy(car.netTarget.q); car.netInit = true; }
    car.hp = d.hp; car.alive = d.alive !== false;
    car.body.controls.throttle = d.thr || 0;
    car.body.controls.steer = d.st || 0;
    car.boostVisual = !!d.b;
    if (d.w) car.weapons.forEach((w, i) => { if (d.w[i]) { w.yaw = d.w[i][0]; w.pitch = d.w[i][1]; } });
    if (d.dead && car.alive) { car.alive = false; }
  }

  // smooth replicas toward their latest snapshot every physics step
  smoothRemotes(dt) {
    for (const car of this.game.cars) {
      if (!car.isRemote || !car.netTarget) continue;
      const t = car.netTarget;
      t.p.addScaledVector(t.v, dt);
      car.body.vel.copy(t.v);
      car.body.pos.lerp(t.p, Math.min(1, dt * 12));
      car.body.quat.slerp(t.q, Math.min(1, dt * 12));
      car.body.updateFrame();
      for (const w of car.body.wheels) { w.world.copy(w.local).applyQuaternion(car.body.quat).add(car.body.pos); const gh = this.game.terrain.heightAt(w.world.x, w.world.z); w.contact = w.world.y - gh < car.body.rest + car.body.wheelR + 0.3; w.compression = Math.max(0, car.body.rest + car.body.wheelR - (w.world.y - gh)); w.contactPoint.set(w.world.x, gh, w.world.z); w.spin += t.v.length() / car.body.wheelR * dt; }
    }
  }

  carMsg(car, extra = {}) {
    const b = car.body;
    const r = (v) => Math.round(v * 100) / 100;
    return {
      id: car.id, name: car.name, title: car.title, team: car.team, design: car.design, fc: car.factionColor, vip: car.vip, traffic: car.traffic,
      p: [r(b.pos.x), r(b.pos.y), r(b.pos.z)], q: [r(b.quat.x), r(b.quat.y), r(b.quat.z), r(b.quat.w)], v: [r(b.vel.x), r(b.vel.y), r(b.vel.z)],
      hp: Math.round(car.hp), alive: car.alive, thr: b.controls.throttle, st: r(b.controls.steer), b: car.boostVisual ? 1 : 0,
      w: car.weapons.map((w) => [r(w.yaw), r(w.pitch)]), ...extra,
    };
  }

  // ---------- RPC ----------
  request(name, args) {
    const id = this.reqId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.t.send(this.hostId, { t: 'cmd', id, name, args });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve({ ok: false, msg: 'Host did not answer' }); } }, 8000);
    });
  }

  send(d) { if (this.isClient) this.t.send(this.hostId, d); else this.t.broadcast(d); }

  sendDamage(target, amount, source, opts) {
    if (opts.fromNet) return;
    if (this.isClient) {
      // only report damage we dealt
      if (source && source.isPlayer) this.t.send(this.hostId, { t: 'dmg', target: target.id, amt: amount, kind: opts.kind, x: opts.x, y: opts.y, z: opts.z });
      return;
    }
    // host: damage to a remote player's car goes to that player
    for (const [pid, p] of this.peers) if (p.car === target) this.t.send(pid, { t: 'dmgYou', amt: amount, kind: opts.kind, src: source?.id, x: opts.x, y: opts.y, z: opts.z });
  }

  shot(p) {
    // mirror projectile spawns so everyone sees the same fireworks
    const d = { t: 'shot', k: p.kind, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, team: p.team, life: p.life, grav: p.grav, splash: p.splash };
    if (this.isClient) this.t.send(this.hostId, d); else this.t.broadcast(d);
  }
  spawnVisualShot(d) {
    this.game.combat.spawn({ kind: d.k, owner: null, team: d.team, x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, dmg: 0, life: d.life, grav: d.grav, splash: d.splash || 0, visual: true });
  }
  fx(kind, data) { const d = { t: 'fx', kind, ...data }; if (this.isClient) this.t.send(this.hostId, d); else this.t.broadcast(d); }
  applyFx(d) { if (d.kind === 'explosion') this.game.fx.explosion(d.x, d.y, d.z, d.s || 1); }

  // ---------- tick ----------
  update(dt) {
    if (!this.t) return;
    this.carT -= dt; this.stateT -= dt;
    const g = this.game;
    if (this.isClient) {
      if (this.carT <= 0 && g.player?.car) {
        this.carT = CAR_RATE;
        const c = g.player.car;
        this.t.send(this.hostId, { t: 'car', ...this.carMsg(c, { name: this.app.playerName, design: c.design }) });
      }
      return;
    }
    if (!this.peers.size) return;
    if (this.carT <= 0) {
      this.carT = CAR_RATE;
      for (const [pid, p] of this.peers) {
        const pc = p.car;
        const list = [];
        for (const c of g.cars) {
          if (c === pc) continue;
          if (pc && c.body.pos.distanceTo(pc.body.pos) > 900) continue;
          list.push(this.carMsg(c, c.isPlayer ? { player: 1, title: `🎮 ${this.app.playerName}` } : c.isRemotePlayer ? { player: 1 } : {}));
        }
        this.t.send(pid, { t: 'cars', list });
      }
    }
    if (this.stateT <= 0) {
      this.stateT = STATE_RATE;
      const s = this.sim.s;
      const parts = {};
      for (const k of Object.keys(s)) {
        if (k === 'chronicle') continue;
        const json = JSON.stringify(s[k]);
        if (this.lastKeys[k] !== json) { parts[k] = s[k]; this.lastKeys[k] = json; }
      }
      parts.chronicleTail = s.chronicle.slice(-12);
      this.t.broadcast({ t: 'state', parts });
    }
  }

  event(ev, data) { if (this.isHost && this.peers.size) this.t.broadcast({ t: 'event', ev, data }); }

  statusHTML() {
    const list = [...this.peers.values()].map((p) => `<li>🚗 ${p.name}</li>`).join('');
    if (this.isClient) return `<div class="center-msg"><h3>Connected to host</h3><p>Code <b>${this.code}</b>. The host's world is authoritative; you share their group, wallet and faction.</p></div>`;
    return `<div class="center-msg"><h3>Co-op is open</h3><p>Friends join from the title screen with this code:</p><div class="bigcode">${this.code}</div><button data-action="copyCode">Copy code</button><h4>In your group</h4><ul>${list || '<li class="muted">Nobody yet</li>'}</ul><p class="muted small">Peer-to-peer over WebRTC. A free public broker is used only to introduce your browsers; the game runs on your machine.</p></div>`;
  }

  close() { this.t?.close(); }
}
