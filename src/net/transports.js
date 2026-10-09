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
// Snapshots ride a truly unreliable channel opened on PeerJS's own connection (PeerJS's "reliable: false" still
// retransmits and will queue up to 8 MB). A snapshot is replaceable: when the link is backed up we skip one
// rather than queue stale state, so a slow upload or relay never turns into seconds of lag.
const FAST_CHANNEL = { negotiated: true, id: 77, ordered: false, maxRetransmits: 0 };
const BACKLOG = 16 * 1024;

function openFast(conn, onData) {
  try {
    const ch = conn.peerConnection.createDataChannel('dd-fast', FAST_CHANNEL);
    ch.onmessage = (e) => onData(e.data);
    return ch;
  } catch { return null; }
}
function sendFast(fastCh, ctl, str) {
  if (fastCh?.readyState === 'open') { if (fastCh.bufferedAmount < BACKLOG) fastCh.send(str); return true; }
  if (!ctl?.open || ctl.bufferSize || (ctl.dataChannel?.bufferedAmount || 0) > BACKLOG) return false;
  ctl.send(str);
  return true;
}
// 'direct' or 'relayed' (through a TURN server, which adds latency)
async function routeOf(conn) {
  try {
    const stats = await conn.peerConnection.getStats();
    let pair = null;
    stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
    if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    const local = pair && stats.get(pair.localCandidateId);
    return local ? (local.candidateType === 'relay' ? 'relayed' : 'direct') : null;
  } catch { return null; }
}

export class PeerTransport extends Base {
  constructor() { super(); this.kind = 'peer'; this.conns = new Map(); this.fastLimit = 8000; this.sectionsViaDb = false; }

  async openPeer(id) {
    const { default: Peer } = await import('peerjs');
    return new Promise((resolve, reject) => {
      // globalThis.DD_PEER_OPTIONS lets tests point PeerJS at a local signalling server
      const opts = { debug: 0, ...(globalThis.DD_PEER_OPTIONS || {}) };
      const peer = id ? new Peer(id, opts) : new Peer(opts);
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
      const pid = conn.peer;
      const onData = (d) => parseWire(d, (o) => this.onMsg(pid, o), (str) => this.onFast(pid, str));
      conn.on('open', () => {
        this.conns.set(pid, { ctl: conn, fastCh: openFast(conn, onData) });
        this.onJoin(pid, String(conn.metadata?.name || 'Friend').slice(0, 20));
      });
      conn.on('data', onData);
      conn.on('close', () => {
        const p = this.conns.get(pid);
        if (p?.ctl !== conn) return;
        this.conns.delete(pid);
        try { p.fastCh?.close(); } catch { /* */ }
        this.onLeave(pid);
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
      this.ctl = this.peer.connect(hostId, { reliable: true, serialization: 'raw', metadata: { name } });
      const onData = (d) => parseWire(d, (o) => this.onMsg(o), (str) => this.onFast(str));
      this.ctl.on('data', onData);
      this.ctl.on('error', () => {});
      this.ctl.on('open', () => { clearTimeout(timer); this.fastCh = openFast(this.ctl, onData); resolve(); });
      this.ctl.on('close', () => { if (!this.closed) this.onLost('closed'); });
    });
  }

  send(pid, obj) {
    if (obj === undefined) { obj = pid; pid = null; }
    const c = pid ? this.conns.get(pid)?.ctl : this.ctl;
    if (c?.open) c.send('J' + JSON.stringify(obj));
  }
  sendAll(obj) { const s = 'J' + JSON.stringify(obj); for (const p of this.conns.values()) if (p.ctl?.open) p.ctl.send(s); }
  fastTo(pid, str) { const p = this.conns.get(pid); return sendFast(p?.fastCh, p?.ctl, 'F' + str); }
  fast(str) { return sendFast(this.fastCh, this.ctl, 'F' + str); }
  async route(pid) { const c = pid ? this.conns.get(pid)?.ctl : this.ctl; return c ? routeOf(c) : null; }
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

const TERMINAL = new Set(['revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error']);
const GRACE_MS = 8000; // brief reconnects are normal on the platform: wait this long before calling someone gone

export class RoomTransport extends Base {
  constructor(caps) {
    super();
    this.kind = 'room';
    this.caps = caps;
    this.fastLimit = ROOM_FAST_LIMIT;
    this.sectionsViaDb = true;
    this.q = [];        // host: queued messages {to, m}
    this.flushT = 0;
    this.peerInfo = new Map(); // host: peer label -> { seq, fast, pres, goneAt }
    this.acks = new Map();
    this.outbox = [];   // client: [seq, msg]
    this.seq = 0;
    this.unsub = [];
    this.writing = {};  // db key -> in-flight
    this.dirty = {};
  }

  static roomName(code) { return 'dd-' + code.toLowerCase(); }

  // Join the game's named room (or share the lobby, tagged with the code, when named rooms are unavailable).
  // `preferLobby` follows the host's choice so both sides always end up in the same place.
  async enter(code, preferLobby = false) {
    const { room } = this.caps;
    if (!room) throw new Error('Co-op needs you to be signed in to claude.ai with access to this artifact.');
    this.code = code;
    this.named = false;
    this.r = room;
    if (preferLobby) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { this.r = await room.join(RoomTransport.roomName(code)); this.named = true; return; }
      catch (e) {
        if (TERMINAL.has(e?.code)) throw new Error('This artifact view cannot use co-op (sign in, and ask the owner to share it with you by email).');
        if (e?.code === 'not_permitted') break;
        await new Promise((r) => setTimeout(r, 1500)); // limit_reached / upstream_error: try once more
      }
    }
    this.r = room;
  }

  listen() {
    for (const u of this.unsub) { try { u(); } catch { /* */ } }
    this.unsub = [];
    const onErr = (e) => this.roomError(e);
    this.unsub.push(this.r.onPeers(() => this.syncPeers(), onErr));
    if (!this.isHost) this.unsub.push(this.r.on('m', (msg) => this.onEmit(msg), onErr));
  }

  roomError(e) {
    if (this.closed || this.recovering) return;
    if (TERMINAL.has(e?.code) || e?.code === 'not_permitted' || !this.named) { this.onLost(e?.code || 'room'); return; }
    // the platform could not put us back into the named room after a reconnect: join it again
    this.recovering = true;
    setTimeout(async () => {
      try { this.r = await this.caps.room.join(RoomTransport.roomName(this.code)); this.lastPeers = null; this.listen(); await this.r.presence(this.myPresence()); }
      catch (err) { this.onLost(err?.code || 'room'); }
      finally { this.recovering = false; }
    }, 1500);
  }

  myPresence() {
    return this.isHost ? { ...this.base, snap: this.snap || '', ack: [...this.acks] } : { r: 'c', g: this.code, name: this.name, f: this.myFast || '', o: this.outbox.slice() };
  }

  syncPeers() {
    if (!this.r || this.closed) return;
    let ps;
    try { ps = this.r.peers(); } catch { return; }
    if (ps === this.lastPeers) return; // the platform hands out the same frozen snapshot until something changes
    this.lastPeers = ps;
    if (this.isHost) this.hostPeers(ps); else this.clientPeers(ps);
  }

  // ---------- host ----------
  async host(code, info) {
    this.isHost = true;
    await this.enter(code);
    const { db, user } = this.caps;
    let uid = null;
    try { uid = await user?.id(); } catch { /* */ }
    const who = uid ? String(uid).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 60) : 'anon';
    this.slot = `h-${who}-${code.toLowerCase()}`;
    this.db = db;
    this.clearOldSlot();
    this.base = { r: 'h', g: code, seed: info.seed, db: db ? this.slot : null, name: String(info.name || 'Host').slice(0, 24) };
    this.listen();
    await this.r.presence(this.myPresence());
    this.advertise(info);
  }

  // one hosting session's documents replace the previous one's, so the store does not fill up with old games
  clearOldSlot() {
    let prev = null;
    try { prev = localStorage.getItem('dustbowl-net-slot'); localStorage.setItem('dustbowl-net-slot', this.slot); } catch { /* */ }
    if (!prev || prev === this.slot || !this.db) return;
    for (const k of ['core', 'factions', 'bases', 'squads', 'npcs', 'chron']) {
      try { this.db.doc(`games/${prev}/sec/${k}`).delete().catch(() => {}); } catch { /* bad path */ }
    }
  }

  advertise(info) {
    // the lobby lists open games so friends can pick one instead of typing a code
    const room = this.caps.room;
    const key = `${info.name}|${info.day}|${info.n}`;
    if (key === this.adKey || this.closed) return;
    this.adKey = key;
    room?.presence({ dd: { code: this.code, host: String(info.name || 'Host').slice(0, 24), day: info.day | 0, n: info.n | 0, lobby: !this.named } }).catch(() => {});
  }

  hostPeers(ps) {
    const here = new Set();
    for (const p of ps) {
      if (p.sameTab || p.kind !== 'viewer') continue;
      const pr = p.presence || {};
      if (pr.r !== 'c' || pr.g !== this.code) continue;
      here.add(p.peer);
      let info = this.peerInfo.get(p.peer);
      if (!info) { info = { seq: 0, fast: '', pres: null, goneAt: 0 }; this.peerInfo.set(p.peer, info); this.onJoin(p.peer, String(pr.name || 'Friend').slice(0, 20)); }
      info.goneAt = 0;
      if (info.pres === pr) continue; // unchanged presence is the same object
      info.pres = pr;
      if (typeof pr.f === 'string' && pr.f !== info.fast) { info.fast = pr.f; this.onFast(p.peer, pr.f); }
      if (Array.isArray(pr.o)) {
        for (const item of pr.o) {
          if (!Array.isArray(item) || typeof item[0] !== 'number' || item[0] <= info.seq) continue;
          info.seq = item[0];
          if (item[1] && typeof item[1] === 'object') this.onMsg(p.peer, item[1]);
        }
        if (this.acks.get(p.peer) !== info.seq) { this.acks.set(p.peer, info.seq); this.ackDirty = true; }
      }
    }
    const now = performance.now();
    for (const [pid, info] of this.peerInfo) if (!here.has(pid) && !info.goneAt) info.goneAt = now;
  }

  // friends missing for longer than the grace period have really left
  reapGone() {
    const now = performance.now();
    for (const [pid, info] of this.peerInfo) {
      if (!info.goneAt || now - info.goneAt < GRACE_MS) continue;
      this.peerInfo.delete(pid); this.acks.delete(pid); this.ackDirty = true;
      this.onLeave(pid);
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
    let ref;
    try { ref = this.db.doc(`games/${this.slot}/sec/${key}`); } catch (e) { console.warn('[net] bad db path', e); return; }
    ref.set({ code: this.code, d: json }).catch((e) => {
      console.warn('[net] db write failed', key, e?.code || e);
      if (this.dirty[key] === undefined) this.dirty[key] = json;
      return new Promise((r) => setTimeout(r, e?.code === 'resource_exhausted' ? 8000 : 2500));
    }).finally(() => { this.writing[key] = false; this.pump(key); });
  }

  update(dt) {
    if (!this.r || this.closed) return;
    this.syncPeers();
    // presence and emits share ~40 sends/s per page: keep presence to ~15/s and batch emits
    this.presT = (this.presT || 0) - dt;
    if (this.isHost) {
      this.reapGone();
      this.flushT -= dt;
      // while the room is reconnecting emits would be dropped: keep them queued
      if (this.flushT <= 0 && this.q.length && this.r.connected()) { this.flushT = FLUSH_EVERY; this.flushHost(); }
      if ((this.snapDirty || this.ackDirty) && this.presT <= 0) {
        this.presT = 1 / 15;
        this.snapDirty = false; this.ackDirty = false;
        this.r.presence({ snap: this.snap || '', ack: [...this.acks] }).catch(() => {});
      }
    } else {
      if (this.hostPeer && !this.lostAt && !this.findHost(this.lastPeers || [])) this.lostAt = performance.now();
      if (this.lostAt && performance.now() - this.lostAt > GRACE_MS) { this.lostAt = 0; this.onLost('left'); }
      if ((this.fastDirty || this.outDirty) && this.presT <= 0 && this.announced) {
        this.presT = 1 / 15;
        this.fastDirty = false; this.outDirty = false;
        this.r.presence({ f: this.myFast || '', o: this.outbox.slice() }).catch(() => {});
      }
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
  // Finds the host and reports its seed BEFORE announcing ourselves, so a friend whose world needs
  // regenerating (different seed) never shows up in the host's game twice.
  async join(code, name, seed) {
    this.isHost = false;
    this.name = String(name).slice(0, 20);
    const advert = (this.caps.room?.peers() || []).find((p) => p.presence?.dd?.code === code)?.presence.dd;
    await this.enter(code, !!advert?.lobby);
    this.listen();
    const host = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No game with code ${code} is open right now.`)), 15000);
      this.found = (h) => { clearTimeout(timer); resolve(h); };
      this.syncPeers();
    });
    const info = { seed: host.presence.seed, hostName: host.presence.name };
    if (seed !== undefined && info.seed !== seed) return info;
    this.announced = true;
    await this.r.presence(this.myPresence());
    // the room has no ordering between presence and events, so the welcome is built from the host's presence
    this.onMsg({ t: 'welcome', you: this.me, seed: info.seed, hostName: info.hostName });
    this.watchDb(host.presence.db);
    return info;
  }

  findHost(ps) {
    return this.hostPeer ? ps.find((p) => p.peer === this.hostPeer)
      : ps.find((p) => !p.sameTab && p.presence?.r === 'h' && p.presence?.g === this.code);
  }

  clientPeers(ps) {
    this.me = ps.find((p) => p.sameTab)?.peer || this.me;
    const host = this.findHost(ps);
    if (!host) return; // update() decides when a missing host has really gone
    this.lostAt = 0;
    if (!this.hostPeer) { this.hostPeer = host.peer; this.found?.(host); }
    const pr = host.presence;
    if (pr === this.hostPres) return;
    this.hostPres = pr;
    if (typeof pr.snap === 'string' && pr.snap && pr.snap !== this.lastSnap) { this.lastSnap = pr.snap; this.onFast(pr.snap); }
    const ack = Array.isArray(pr.ack) ? pr.ack.find((a) => Array.isArray(a) && a[0] === this.me)?.[1] : undefined;
    if (typeof ack === 'number' && this.outbox.length && this.outbox[0][0] <= ack) {
      this.outbox = this.outbox.filter((it) => it[0] > ack);
      this.refill();
      this.outDirty = true;
    }
  }

  onEmit(msg) {
    if (!this.hostPeer || msg.peer !== this.hostPeer) return;
    this.me ||= this.r.peers().find((p) => p.sameTab)?.peer;
    const d = msg.data;
    if (!d || d.g !== this.code || !Array.isArray(d.b)) return;
    for (const it of d.b) if (!it.to || it.to === this.me) { if (it.m && typeof it.m === 'object') this.onMsg(it.m); }
  }

  watchDb(slot) {
    const db = this.caps.db;
    if (!db || !slot) { this.onLost('nodb'); return; }
    for (const key of ['core', 'factions', 'bases', 'squads', 'npcs', 'chron']) {
      let ref;
      try { ref = db.doc(`games/${slot}/sec/${key}`); } catch { this.onLost('nodb'); return; }
      this.unsub.push(ref.onSnapshot((snap) => {
        if (!snap.exists) return;
        const d = snap.data();
        if (d?.code === this.code && typeof d.d === 'string') this.onSection(key, d.d);
      }, (e) => { console.warn('[net] db subscription ended', key, e?.code); if (TERMINAL.has(e?.code)) this.onLost('nodb'); }));
    }
  }

  // client → host: everything rides this viewer's presence (works for view-only friends too)
  refill() {
    if (!this.pendingOut?.length) return;
    let size = jsonLen(this.outbox);
    while (this.pendingOut.length) {
      const item = [this.seq + 1, this.pendingOut[0]];
      const n = jsonLen(item) + 1;
      if (n > OUTBOX_BUDGET) { this.pendingOut.shift(); console.warn('[net] dropped oversized message', item[1]?.t); continue; }
      if (size + n > OUTBOX_BUDGET && this.outbox.length) break;
      this.seq++;
      this.outbox.push(item); size += n; this.pendingOut.shift();
    }
    this.outDirty = true;
  }
  fast(str) { this.myFast = str; this.fastDirty = true; }

  close() {
    this.closed = true;
    for (const u of this.unsub) { try { u(); } catch { /* */ } }
    this.unsub = [];
    if (this.isHost) {
      this.caps.room?.presence({ dd: null }).catch(() => {});
      if (this.db && this.slot) for (const k of ['core', 'factions', 'bases', 'squads', 'npcs', 'chron']) this.db.doc(`games/${this.slot}/sec/${k}`).delete().catch(() => {});
    }
    if (this.named) this.r?.leave().catch(() => {});
    else this.r?.presence({ r: null, g: null, f: null, o: null, snap: null, ack: null, name: null, seed: null, db: null }).catch(() => {});
  }
}

// Open games advertised in the artifact lobby (calls back with [{code, host, day, n}], or null if the room is unusable here)
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
  return room.onPeers((ch) => emit(ch.peers), () => cb(null));
}
