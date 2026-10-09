// Three ways to move bytes between the host and friends. They all expose the same small interface to Net:
//   host side:   host(code, info) · send(pid, obj) · fastTo(pid, str) / fastAll(str) · section(key, json) · advertise(info) · update(dt) · close()
//                callbacks onJoin(pid, name) · onLeave(pid) · onMsg(pid, obj) · onFast(pid, str)
//   client side: join(code, name) · send(obj) · fast(str) · update(dt) · close()
//                callbacks onMsg(obj) · onFast(str) · onSection(key, json) · onLost(reason)
//
// PeerTransport  – WebRTC via PeerJS for the standalone/hosted build. Raw strings (no BinaryPack), and a second
//                  unordered channel for snapshots so a lost packet never stalls the world.
// LocalTransport – BroadcastChannel between tabs of one browser (?net=local), for testing.
// RoomTransport  – the claude.ai artifact's `room` + `db` capabilities (WebRTC is not available inside artifacts).
//                  Snapshots ride the host's presence, commands ride each friend's presence (friends may be view-only),
//                  host replies ride a batched event topic, and the world state lives in db documents.

export const PEER_PREFIX = 'dustbowl-dyn-';

const noop = () => {};
class Base {
  constructor() {
    this.onJoin = noop; this.onLeave = noop; this.onMsg = noop; this.onFast = noop;
    this.onSection = noop; this.onLost = noop;
  }
  update() {}
  advertise() {}
}

function parseWire(d, onMsg, onFast) {
  if (typeof d !== 'string' || !d.length) return;
  if (d[0] === 'F') onFast(d.slice(1));
  else if (d[0] === 'J') { let o; try { o = JSON.parse(d.slice(1)); } catch { return; } if (o && typeof o === 'object') onMsg(o); }
}

// ---------------------------------------------------------------- PeerJS
export class PeerTransport extends Base {
  constructor() { super(); this.kind = 'peer'; this.conns = new Map(); this.fastLimit = 14000; this.sectionsViaDb = false; }

  async openPeer(id) {
    const { default: Peer } = await import('peerjs');
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      let opened = false;
      peer.on('open', () => { opened = true; resolve(peer); });
      peer.on('error', (e) => {
        if (!opened) { peer.destroy(); reject(e); return; }
        if (e.type === 'peer-unavailable') this.connectFail?.(e);
      });
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { /* gone */ } }, 1000); });
    });
  }

  async host(code) {
    this.peer = await this.openPeer(PEER_PREFIX + code);
    this.peer.on('connection', (conn) => {
      const pid = conn.peer, ch = conn.metadata?.ch === 'fast' ? 'fast' : 'ctl';
      conn.on('open', () => {
        const p = this.conns.get(pid) || {};
        p[ch] = conn;
        this.conns.set(pid, p);
        if (ch === 'ctl') this.onJoin(pid, String(conn.metadata?.name || 'Friend').slice(0, 20));
      });
      conn.on('data', (d) => parseWire(d, (o) => this.onMsg(pid, o), (s) => this.onFast(pid, s)));
      conn.on('close', () => {
        const p = this.conns.get(pid);
        if (ch === 'ctl' && p) { this.conns.delete(pid); try { p.fast?.close(); } catch { /* */ } this.onLeave(pid); }
      });
      conn.on('error', () => {});
    });
  }

  async join(code, name) {
    this.peer = await this.openPeer();
    const hostId = PEER_PREFIX + code;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not reach the host. Check the code, and that they opened their game to friends.')), 15000);
      this.connectFail = () => { clearTimeout(timer); reject(new Error(`No game is open with code ${code}.`)); };
      this.ctl = this.peer.connect(hostId, { reliable: true, serialization: 'raw', metadata: { ch: 'ctl', name } });
      this.fastConn = this.peer.connect(hostId, { reliable: false, serialization: 'raw', metadata: { ch: 'fast' } });
      for (const c of [this.ctl, this.fastConn]) {
        c.on('data', (d) => parseWire(d, (o) => this.onMsg(o), (s) => this.onFast(s)));
        c.on('error', () => {});
      }
      this.ctl.on('open', () => { clearTimeout(timer); resolve(); });
      this.ctl.on('close', () => { if (!this.closed) this.onLost('closed'); });
    });
  }

  send(pid, obj) {
    if (obj === undefined) { obj = pid; pid = null; }
    const c = pid ? this.conns.get(pid)?.ctl : this.ctl;
    if (c?.open) c.send('J' + JSON.stringify(obj));
  }
  sendAll(obj) { const s = 'J' + JSON.stringify(obj); for (const p of this.conns.values()) if (p.ctl?.open) p.ctl.send(s); }
  fastTo(pid, str) { const p = this.conns.get(pid); const c = p?.fast?.open ? p.fast : p?.ctl; if (c?.open) c.send('F' + str); }
  fast(str) { const c = this.fastConn?.open ? this.fastConn : this.ctl; if (c?.open) c.send('F' + str); }
  close() { this.closed = true; try { this.peer?.destroy(); } catch { /* */ } }
}

// ---------------------------------------------------------------- BroadcastChannel (same browser, for tests)
export class LocalTransport extends Base {
  constructor() { super(); this.kind = 'local'; this.fastLimit = 14000; this.sectionsViaDb = false; this.peers = new Set(); }
  open(code, id) {
    this.id = id;
    this.ch = new BroadcastChannel('dustbowl-local-' + code);
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.from === this.id || (m.to && m.to !== this.id)) return;
      if (this.isHost) {
        if (m.sys === 'hello') { if (!this.peers.has(m.from)) { this.peers.add(m.from); this.onJoin(m.from, String(m.name || 'Friend').slice(0, 20)); } return; }
        if (m.sys === 'bye') { if (this.peers.delete(m.from)) this.onLeave(m.from); return; }
        if (this.peers.has(m.from)) parseWire(m.d, (o) => this.onMsg(m.from, o), (s) => this.onFast(m.from, s));
      } else {
        if (m.from !== 'host') return;
        if (m.sys === 'bye') { this.onLost('closed'); return; }
        parseWire(m.d, (o) => this.onMsg(o), (s) => this.onFast(s));
      }
    };
  }
  async host(code) { this.isHost = true; this.open(code, 'host'); this.ch.postMessage({ sys: 'here', from: 'host' }); }
  async join(code, name) {
    this.open(code, 'c' + Math.random().toString(36).slice(2, 8));
    this.ch.postMessage({ sys: 'hello', from: this.id, name });
  }
  post(to, d) { this.ch?.postMessage({ from: this.id, to, d }); }
  send(pid, obj) { if (obj === undefined) { obj = pid; pid = 'host'; } this.post(pid, 'J' + JSON.stringify(obj)); }
  sendAll(obj) { this.post(null, 'J' + JSON.stringify(obj)); }
  fastTo(pid, str) { this.post(pid, 'F' + str); }
  fast(str) { this.post('host', 'F' + str); }
  close() { try { this.ch?.postMessage({ sys: 'bye', from: this.id }); this.ch?.close(); } catch { /* */ } this.ch = null; }
}

// ---------------------------------------------------------------- claude.ai artifact room + db
const MSG_BUDGET = 3700;     // bytes per emitted batch (platform limit 4 KiB)
const OUTBOX_BUDGET = 2600;  // bytes of queued client→host messages kept in presence
const FLUSH_EVERY = 0.12;    // s between host emits
export const ROOM_FAST_LIMIT = 3000; // bytes of snapshot inside the host's presence

let capsPromise = null;
// Resolve the artifact capabilities once. Each is null when unavailable (signed out, not granted, not an artifact).
export function artifactCaps() {
  if (!capsPromise) {
    const use = (n) => (window.claude?.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
    capsPromise = Promise.all([use('room'), use('db'), use('user')]).then(([room, db, user]) => ({ room, db, user }));
  }
  return capsPromise;
}

const jsonLen = (o) => { try { return JSON.stringify(o).length; } catch { return Infinity; } };

export class RoomTransport extends Base {
  constructor(caps) {
    super();
    this.kind = 'room';
    this.caps = caps;
    this.fastLimit = ROOM_FAST_LIMIT;
    this.sectionsViaDb = true;
    this.q = [];        // host: queued messages {to, m}
    this.flushT = 0;
    this.peerInfo = new Map(); // host: peer label -> {seq}
    this.acks = {};
    this.outbox = [];   // client: [seq, msg]
    this.seq = 0;
    this.unsub = [];
    this.writing = {};  // db key -> in-flight
    this.dirty = {};
  }

  static roomName(code) { return 'dd-' + code.toLowerCase(); }

  async enter(code) {
    const { room } = this.caps;
    if (!room) throw new Error('Co-op needs you to be signed in to claude.ai.');
    try { this.r = await room.join(RoomTransport.roomName(code)); this.named = true; }
    catch (e) {
      if (e?.code !== 'not_permitted' && e?.code !== 'limit_reached') throw new Error(`Could not open the co-op room (${e?.code || e}).`);
      this.r = room; this.named = false; // fall back to the lobby, tagged with the game code
    }
    this.code = code;
  }

  myPeer() { return this.r.peers().find((p) => p.sameTab)?.peer || null; }

  // ---------- host ----------
  async host(code, info) {
    this.isHost = true;
    await this.enter(code);
    const { db, user } = this.caps;
    let uid = null;
    try { uid = await user?.id(); } catch { /* */ }
    this.slot = (uid ? 'h-' + String(uid).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 80) : 'g-' + code.toLowerCase());
    this.db = db;
    this.base = { r: 'h', g: code, seed: info.seed, db: db ? this.slot : null, name: info.name };
    await this.r.presence({ ...this.base, snap: '', ack: {} });
    this.unsub.push(this.r.onPeers((ch) => this.hostPeers(ch)));
    this.advertise(info);
  }

  advertise(info) {
    // the lobby lists open games so friends can pick one instead of typing a code
    const room = this.caps.room;
    const key = `${info.name}|${info.day}|${info.n}`;
    if (key === this.adKey || this.closed) return;
    this.adKey = key;
    room?.presence({ dd: { code: this.code, host: String(info.name || 'Host').slice(0, 24), day: info.day | 0, n: info.n | 0 } }).catch(() => {});
  }

  hostPeers(ch) {
    for (const p of [...ch.joined, ...ch.updated]) {
      if (p.sameTab || p.kind !== 'viewer') continue;
      const pr = p.presence || {};
      if (pr.r !== 'c' || (!this.named && pr.g !== this.code)) continue;
      let info = this.peerInfo.get(p.peer);
      if (!info) { info = { seq: 0, fast: '' }; this.peerInfo.set(p.peer, info); this.onJoin(p.peer, String(pr.name || 'Friend').slice(0, 20)); }
      if (typeof pr.f === 'string' && pr.f !== info.fast) { info.fast = pr.f; this.onFast(p.peer, pr.f); }
      if (Array.isArray(pr.o)) {
        for (const item of pr.o) {
          if (!Array.isArray(item) || typeof item[0] !== 'number' || item[0] <= info.seq) continue;
          info.seq = item[0];
          if (item[1] && typeof item[1] === 'object') this.onMsg(p.peer, item[1]);
        }
        if (this.acks[p.peer] !== info.seq) { this.acks[p.peer] = info.seq; this.ackDirty = true; }
      }
    }
    for (const p of ch.left) {
      if (this.peerInfo.delete(p.peer)) { delete this.acks[p.peer]; this.ackDirty = true; this.onLeave(p.peer); }
    }
  }

  // host: send(pid, msg) queues a batched emit · client: send(msg) goes into this viewer's presence outbox
  send(a, b) {
    if (this.isHost) this.q.push({ to: a, m: b });
    else { (this.pendingOut ||= []).push(a); this.refill(); }
  }
  sendAll(m) { this.q.push({ to: null, m }); }
  fastAll(str) { this.snap = str; this.snapDirty = true; }

  // world-state sections live in db documents (written only when they change, one write at a time per doc)
  section(key, json) {
    if (!this.db) return;
    this.dirty[key] = json;
    this.pump(key);
  }
  pump(key) {
    if (this.writing[key] || this.dirty[key] === undefined || this.closed) return;
    const json = this.dirty[key];
    delete this.dirty[key];
    this.writing[key] = true;
    const ref = this.db.doc(`games/${this.slot}/sec/${key}`);
    ref.set({ code: this.code, d: json }).catch((e) => {
      console.warn('[net] db write failed', key, e?.code || e);
      if (this.dirty[key] === undefined) this.dirty[key] = json;
      return new Promise((r) => setTimeout(r, e?.code === 'resource_exhausted' ? 6000 : 2000));
    }).finally(() => { this.writing[key] = false; this.pump(key); });
  }

  update(dt) {
    if (!this.r || this.closed) return;
    // presence and emits share ~40 sends/s per page: keep presence to ~15/s and batch emits
    this.presT = (this.presT || 0) - dt;
    if (this.isHost) {
      this.flushT -= dt;
      if (this.flushT <= 0 && this.q.length) { this.flushT = FLUSH_EVERY; this.flushHost(); }
      if ((this.snapDirty || this.ackDirty) && this.presT <= 0) {
        this.presT = 1 / 15;
        this.snapDirty = false; this.ackDirty = false;
        this.r.presence({ snap: this.snap || '', ack: { ...this.acks } }).catch(() => {});
      }
    } else if ((this.fastDirty || this.outDirty) && this.presT <= 0) {
      this.presT = 1 / 15;
      this.fastDirty = false; this.outDirty = false;
      this.r.presence({ f: this.myFast || '', o: this.outbox.slice() }).catch(() => {});
    }
  }

  flushHost() {
    // group queued messages into emits of at most MSG_BUDGET bytes; each batch names its recipients
    const batches = [];
    let cur = [], size = 20;
    for (const { to, m } of this.q) {
      const item = to ? { to, m } : { m };
      const n = jsonLen(item) + 1;
      if (n > MSG_BUDGET) { console.warn('[net] dropped oversized message', m?.t, n); continue; }
      if (size + n > MSG_BUDGET && cur.length) { batches.push(cur); cur = []; size = 20; }
      cur.push(item); size += n;
    }
    if (cur.length) batches.push(cur);
    this.q.length = 0;
    for (const b of batches) this.r.emit('m', { g: this.code, b }).catch((e) => { if (e?.code === 'not_permitted') this.onLost('not_permitted'); });
  }

  // ---------- client ----------
  async join(code, name) {
    this.isHost = false;
    await this.enter(code);
    await this.r.presence({ r: 'c', g: code, name: String(name).slice(0, 20), f: '', o: [] });
    this.unsub.push(this.r.on('m', (msg) => {
      if (!this.hostPeer || msg.peer !== this.hostPeer) return;
      this.me ||= this.myPeer();
      const d = msg.data;
      if (!d || d.g !== this.code || !Array.isArray(d.b)) return;
      for (const it of d.b) if (!it.to || it.to === this.me) { if (it.m && typeof it.m === 'object') this.onMsg(it.m); }
    }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No game with code ${code} is open right now.`)), 15000);
      this.unsub.push(this.r.onPeers((ch) => {
        this.me = this.myPeer() || this.me;
        const host = this.hostPeer ? ch.peers.find((p) => p.peer === this.hostPeer)
          : ch.peers.find((p) => !p.sameTab && p.presence?.r === 'h' && p.presence?.g === code);
        if (host) {
          if (!this.hostPeer) {
            this.hostPeer = host.peer;
            this.hostInfo = host.presence;
            clearTimeout(timer);
            this.watchDb(host.presence.db);
            resolve({ seed: host.presence.seed, hostName: host.presence.name });
          }
          if (host.peer === this.hostPeer) {
            this.lostAt = 0;
            const pr = host.presence;
            if (typeof pr.snap === 'string' && pr.snap && pr.snap !== this.lastSnap) { this.lastSnap = pr.snap; this.onFast(pr.snap); }
            const ack = pr.ack?.[this.me];
            if (typeof ack === 'number' && this.outbox.length && this.outbox[0][0] <= ack) {
              this.outbox = this.outbox.filter((it) => it[0] > ack);
              this.refill();
              this.outDirty = true;
            }
          }
        } else if (this.hostPeer && !this.lostAt) {
          // brief reconnects are normal; give the host a few seconds before calling it
          this.lostAt = performance.now();
          setTimeout(() => { if (this.lostAt && performance.now() - this.lostAt >= 7900) this.onLost('left'); }, 8000);
        }
      }));
    });
  }

  watchDb(slot) {
    const db = this.caps.db;
    if (!db || !slot) { this.onLost('nodb'); return; }
    for (const key of ['core', 'factions', 'bases', 'squads', 'npcs', 'chron']) {
      const ref = db.doc(`games/${slot}/sec/${key}`);
      this.unsub.push(ref.onSnapshot((snap) => {
        if (!snap.exists) return;
        const d = snap.data();
        if (d?.code === this.code && typeof d.d === 'string') this.onSection(key, d.d);
      }, (e) => console.warn('[net] db subscription ended', key, e?.code)));
    }
  }

  // client → host: everything rides this viewer's presence (works for view-only friends too)
  refill() {
    if (!this.pendingOut?.length) return;
    let size = jsonLen(this.outbox);
    while (this.pendingOut.length) {
      const item = [++this.seq, this.pendingOut[0]];
      const n = jsonLen(item) + 1;
      if (size + n > OUTBOX_BUDGET && this.outbox.length) { this.seq--; break; }
      if (n > OUTBOX_BUDGET) { this.seq--; this.pendingOut.shift(); continue; }
      this.outbox.push(item); size += n; this.pendingOut.shift();
    }
    this.outDirty = true;
  }
  fast(str) { this.myFast = str; this.fastDirty = true; }

  close() {
    this.closed = true;
    for (const u of this.unsub) { try { u(); } catch { /* */ } }
    this.unsub = [];
    if (this.isHost) this.caps.room?.presence({ dd: null }).catch(() => {});
    if (this.named) this.r?.leave().catch(() => {});
    else this.r?.presence({ r: null, g: null, f: null, o: null, snap: null, ack: null }).catch(() => {});
  }
}

// Open games advertised in the artifact lobby (calls back with [{code, host, day, n}])
export function watchLobby(room, cb) {
  if (!room) return () => {};
  const emit = (peers) => {
    const games = [];
    for (const p of peers) {
      const dd = p.presence?.dd;
      if (!dd || p.sameTab || typeof dd.code !== 'string') continue;
      games.push({ code: dd.code.slice(0, 8), host: String(dd.host || 'Someone').slice(0, 24), day: dd.day | 0, n: dd.n | 0, mine: p.isMe });
    }
    cb(games);
  };
  emit(room.peers());
  return room.onPeers((ch) => emit(ch.peers));
}
