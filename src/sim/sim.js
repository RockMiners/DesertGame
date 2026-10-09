// Strategic simulation: factions, NPCs, bases, squads, battles, economy and time.
// Pure logic (no DOM / three.js) so it runs headless in tests and on the multiplayer host.
import { RNG, clamp, hashStr } from '../core/math.js';
import { RESOURCES } from '../world/biomes.js';
import { TILE, BASE_SIZES, STRUCTS, DAY_LEN, HOUR, HUB_QUIET_R, dayOf, timeOfDay } from './defs.js';
import { HUB_SAFE_R } from './constants.js';
import { FACTION_DEFS, INITIAL_RELATIONS, INITIAL_ALLIANCES, INITIAL_WARS, HISTORY, START_YEAR, BANDITS, genDriverName, genBaseName, archetypeOf } from './lore.js';
import { initMarket, marketHour, recordPrices, marketSell, marketBuy, unitPrice, buyPrice } from './economy.js';
import { designStats, PRESET_DESIGNS, DEFAULT_DESIGN, CHASSIS } from '../vehicle/parts.js';

const COMBAT_CACHE = new Map();
// Abstract fighting numbers for a design: damage per second and hit points
export function designCombat(d) {
  const k = d ? `${d.chassis}|${d.engine}|${d.wheels}|${d.armor}|${(d.weapons || []).join(',')}|${(d.utils || []).join(',')}` : 'none';
  if (!COMBAT_CACHE.has(k)) {
    const st = d ? designStats(d) : null;
    COMBAT_CACHE.set(k, st ? { dps: Math.max(6, st.dps), hp: st.hp + (st.flags.shield ? 160 : 0) } : { dps: 10, hp: 200 });
  }
  return COMBAT_CACHE.get(k);
}
export function designStrength(d) { const c = designCombat(d); return Math.round(Math.sqrt(c.dps * c.hp) / 3); }
export const combatValue = (c) => c.dps * c.hp;

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class Sim {
  constructor(world) {
    this.world = world;
    this.listeners = {};
    this.s = null;
    this.rng = new RNG(1);
    this.acc = { sec: 0, hour: 0, ai: 0, battle: 0, story: 0 };
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const f of this.listeners[ev] || []) f(...a); }

  id(prefix) { return `${prefix}${(this.s.nextId++).toString(36)}`; }
  get day() { return dayOf(this.s.time); }
  get tod() { return timeOfDay(this.s.time); }
  get daylight() { const t = this.tod; return t > 0.27 && t < 0.77 ? 1 : 0; }
  zone(id) { return this.s.zones[id]; }
  zoneDef(id) { return this.world.zones.find((z) => z.id === id); }
  faction(id) { return this.s.factions[id]; }
  npc(id) { return this.s.npcs[id]; }
  base(id) { return this.s.bases[id]; }

  // ---------- New game ----------
  newGame(seed, opts = {}) {
    this.rng = new RNG(seed * 7919 + 13);
    const s = {
      v: 1, seed, time: 0, nextId: 1, year: START_YEAR,
      zones: {}, factions: {}, npcs: {}, bases: {}, squads: {}, missions: {}, chronicle: [],
      relations: {}, pacts: {}, market: initMarket(),
      story: { tension: 0.15, cooldowns: {}, fired: {}, arcs: [], eventCount: 0, nextEventAt: 60 * 4, procSeed: seed },
      group: {
        name: opts.groupName || 'The Drifters', factionId: null, rank: 0, rep: {}, wallet: 150, deeds: {}, epithets: [],
        designs: [{ ...DEFAULT_DESIGN, paint: opts.paint || DEFAULT_DESIGN.paint }], baseBlueprints: [],
        unlocked: { tier: 1, extra: [] }, kills: 0, betrayals: 0, missionsDone: 0, bounty: 0, joinedDay: 0, offers: [],
      },
      players: {},
      terrainEdits: [],
      recruitPool: [],
      lastDawn: 0,
      stats: { battles: 0, basesDestroyed: 0, betrayals: 0, coups: 0 },
    };
    this.s = s;
    for (const z of this.world.zones) s.zones[z.id] = { id: z.id, owner: null, claimable: z.biome !== 'hub', unrest: 0 };
    for (const def of FACTION_DEFS) this.createFaction(def, { premade: true });
    for (const [a, b, v] of INITIAL_RELATIONS) this.setRel(a, b, v);
    for (const [a, b, name] of INITIAL_ALLIANCES) this.setPact(a, b, 'alliance', name, true);
    for (const [a, b] of INITIAL_WARS) this.setPact(a, b, 'war', null, true);
    // territories & bases
    for (const zd of this.world.zones) {
      if (!zd.owner) continue;
      const f = s.factions[zd.owner];
      const isHome = f.home === zd.id;
      const nb = isHome ? 2 : 1;
      const sites = this.world.sites.filter((x) => x.zoneId === zd.id);
      for (let i = 0; i < nb && i < sites.length; i++) {
        const level = isHome && i === 0 ? clamp(Math.ceil(f.def.strength / 3.5), 1, 3) : f.def.strength >= 6 ? 2 : 1;
        this.createBase(f.id, sites[i], level, { auto: true, capital: isHome && i === 0 });
      }
    }
    // populate members
    for (const f of Object.values(s.factions)) {
      const n = 4 + f.def.strength * 3;
      for (let i = 0; i < n; i++) this.createNpc(f.id, i < 2 ? 'lieutenant' : 'driver');
      this.redistributeGarrison(f.id);
      this.ensureBeds(f.id);
    }
    // scavver camps in wild zones
    for (const zd of this.world.zones) if (!zd.owner && zd.biome !== 'hub') this.spawnScavCamp(zd.id);
    // history
    for (const h of HISTORY) s.chronicle.push({ id: this.id('h'), year: h.year, day: 0, title: h.title, text: h.text, tags: ['history'], importance: 2 });
    this.refreshRecruits();
    this.updateZoneOwnership();
    for (let i = 0; i < 8; i++) recordPrices(s.market);
    this._boardT = 0;
    for (let i = 0; i < 3; i++) { this._boardT = 0; this.refreshBoard?.(); }
    return s;
  }

  createFaction(def, opts = {}) {
    const s = this.s;
    const id = def.id || this.id('pf');
    const f = {
      id, name: def.name, short: def.short || def.name, color: def.color, accent: def.accent, motto: def.motto || '', lore: def.lore || '',
      quotes: def.quotes || [], carStyle: def.carStyle || 'scrappy', home: def.home || null, archetype: archetypeOf(def.leader.traits),
      traits: { ...def.leader.traits }, leaderId: null, treasury: opts.treasury ?? (def.strength || 3) * 160, alive: true,
      isPlayer: !!opts.isPlayer, founded: opts.premade ? -1 : this.day, warWeariness: 0, grudges: {}, goal: null, goalSince: 0,
      prod: {}, def: { strength: def.strength || 3 }, premade: !!opts.premade, procedural: !!opts.procedural,
      aiTimer: this.rng.range(5, 25), lastAttack: -999, lastExpand: -999, kills: 0, losses: 0, zonesLost: 0,
    };
    s.factions[id] = f;
    for (const o of Object.values(s.factions)) if (o.id !== id && !this.hasRel(id, o.id)) this.setRel(id, o.id, opts.premade ? 0 : this.rng.int(-20, 10));
    f.leaderTitle = def.leader.title || null;
    if (!opts.isPlayer) {
      const leader = this.createNpc(id, 'leader', { name: def.leader.name, title: def.leader.title, traits: def.leader.traits, skill: 0.85 });
      f.leaderId = leader.id;
    }
    return f;
  }

  // ---------- Relations ----------
  hasRel(a, b) { return pairKey(a, b) in this.s.relations; }
  rel(a, b) { if (a === b) return 100; return this.s.relations[pairKey(a, b)] ?? 0; }
  setRel(a, b, v) { this.s.relations[pairKey(a, b)] = clamp(Math.round(v), -100, 100); }
  addRel(a, b, d) { this.setRel(a, b, this.rel(a, b) + d); }
  pact(a, b) { return this.s.pacts[pairKey(a, b)]?.type || null; }
  pactInfo(a, b) { return this.s.pacts[pairKey(a, b)] || null; }
  setPact(a, b, type, name = null, silent = false) {
    const k = pairKey(a, b);
    if (!type) delete this.s.pacts[k];
    else this.s.pacts[k] = { type, name, since: this.s.time };
    if (type === 'war') { this.setRel(a, b, Math.min(this.rel(a, b), -60)); }
    if (type === 'alliance') { this.setRel(a, b, Math.max(this.rel(a, b), 40)); }
    if (!silent) this.emit('pact', a, b, type);
  }
  allies(fid) { return Object.values(this.s.factions).filter((f) => f.alive && f.id !== fid && this.pact(fid, f.id) === 'alliance'); }
  enemies(fid) { return Object.values(this.s.factions).filter((f) => f.alive && f.id !== fid && this.pact(fid, f.id) === 'war'); }
  atWar(a, b) { return this.pact(a, b) === 'war'; }

  groupTeam() { return this.s.group.factionId || 'drifter'; }

  // Hostility between car teams (used by physical combat)
  hostileTeams(a, b) {
    if (a === b) return false;
    if (a === 'scavvers' || b === 'scavvers') return true;
    if (a === 'drifter' || b === 'drifter') {
      const other = a === 'drifter' ? b : a;
      const rep = this.s.group.rep[other] ?? 0;
      return rep <= -35 || this.s.group.bounty > 0 && this.faction(other)?.huntingPlayer;
    }
    const fa = this.s.factions[a], fb = this.s.factions[b];
    if (!fa || !fb) return false;
    if (fa.isPlayer || fb.isPlayer) {
      const other = fa.isPlayer ? fb : fa;
      if (this.atWar(a, b)) return true;
      const rep = this.s.group.rep[other.id] ?? 0;
      return rep <= -35;
    }
    return this.atWar(a, b) || this.rel(a, b) <= -75;
  }

  // ---------- NPCs ----------
  styleDesign(f, heavy) {
    const style = f ? f.carStyle : 'scav';
    const key = heavy ? `${style}Heavy` : style;
    const d = PRESET_DESIGNS[key] || PRESET_DESIGNS[style] || PRESET_DESIGNS.scrappy;
    return { ...JSON.parse(JSON.stringify(d)), paint: f ? f.color : '#7d7a75', paint2: f ? f.accent : '#4a4646' };
  }

  createNpc(fid, role = 'driver', o = {}) {
    const f = this.s.factions[fid];
    const rng = this.rng;
    const id = this.id('n');
    const heavy = role === 'lieutenant' ? rng.chance(0.6) : role === 'leader' ? true : rng.chance(f ? f.def.strength / 30 : 0.05);
    const n = {
      id, name: o.name || genDriverName(rng), title: o.title || null, factionId: fid, role,
      skill: o.skill ?? clamp(rng.range(0.25, 0.75) + (role === 'lieutenant' ? 0.15 : 0), 0.1, 0.95),
      courage: rng.range(0.25, 0.95), greed: rng.range(0.1, 0.9), loyaltyTrait: rng.range(0.25, 0.95),
      loyalty: rng.int(55, 90), wage: o.wage ?? rng.int(4, 10), design: o.design || this.styleDesign(f, heavy),
      hp: 1, alive: true, baseId: null, squadId: null, xp: 0, kills: 0, unpaid: 0, joined: this.s ? this.day : 0,
      traits: o.traits || null, epithet: null, portrait: hashStr(id + (o.name || '')),
    };
    if (role === 'leader') n.loyalty = 100;
    this.s.npcs[id] = n;
    return n;
  }

  members(fid) { return Object.values(this.s.npcs).filter((n) => n.alive && n.factionId === fid); }
  npcStrength(n) { return designStrength(n.design) * (0.6 + n.skill * 0.8) * Math.max(0.2, n.hp); }
  npcCombat(n, zoneId) {
    const c = designCombat(n.design);
    const tm = zoneId ? this.terrainMod(n, zoneId) : 1;
    return { dps: c.dps * (0.25 + 0.35 * n.skill) * tm, hp: c.hp * Math.max(0.05, n.hp) * (0.85 + 0.15 * tm) };
  }
  groupCombat(list, zoneId, mult = 1) {
    let dps = 0, hp = 0;
    for (const n of list) { if (!n?.alive) continue; const c = this.npcCombat(n, zoneId); dps += c.dps; hp += c.hp; }
    return { dps: dps * mult, hp };
  }
  baseCombat(b, withGarrison = true) {
    const site = this.siteDefenseMod(b);
    let dps = 0, hp = 0;
    for (const st of b.structs) {
      const d = STRUCTS[st.type];
      const frac = st.hp / d.hp;
      if (d.dps) { dps += d.dps * (0.4 + 0.6 * frac); hp += st.hp; }
      else if (st.type === 'hq' || st.type === 'wall') hp += st.hp;
      else hp += st.hp * 0.4;
    }
    if (withGarrison) { const g = this.groupCombat(this.garrison(b), b.zoneId, 1.15); dps += g.dps; hp += g.hp; }
    const cap = b.capital ? 1.35 : 1; // capitals have bunkers, reserves and stubborn defenders
    return { dps: dps * site * cap, hp: hp * Math.sqrt(site) * cap };
  }

  killNpc(n, cause = {}) {
    if (!n || !n.alive) return;
    n.alive = false;
    n.hp = 0;
    const f = this.s.factions[n.factionId];
    if (n.squadId) { const sq = this.s.squads[n.squadId]; if (sq) sq.members = sq.members.filter((m) => m !== n.id); }
    if (f) f.losses++;
    this.emit('npcDied', n, cause);
    if (f && f.leaderId === n.id) this.leaderDied(f, cause);
  }

  leaderDied(f, cause) {
    const heirs = this.members(f.id).filter((m) => m.role === 'lieutenant').sort((a, b) => b.skill + b.xp * 0.01 - (a.skill + a.xp * 0.01));
    const heir = heirs[0] || this.members(f.id)[0];
    const old = this.leaderName(f);
    if (!heir) { this.collapseFaction(f, cause); return; }
    this.crownLeader(f, heir);
    this.chronicle('succession', { f, old, heir, cause });
  }

  crownLeader(f, n) {
    n.role = 'leader';
    n.loyalty = 100;
    n.title = f.leaderTitle || n.title || this.rng.pick(['Boss', 'Chief', 'Warlord', 'Captain', 'Queen', 'Marshal', 'Big', 'Duke']);
    if (!n.traits) {
      const t = {};
      for (const k of ['aggression', 'greed', 'honor', 'caution', 'ambition', 'cunning', 'zeal', 'paranoia']) t[k] = clamp((f.traits[k] ?? 0.5) * 0.4 + this.rng.next() * 0.6, 0, 1);
      n.traits = t;
    }
    f.traits = { ...n.traits };
    f.archetype = archetypeOf(f.traits);
    f.leaderId = n.id;
  }

  leaderName(f) {
    if (!f) return 'Nobody';
    if (f.isPlayer) return this.s.group.leaderName || 'You';
    const n = this.s.npcs[f.leaderId];
    return n ? `${n.title ? n.title + ' ' : ''}${n.name}` : f.name;
  }

  collapseFaction(f, cause = {}) {
    if (!f.alive) return;
    f.alive = false;
    f.diedAt = this.s.time;
    for (const b of Object.values(this.s.bases)) if (b.factionId === f.id) this.destroyBase(b, cause, true);
    for (const n of this.members(f.id)) {
      // survivors scatter: some join the recruit pool, the rest become scavvers
      n.factionId = null; n.baseId = null; n.squadId = null;
      if (this.rng.chance(0.3)) this.s.recruitPool.push(n.id); else n.alive = false;
    }
    for (const k of Object.keys(this.s.pacts)) if (k.split('|').includes(f.id)) delete this.s.pacts[k];
    this.chronicle('collapse', { f, cause });
    this.updateZoneOwnership();
  }

  // ---------- Bases ----------
  createBase(fid, site, level, opts = {}) {
    const s = this.s;
    const id = this.id('b');
    const size = BASE_SIZES[level];
    const T = this.world.terrain;
    const h = opts.y ?? T.heightAt(site.x, site.z);
    const b = {
      id, name: opts.name || this.uniqueBaseName(), factionId: fid, zoneId: site.zoneId || T.zoneAt(site.x, site.z).id,
      x: Math.round(site.x), z: Math.round(site.z), y: +h.toFixed(2), level, size, structs: [], storage: {}, blocked: [],
      built: this.day, capital: !!opts.capital, alarm: 0, lastAttacked: -999, buildQueue: [], carQueue: [], scav: fid === 'scavvers',
      physical: false, routes: [],
    };
    s.bases[id] = b;
    if (opts.auto) {
      // AI bases level the whole compound for a tidy look
      this.terrainEdit(b.x, b.z, (size * TILE) / 2 + 2, (size * TILE) / 2 + 2, b.y);
      this.autoLayout(b, opts);
      for (const st of b.structs) st.hp = STRUCTS[st.type].hp;
      const f = s.factions[fid];
      b.storage = { scrap: 60, fuel: 40, ammo: 60, water: 30, food: 30 };
      if (f && opts.capital) for (const r of RESOURCES) b.storage[r] = (b.storage[r] || 0) + 40;
    } else {
      this.computeBlocked(b);
    }
    this.updateZoneOwnership();
    return b;
  }

  uniqueBaseName() {
    const used = new Set(Object.values(this.s.bases).map((b) => b.name));
    for (let i = 0; i < 20; i++) { const n = genBaseName(this.rng); if (!used.has(n)) return n; }
    return `${genBaseName(this.rng)} ${this.rng.int(2, 9)}`;
  }

  terrainEdit(cx, cz, hw, hd, target) {
    this.s.terrainEdits.push([Math.round(cx * 10) / 10, Math.round(cz * 10) / 10, hw, hd, +target.toFixed(2)]);
    this.world.terrain.flatten(cx, cz, hw, hd, target);
    this.emit('terrainEdit', cx, cz, hw, hd, target);
  }

  tileWorld(b, tx, tz, w = 1, d = 1) {
    const half = b.size / 2;
    return { x: b.x + (tx + w / 2 - half) * TILE, z: b.z + (tz + d / 2 - half) * TILE };
  }
  structWorld(b, st) { const def = STRUCTS[st.type]; return this.tileWorld(b, st.tx, st.tz, def.w, def.d); }

  computeBlocked(b) {
    const T = this.world.terrain;
    b.blocked = [];
    for (let tz = 0; tz < b.size; tz++) for (let tx = 0; tx < b.size; tx++) {
      const p = this.tileWorld(b, tx, tz);
      let dev = 0;
      for (const [ox, oz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5], [0, 0]]) dev = Math.max(dev, Math.abs(T.heightAt(p.x + ox, p.z + oz) - b.y));
      if (dev > 1.6 || T.liquidAt(p.x, p.z) || !T.inBounds(p.x, p.z)) b.blocked.push(tz * b.size + tx);
    }
  }

  occupied(b) {
    const occ = new Set(b.blocked);
    for (const st of b.structs) {
      const def = STRUCTS[st.type];
      for (let i = 0; i < def.w; i++) for (let j = 0; j < def.d; j++) occ.add((st.tz + j) * b.size + st.tx + i);
    }
    return occ;
  }

  canPlace(b, type, tx, tz, occ = this.occupied(b)) {
    const def = STRUCTS[type];
    if (tx < 0 || tz < 0 || tx + def.w > b.size || tz + def.d > b.size) return false;
    for (let i = 0; i < def.w; i++) for (let j = 0; j < def.d; j++) if (occ.has((tz + j) * b.size + tx + i)) return false;
    return true;
  }

  findSpot(b, type, prefer = 'inner', occ = this.occupied(b)) {
    const def = STRUCTS[type];
    const c = (b.size - def.w) / 2;
    const cands = [];
    for (let tz = 0; tz <= b.size - def.d; tz++) for (let tx = 0; tx <= b.size - def.w; tx++) {
      if (!this.canPlace(b, type, tx, tz, occ)) continue;
      const d = Math.hypot(tx - c, tz - c);
      const edge = Math.min(tx, tz, b.size - def.w - tx, b.size - def.d - tz);
      const score = prefer === 'edge' ? edge * 3 - d * 0.1 : prefer === 'corner' ? -d : d;
      cands.push([score + this.rng.next() * 0.5, tx, tz]);
    }
    cands.sort((a, b2) => a[0] - b2[0]);
    if (prefer === 'corner') cands.sort((a, b2) => a[0] - b2[0]);
    return cands.length ? { tx: cands[0][1], tz: cands[0][2] } : null;
  }

  addStruct(b, type, tx, tz, hp) {
    const st = { id: this.id('s'), type, tx, tz, hp: hp ?? STRUCTS[type].hp };
    b.structs.push(st);
    return st;
  }

  autoLayout(b, opts) {
    const zd = this.zoneDef(b.zoneId);
    const f = this.s.factions[b.factionId];
    const c = Math.floor(b.size / 2) - 1;
    this.addStruct(b, 'hq', c, c);
    const rich = Object.entries(zd.richness || {}).sort((a, b2) => b2[1] - a[1]);
    const prodFor = (res) => res === 'fuel' ? 'pump' : res === 'water' ? 'well' : res === 'food' ? 'farm' : res === 'chems' ? 'extractor' : 'mine';
    const plan = [];
    if (b.scav) {
      plan.push('shack', 'shack', 'turret', 'turret', 'wall', 'wall', 'wall');
    } else {
      const lvl = b.level;
      plan.push('shack', 'shack');
      if (rich[0]) plan.push(prodFor(rich[0][0]));
      if (rich[1] && rich[1][1] > 0.3) plan.push(prodFor(rich[1][0]));
      plan.push('turret', 'turret');
      if (lvl >= 2) plan.push('bunkhouse', 'garage', 'solar', 'depot', 'market', 'turret', 'cannonT', rich[0] ? prodFor(rich[0][0]) : 'mine', 'well');
      if (lvl >= 3) plan.push('bunkhouse', 'ammo', 'radio', 'generator', 'cannonT', 'turret', f?.carStyle === 'tech' ? 'laserT' : 'cannonT', 'autorig');
      if (f?.carStyle === 'solar') plan.push('solar', 'farm');
      if (f?.carStyle === 'heavy') plan.push('wall', 'wall', 'cannonT');
    }
    const occ = this.occupied(b);
    for (const type of plan) {
      const def = STRUCTS[type];
      const prefer = def.weapon || type === 'wall' ? 'edge' : 'inner';
      const spot = this.findSpot(b, type, prefer, occ);
      if (!spot) continue;
      this.addStruct(b, type, spot.tx, spot.tz);
      for (let i = 0; i < def.w; i++) for (let j = 0; j < def.d; j++) occ.add((spot.tz + j) * b.size + spot.tx + i);
    }
  }

  baseBeds(b) { return b.structs.reduce((s, st) => s + (STRUCTS[st.type].beds || 0), 0); }
  baseStorageCap(b) { return b.structs.reduce((s, st) => s + (STRUCTS[st.type].storage || 0), 0) || 200; }
  baseDefense(b) {
    let d = 0;
    for (const st of b.structs) if (STRUCTS[st.type].defense && st.hp > 0) d += STRUCTS[st.type].defense * (0.4 + 0.6 * st.hp / STRUCTS[st.type].hp);
    return d * this.siteDefenseMod(b);
  }
  siteDefenseMod(b) {
    const zd = this.zoneDef(b.zoneId);
    const T = this.world.terrain;
    let mod = { canyon: 1.35, crystal: 1.2, ashlands: 1.2, ruins: 1.15, saltflats: 0.85, glass: 0.9, dunes: 1.0 }[zd.biome] ?? 1;
    // high ground bonus
    let lower = 0;
    for (let a = 0; a < 8; a++) { const ang = (a / 8) * Math.PI * 2; if (T.heightAt(b.x + Math.cos(ang) * 90, b.z + Math.sin(ang) * 90) < b.y - 4) lower++; }
    mod *= 1 + lower * 0.04;
    return mod;
  }
  garrison(b) { return Object.values(this.s.npcs).filter((n) => n.alive && n.baseId === b.id && !n.squadId); }
  factionBases(fid) { return Object.values(this.s.bases).filter((b) => b.factionId === fid); }
  capital(fid) { const bs = this.factionBases(fid); return bs.find((b) => b.capital) || bs[0] || null; }

  redistributeGarrison(fid) {
    const bases = this.factionBases(fid);
    if (!bases.length) return;
    const free = this.members(fid).filter((n) => !n.squadId);
    const cap = this.capital(fid);
    free.forEach((n, i) => {
      if (n.role === 'leader' && cap) n.baseId = cap.id; // leaders hold court at the capital
      else if (!n.baseId || !this.s.bases[n.baseId]) n.baseId = bases[i % bases.length].id;
    });
  }

  ensureBeds(fid) {
    for (const b of this.factionBases(fid)) {
      const need = Object.values(this.s.npcs).filter((n) => n.alive && n.baseId === b.id).length;
      let beds = this.baseBeds(b);
      let guard = 0;
      while (beds < need && guard++ < 10) {
        const type = need - beds > 5 ? 'bunkhouse' : 'shack';
        const spot = this.findSpot(b, type, 'inner');
        if (!spot) break;
        this.addStruct(b, type, spot.tx, spot.tz);
        beds = this.baseBeds(b);
      }
    }
  }

  damageStructure(b, st, amt, attackerTeam) {
    if (!st || st.hp <= 0) return;
    st.hp -= amt;
    b.lastAttacked = this.s.time;
    b.alarm = 30;
    if (attackerTeam) b.lastAttacker = attackerTeam;
    if (st.hp <= 0) {
      st.hp = 0;
      b.structs = b.structs.filter((x) => x !== st);
      this.emit('structDestroyed', b, st, attackerTeam);
      if (st.type === 'hq') this.destroyBase(b, { team: attackerTeam });
    }
  }

  destroyBase(b, cause = {}, silent = false) {
    if (!this.s.bases[b.id]) return;
    delete this.s.bases[b.id];
    const f = this.s.factions[b.factionId];
    // survivors move to another base or die
    for (const n of Object.values(this.s.npcs)) if (n.baseId === b.id) {
      const other = this.factionBases(b.factionId)[0];
      const survives = other && (n.role === 'leader' || this.rng.chance(0.6));
      if (survives) n.baseId = other.id; else if (!n.squadId) this.killNpc(n, { base: b.id });
      else n.baseId = other ? other.id : null;
    }
    this.s.stats.basesDestroyed++;
    this.updateZoneOwnership();
    this.emit('baseDestroyed', b, cause);
    if (!silent && !b.scav) this.chronicle('baseFell', { b, f, by: cause.team ? this.s.factions[cause.team] : null, byGroup: cause.team === this.groupTeam() });
    if (f && !f.isPlayer && f.alive && !this.factionBases(f.id).length && f.id !== 'scavvers') {
      // a faction with no bases is broken
      if (this.rng.chance(0.5) || this.members(f.id).length < 6) this.collapseFaction(f, cause);
      else this.chronicle('exiled', { f });
    }
    this.updateZoneOwnership();
  }

  updateZoneOwnership() {
    const s = this.s;
    for (const z of Object.values(s.zones)) {
      const zd = this.zoneDef(z.id);
      if (zd.biome === 'hub') { z.owner = null; z.claimable = false; continue; }
      const owners = {};
      for (const b of Object.values(s.bases)) if (b.zoneId === z.id && !b.scav) owners[b.factionId] = (owners[b.factionId] || 0) + b.level + (b.capital ? 2 : 0);
      const best = Object.entries(owners).sort((a, b) => b[1] - a[1])[0];
      const prev = z.owner;
      z.owner = best ? best[0] : null;
      z.claimable = !z.owner;
      if (prev !== z.owner) this.emit('zoneOwner', z, prev, z.owner);
    }
  }

  // ---------- Squads ----------
  createSquad(fid, memberIds, task, opts = {}) {
    const s = this.s;
    const id = this.id('q');
    const from = opts.from || (memberIds[0] && this.s.bases[this.s.npcs[memberIds[0]]?.baseId]) || this.capital(fid);
    const sq = {
      id, factionId: fid, members: [...memberIds], x: opts.x ?? from?.x ?? 0, z: opts.z ?? from?.z ?? 0,
      tx: opts.x ?? from?.x ?? 0, tz: opts.z ?? from?.z ?? 0, task, state: 'moving', cargo: opts.cargo || {},
      homeBaseId: from?.id || null, physical: false, created: s.time, name: opts.name || null, startPower: 0, wait: opts.wait || 0,
      missionId: opts.missionId || null, battleT: 0, retreating: false, speed: opts.speed || 13,
    };
    for (const m of sq.members) { const n = s.npcs[m]; if (n) n.squadId = id; }
    sq.startPower = this.squadPower(sq);
    sq.startValue = combatValue(this.groupCombat(sq.members.map((m) => s.npcs[m])));
    // warbands burn petrol and ammo from their home base
    const fac = s.factions[fid];
    if (from && fac && !fac.isPlayer && !fac.bandit && from.storage) {
      this.takeStorage(from, 'fuel', 2 * sq.members.length);
      if (task.type === 'attack' || task.type === 'raidBase') this.takeStorage(from, 'ammo', 5 * sq.members.length);
    }
    s.squads[id] = sq;
    this.setSquadDest(sq);
    this.emit('squadCreated', sq);
    return sq;
  }

  setSquadDest(sq) {
    const t = sq.task;
    if (t.type === 'attack' || t.type === 'reinforce' || t.type === 'claim' || t.type === 'convoy' || t.type === 'raidBase') {
      const b = this.s.bases[t.targetBaseId || t.destBaseId];
      if (b) { sq.tx = b.x; sq.tz = b.z; return; }
      if (t.site) { sq.tx = t.site.x; sq.tz = t.site.z; return; }
      if (t.x !== undefined) { sq.tx = t.x; sq.tz = t.z; return; }
    }
    if (t.type === 'trade') { sq.tx = 0; sq.tz = 0; return; }
    if (t.x !== undefined) { sq.tx = t.x; sq.tz = t.z; }
  }

  squadPower(sq) { return sq.members.reduce((s, m) => s + (this.s.npcs[m]?.alive ? this.npcStrength(this.s.npcs[m]) : 0), 0); }

  disbandSquad(sq, toBase = null) {
    for (const m of sq.members) {
      const n = this.s.npcs[m];
      if (!n) continue;
      n.squadId = null;
      if (toBase) n.baseId = toBase.id;
    }
    // deliver cargo
    if (toBase) for (const [r, v] of Object.entries(sq.cargo)) this.addStorage(toBase, r, v);
    delete this.s.squads[sq.id];
    this.emit('squadRemoved', sq);
  }

  addStorage(b, res, n) {
    const cap = this.baseStorageCap(b);
    const used = Object.values(b.storage).reduce((s, v) => s + v, 0);
    const add = Math.max(0, Math.min(n, cap - used));
    b.storage[res] = (b.storage[res] || 0) + add;
    return add;
  }
  takeStorage(b, res, n) {
    const t = Math.min(n, b.storage[res] || 0);
    b.storage[res] = (b.storage[res] || 0) - t;
    return t;
  }
  factionStock(fid) {
    const out = {};
    for (const b of this.factionBases(fid)) for (const [r, v] of Object.entries(b.storage)) out[r] = (out[r] || 0) + v;
    return out;
  }
  // spend from any base(s) of faction; returns true if paid
  factionPay(fid, cost, prefer = null) {
    const bases = this.factionBases(fid);
    if (prefer) bases.sort((a, b) => (b.id === prefer.id) - (a.id === prefer.id));
    const stock = this.factionStock(fid);
    for (const [r, v] of Object.entries(cost)) if ((stock[r] || 0) < v) return false;
    for (const [r, v] of Object.entries(cost)) {
      let left = v;
      for (const b of bases) { left -= this.takeStorage(b, r, left); if (left <= 0) break; }
    }
    return true;
  }

  // ---------- Tick ----------
  tick(dt) {
    const s = this.s;
    if (!s) return;
    s.time += dt;
    this.acc.sec += dt; this.acc.hour += dt; this.acc.ai += dt; this.acc.battle += dt; this.acc.story += dt;
    if (this.acc.sec >= 0.5) { this.moveSquads(this.acc.sec); this.acc.sec = 0; }
    if (this.acc.battle >= 2) { this.battles(this.acc.battle); this.acc.battle = 0; }
    if (this.acc.hour >= HOUR) { this.acc.hour -= HOUR; this.hourly(); }
    if (this.acc.ai >= 1) { this.factionAI?.(this.acc.ai); this.acc.ai = 0; }
    if (this.acc.story >= 1) { this.storyTick?.(this.acc.story); this.missionTick?.(this.acc.story); this.acc.story = 0; }
    const d = this.day;
    if (d !== s.lastDawn && this.tod > 0.27) { s.lastDawn = d; this.dawn(); }
  }

  moveSquads(dt) {
    const s = this.s;
    for (const sq of Object.values(s.squads)) {
      sq.members = sq.members.filter((m) => s.npcs[m]?.alive);
      if (!sq.members.length) { this.squadWiped(sq); continue; }
      if (sq.wait > 0) { sq.wait -= dt; continue; }
      if (sq.physical) continue; // the game drives physical squads
      const dx = sq.tx - sq.x, dz = sq.tz - sq.z;
      const d = Math.hypot(dx, dz);
      // caravans stop at the Hub walls rather than parking in the middle of town
      const arriveR = sq.task.type === 'attack' || sq.task.type === 'raidBase' ? 70 : sq.task.type === 'trade' && !sq.retreating ? HUB_SAFE_R + 15 : 25;
      if (d > arriveR) {
        const step = Math.min(d, sq.speed * dt * (sq.state === 'returning' ? 1.1 : 1));
        sq.x += (dx / d) * step; sq.z += (dz / d) * step;
        sq.state = sq.retreating ? 'returning' : sq.state === 'fighting' ? 'moving' : sq.state;
      } else this.squadArrived(sq);
    }
  }

  squadArrived(sq) {
    const t = sq.task;
    const s = this.s;
    if (sq.retreating || sq.state === 'returning') {
      const home = s.bases[sq.homeBaseId] || this.capital(sq.factionId);
      this.disbandSquad(sq, home);
      return;
    }
    switch (t.type) {
      case 'attack': case 'raidBase': {
        const b = s.bases[t.targetBaseId];
        if (!b || b.factionId === sq.factionId) { this.squadReturn(sq); return; }
        sq.state = 'fighting';
        b.siegedBy = sq.id;
        break;
      }
      case 'claim': {
        const z = s.zones[t.zoneId];
        const f = s.factions[sq.factionId];
        if (z && z.claimable && f?.alive) {
          const site = t.site;
          const b = this.createBase(sq.factionId, site, 1, { auto: true });
          this.disbandSquad(sq, b);
          this.ensureBeds(sq.factionId);
          this.chronicle('claim', { f, z: this.zoneDef(z.id), b });
        } else this.squadReturn(sq);
        break;
      }
      case 'convoy': case 'reinforce': {
        const b = s.bases[t.destBaseId];
        if (b && b.factionId === sq.factionId) {
          if (t.type === 'reinforce') this.disbandSquad(sq, b);
          else { for (const [r, v] of Object.entries(sq.cargo)) this.addStorage(b, r, v); sq.cargo = {}; this.emit('convoyArrived', sq, b); this.squadReturn(sq); }
        } else this.squadReturn(sq);
        break;
      }
      case 'trade': {
        const f = s.factions[sq.factionId];
        let caps = 0;
        for (const [r, v] of Object.entries(sq.cargo)) caps += marketSell(s.market, r, v);
        sq.cargo = {};
        if (f) f.treasury += caps;
        const m = s.missions[sq.missionId];
        if (m?.obj.kind === 'escortSquad') m.obj.arrived = true;
        this.emit('caravanSold', sq, caps);
        this.squadReturn(sq);
        break;
      }
      case 'patrol': case 'scavenge': case 'roam': {
        sq.legs = (sq.legs || 0) + 1;
        if (t.type === 'scavenge') {
          const zd = this.zoneDef(t.zoneId);
          const rich = Object.entries(zd?.richness || { scrap: 1 });
          for (const m of sq.members) { const pick = this.rng.weighted(rich, ([, v]) => v); if (pick) sq.cargo[pick[0]] = (sq.cargo[pick[0]] || 0) + Math.round(this.rng.range(4, 10) * pick[1]); }
        }
        if (sq.legs >= (t.legs || 4)) { this.squadReturn(sq); return; }
        const zd = this.zoneDef(t.zoneId);
        if (zd) {
          // next leg stays inside the zone; patrols with a post circle it, scavvers keep clear of the Hub
          const post = t.type === 'patrol' && t.x !== undefined;
          const p = this.zonePoint(zd.id, post ? t.x : zd.cx, post ? t.z : zd.cz, post ? 30 : 40, post ? 150 : 260, sq.factionId === 'scavvers' ? HUB_QUIET_R : 0, sq);
          sq.tx = p.x; sq.tz = p.z;
        }
        break;
      }
      case 'escort': break;
      case 'hunt': {
        // hunters wander toward the latest known player position
        sq.legs = (sq.legs || 0) + 1;
        if (sq.legs > 6) this.squadReturn(sq);
        break;
      }
      default: this.squadReturn(sq);
    }
  }

  squadReturn(sq) {
    const home = this.s.bases[sq.homeBaseId] || this.capital(sq.factionId);
    if (!home) { // nowhere to go: they become drifters
      for (const m of sq.members) { const n = this.s.npcs[m]; if (n) { n.squadId = null; } }
      delete this.s.squads[sq.id];
      this.emit('squadRemoved', sq);
      return;
    }
    sq.state = 'returning';
    sq.retreating = true;
    sq.tx = home.x; sq.tz = home.z;
    sq.homeBaseId = home.id;
  }

  squadWiped(sq) {
    delete this.s.squads[sq.id];
    this.emit('squadRemoved', sq);
    this.emit('squadWiped', sq);
  }

  // Abstract battles between squads and bases / squads that are not near any player
  battles(dt) {
    const s = this.s;
    const squads = Object.values(s.squads);
    for (const sq of squads) {
      if (sq.physical || sq.state !== 'fighting') continue;
      const b = s.bases[sq.task.targetBaseId];
      if (!b) { this.squadReturn(sq); continue; }
      if (b.physical) continue;
      this.siegeRound(sq, b, dt);
    }
    // squad vs squad skirmishes
    for (let i = 0; i < squads.length; i++) {
      const A = squads[i];
      if (!s.squads[A.id] || A.physical) continue;
      for (let j = i + 1; j < squads.length; j++) {
        const B = squads[j];
        if (!s.squads[B.id] || B.physical) continue;
        if (Math.hypot(A.x - B.x, A.z - B.z) > 60) continue;
        if (!this.hostileTeams(A.factionId, B.factionId)) continue;
        this.skirmishRound(A, B, dt);
      }
    }
  }

  terrainMod(npc, zoneId) {
    const zd = this.zoneDef(zoneId);
    const w = npc.design?.wheels || 'standard';
    const surface = { dunes: 'sand', saltflats: 'salt', canyon: 'rock', oilfield: 'tar', toxic: 'mud', ruins: 'concrete', oasis: 'grass', ashlands: 'ash', crystal: 'crystal', glass: 'glass', hub: 'packed' }[zd?.biome] || 'packed';
    const table = { offroad: { sand: 1.15, mud: 1.15 }, slicks: { sand: 0.75, mud: 0.7, salt: 1.2, concrete: 1.15 }, tracks: { rock: 1.25, ash: 1.15, sand: 1.1 }, hover: { mud: 1.25, glass: 1.1, tar: 1.2 } };
    let m = table[w]?.[surface] ?? 1;
    const ch = CHASSIS[npc.design?.chassis];
    if (ch && ch.size > 2 && (surface === 'sand' || surface === 'rock')) m *= 0.85; // big rigs struggle in dunes & canyons
    return m;
  }

  siegeRound(sq, b, dt) {
    const s = this.s, rng = this.rng;
    const att = sq.members.map((m) => s.npcs[m]).filter((n) => n?.alive);
    const def = this.garrison(b);
    const leaderBonus = att.some((n) => n.role === 'lieutenant' || n.role === 'leader') ? 1.15 : 1;
    const A = this.groupCombat(att, b.zoneId, leaderBonus);
    const D = this.baseCombat(b);
    const K = 0.2 * dt;
    // attackers hit garrison and structures (turrets first)
    let dmg = A.dps * K * rng.range(0.8, 1.2);
    // leaders stay in the bunker until the HQ is nearly gone
    const hq = b.structs.find((x) => x.type === 'hq');
    const lastStand = !hq || hq.hp < STRUCTS.hq.hp * 0.25;
    const exposed = def.filter((n) => n.role !== 'leader' || lastStand);
    if (exposed.length) { const part = dmg * 0.4; this.hurtNpcDmg(rng.pick(exposed), part, { team: sq.factionId }); dmg -= part; }
    const turrets = b.structs.filter((st) => STRUCTS[st.type].dps);
    for (let i = 0; i < 4 && dmg > 0.5 && s.bases[b.id]; i++) {
      const pool = turrets.filter((t) => t.hp > 0);
      const st = pool.length && rng.chance(0.6) ? rng.pick(pool) : rng.pick(b.structs);
      if (!st) break;
      const d = Math.min(dmg, st.hp);
      this.damageStructure(b, st, d, sq.factionId);
      dmg -= d;
    }
    // defenders shoot back
    const dd = D.dps * K * rng.range(0.8, 1.2);
    if (att.length) { this.hurtNpcDmg(rng.pick(att), dd * 0.6, { team: b.factionId, base: b.id }); this.hurtNpcDmg(rng.pick(att), dd * 0.4, { team: b.factionId, base: b.id }); }
    b.alarm = 30;
    b.lastAttacked = s.time;
    b.lastAttacker = sq.factionId;
    sq.battleT += dt;
    if (!s.bases[b.id]) { this.siegeWon(sq, b); return; }
    const now = combatValue(this.groupCombat(att.filter((n) => n.alive), b.zoneId));
    const f = s.factions[sq.factionId];
    const caution = f?.traits?.caution ?? 0.5;
    if (now < (sq.startValue || 1) * (0.18 + caution * 0.2) || sq.battleT > 360) {
      if (b.capital || sq.members.length > 3) this.chronicle('siegeFailed', { sq, b, f, def: s.factions[b.factionId] });
      this.squadReturn(sq);
    }
  }

  siegeWon(sq, b) {
    const f = this.s.factions[sq.factionId];
    this.emit('siegeWon', sq, b);
    // claim the zone if possible
    const z = this.s.zones[b.zoneId];
    const protectedRing = this.zoneDef(b.zoneId).ring === 1 && this.day < 7; // leave the inner ring for the player early on
    if (f && z.claimable && sq.task.claimAfter !== false && !f.isPlayer && !protectedRing) {
      const site = { x: b.x, z: b.z, zoneId: b.zoneId };
      const nb = this.createBase(f.id, site, 1, { auto: true, y: b.y });
      this.disbandSquad(sq, nb);
      this.ensureBeds(f.id);
      this.chronicle('claim', { f, z: this.zoneDef(z.id), b: nb, conquest: true });
    } else this.squadReturn(sq);
  }

  skirmishRound(A, B, dt) {
    const s = this.s, rng = this.rng;
    const a = A.members.map((m) => s.npcs[m]).filter((n) => n?.alive), bb = B.members.map((m) => s.npcs[m]).filter((n) => n?.alive);
    if (!a.length || !bb.length) return;
    const zid = this.world.terrain.zoneAt(A.x, A.z).id;
    const ca = this.groupCombat(a, zid), cb = this.groupCombat(bb, zid);
    const K = 0.25 * dt;
    this.hurtNpcDmg(rng.pick(bb), ca.dps * K * rng.range(0.7, 1.3), { team: A.factionId });
    this.hurtNpcDmg(rng.pick(a), cb.dps * K * rng.range(0.7, 1.3), { team: B.factionId });
    A.state = 'fighting'; B.state = 'fighting';
    // loser flees; convoys drop cargo to the raiders
    for (const [X, Y, list] of [[A, B, a], [B, A, bb]]) {
      const now = combatValue(this.groupCombat(list.filter((n) => n.alive), zid));
      if (now < (X.startValue || 1) * 0.3 && !X.retreating) {
        if (Object.keys(X.cargo).length) { for (const [r, v] of Object.entries(X.cargo)) Y.cargo[r] = (Y.cargo[r] || 0) + Math.round(v * 0.7); X.cargo = {}; this.emit('convoyRaided', X, Y); }
        this.squadReturn(X);
      }
    }
  }

  hurtNpcDmg(n, dmg, cause) {
    if (!n) return;
    this.hurtNpc(n, dmg / designCombat(n.design).hp, cause);
  }

  hurtNpc(n, frac, cause) {
    if (!n || !n.alive) return;
    n.hp -= frac;
    if (n.hp <= 0) {
      // sometimes they bail out and walk home
      if (n.role !== 'leader' && this.rng.chance(0.25)) { n.hp = 0.3; if (n.squadId) { const sq = this.s.squads[n.squadId]; if (sq) sq.members = sq.members.filter((m) => m !== n.id); n.squadId = null; } }
      else this.killNpc(n, cause);
      const killerF = this.s.factions[cause.team];
      if (killerF) killerF.kills++;
    }
  }

  // ---------- Economy: hourly ----------
  hourly() {
    const s = this.s;
    const daylight = this.daylight;
    const prodTotals = {};
    for (const f of Object.values(s.factions)) f.prod = {};
    for (const b of Object.values(s.bases)) {
      const f = s.factions[b.factionId];
      const zd = this.zoneDef(b.zoneId);
      let powerGen = 0, powerUse = 0;
      for (const st of b.structs) {
        const d = STRUCTS[st.type];
        if (!d.power) continue;
        if (d.power > 0) {
          if (d.solar) powerGen += daylight ? d.power : 0;
          else if (d.consumes?.fuel) { if (this.takeStorage(b, 'fuel', d.consumes.fuel) >= d.consumes.fuel * 0.99) powerGen += d.power; }
          else powerGen += d.power;
        } else powerUse += -d.power;
      }
      const powerRatio = powerUse > 0 ? Math.min(1, powerGen / powerUse) : 1;
      let workers = this.garrison(b).length;
      const occ = new Map();
      for (const st of b.structs) { const d = STRUCTS[st.type]; for (let i = 0; i < d.w; i++) for (let j = 0; j < d.d; j++) occ.set((st.tz + j) * b.size + st.tx + i, st); }
      const rigs = b.structs.filter((st) => st.type === 'autorig');
      const automated = (st) => rigs.some((r) => { const d = STRUCTS[st.type]; return r.tx >= st.tx - 1 && r.tx <= st.tx + d.w && r.tz >= st.tz - 1 && r.tz <= st.tz + d.d; });
      b.lastProd = {};
      for (const st of b.structs) {
        const d = STRUCTS[st.type];
        if (!d.produces) continue;
        let eff = 1;
        if (d.workers) {
          if (automated(st) && powerRatio > 0.5) eff = 1;
          else { const got = Math.min(workers, d.workers); workers -= got; eff = got / d.workers; }
        }
        if (d.power && d.power < 0) eff *= powerRatio;
        if (eff <= 0) continue;
        if (d.consumes) for (const [r, v] of Object.entries(d.consumes)) { if (r === 'fuel' && d.power > 0) continue; const got = this.takeStorage(b, r, v * eff); eff = Math.min(eff, got / v); }
        const out = d.produces === 'minerals' ? this.mineralsFor(zd) : d.produces;
        for (const [r, v] of Object.entries(out)) {
          const richness = d.produces === 'minerals' ? 1 : (zd.richness[r] ?? 0.15) + 0.25;
          const amt = v * eff * Math.min(2, richness) * (b.scav ? 0.3 : 1);
          const added = this.addStorage(b, r, amt);
          b.lastProd[r] = (b.lastProd[r] || 0) + amt;
          if (f) f.prod[r] = (f.prod[r] || 0) + amt;
          prodTotals[r] = (prodTotals[r] || 0) + amt;
          void added;
        }
      }
      b.power = { gen: powerGen, use: powerUse };
      if (b.alarm > 0) b.alarm = Math.max(0, b.alarm - 1);
    }
    s.prodTotals = prodTotals;
    marketHour(s.market, this.rng, this.marketMods());
    recordPrices(s.market);
    this.processRoutes?.();
    // build queues progress
    for (const b of Object.values(s.bases)) {
      if (b.carQueue.length) {
        const job = b.carQueue[0];
        job.progress += 1 / (designStats(job.design).buildTime * 1.5);
        if (job.progress >= 1) { b.carQueue.shift(); this.carBuilt(b, job); }
      }
    }
  }

  mineralsFor(zd) {
    const r = zd.richness || {};
    const out = {};
    for (const k of ['scrap', 'crystal', 'electronics']) if (r[k]) out[k] = 3.2 * r[k];
    if (!Object.keys(out).length) out.scrap = 1.5;
    return out;
  }

  marketMods() { return this.s.story.marketMods || {}; }

  carBuilt(b, job) {
    const n = this.s.npcs[job.npcId];
    if (n && n.alive) {
      n.design = JSON.parse(JSON.stringify(job.design));
      n.hp = 1;
      this.emit('carBuilt', b, n, job);
    }
  }

  // ---------- Dawn: wages, food, loyalty, recruits ----------
  dawn() {
    const s = this.s;
    for (const f of Object.values(s.factions)) {
      if (!f.alive) continue;
      const mem = this.members(f.id);
      // food & water from storage, AI buys shortfalls
      for (const res of ['food', 'water']) {
        let need = mem.length * 0.6;
        for (const b of this.factionBases(f.id)) need -= this.takeStorage(b, res, need);
        if (need > 0.5) {
          if (!f.isPlayer) {
            const { n, caps } = marketBuy(s.market, res, Math.ceil(need));
            if (caps <= f.treasury) { f.treasury -= caps; need -= n; } else s.market.stock[res] += n;
          }
          if (need > 0.5) for (const m of mem) m.loyalty -= 4 * (need / Math.max(1, mem.length));
        }
      }
      // wages
      if (!f.isPlayer && !f.bandit) {
        // territory taxes: every zone held pays tolls from the traders crossing it
        const zones = Object.values(s.zones).filter((z) => z.owner === f.id).length;
        f.treasury += 20 + zones * 30 + this.factionBases(f.id).length * 8;
        const wages = mem.reduce((t, n) => t + (n.role === 'leader' ? 0 : n.wage * 0.3), 0);
        if (f.treasury >= wages) { f.treasury -= wages; for (const m of mem) { m.unpaid = 0; m.loyalty = Math.min(100, m.loyalty + 2); } }
        else for (const m of mem) { m.unpaid++; m.loyalty -= 3; }
      }
      // beds
      for (const b of this.factionBases(f.id)) {
        const residents = Object.values(s.npcs).filter((n) => n.alive && n.baseId === b.id).length;
        if (residents > this.baseBeds(b)) for (const n of Object.values(s.npcs)) if (n.alive && n.baseId === b.id) n.loyalty -= 3;
      }
      f.warWeariness = Math.max(0, f.warWeariness - 2);
    }
    // the player's own faction: wages from the group wallet
    // base upkeep: patching walls and roofs eats scrap
    for (const b of Object.values(s.bases)) { if (b.factionId !== s.group.factionId) this.takeStorage(b, 'scrap', b.structs.length * 0.6); }
    this.pruneDead();
    this.payGroupWages?.();
    this.loyaltyChecks?.();
    this.refreshRecruits();
    this.respawnScavs();
    this.emit('dawn', this.day);
  }

  pruneDead() {
    const s = this.s;
    const keep = new Set();
    for (const m of Object.values(s.missions)) if (m.obj?.npcId) keep.add(m.obj.npcId);
    for (const f of Object.values(s.factions)) if (f.leaderId) keep.add(f.leaderId);
    for (const [id, n] of Object.entries(s.npcs)) if (!n.alive && !keep.has(id)) delete s.npcs[id];
  }

  refreshRecruits() {
    const s = this.s;
    s.recruitPool = s.recruitPool.filter((id) => s.npcs[id]?.alive && !s.npcs[id].factionId);
    const want = 4 + Object.values(s.bases).filter((b) => b.factionId === s.group.factionId && b.structs.some((st) => st.type === 'radio')).length * 2;
    while (s.recruitPool.length < want) {
      const n = this.createNpc(null, 'recruit', { design: { ...PRESET_DESIGNS.scrappy, paint: '#a0a0a0', paint2: '#555' } });
      n.factionId = null;
      n.wage = Math.round(4 + n.skill * 10 + this.rng.range(0, 3));
      n.signing = Math.round(15 + n.skill * 60);
      s.recruitPool.push(n.id);
    }
    if (s.recruitPool.length > want + 3) s.recruitPool.splice(0, s.recruitPool.length - want - 3);
  }

  // ---------- Scavvers ----------
  ensureScavFaction() {
    if (!this.s.factions.scavvers) {
      const f = this.createFaction({ ...BANDITS, strength: 1, leader: { name: 'Nobody', title: '', traits: { aggression: 0.8, greed: 0.8, honor: 0, caution: 0.3, ambition: 0.1, cunning: 0.2, zeal: 0, paranoia: 0 } }, carStyle: 'scav' }, { treasury: 0 });
      f.bandit = true;
    }
    return this.s.factions.scavvers;
  }

  spawnScavCamp(zoneId) {
    this.ensureScavFaction();
    // camps take the free site farthest from the Hub so the roads near town stay quiet
    const sites = this.world.sites.filter((x) => x.zoneId === zoneId).sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z));
    const used = new Set(Object.values(this.s.bases).map((b) => `${b.x},${b.z}`));
    const site = sites.find((x) => !used.has(`${Math.round(x.x)},${Math.round(x.z)}`));
    if (!site) return null;
    const b = this.createBase('scavvers', site, 1, { auto: true, name: `${this.rng.pick(['Scav', 'Junk', 'Rust', 'Dirt'])} ${this.rng.pick(['Camp', 'Nest', 'Hole', 'Pile'])}` });
    for (let i = 0; i < 3; i++) { const n = this.createNpc('scavvers', 'driver', { design: { ...PRESET_DESIGNS.scav }, skill: this.rng.range(0.15, 0.4) }); n.baseId = b.id; }
    return b;
  }

  scavRoamers() { return Object.values(this.s.squads).filter((q) => q.factionId === 'scavvers' && q.task.type === 'roam').length; }
  scavRoamCap() { return Math.min(4, 2 + Math.floor(this.day / 8)); }

  // Where a scavver gang shows up: around one of the zone's camps (else its centre), never near the Hub
  scavSpot(zoneId) {
    const zd = this.zoneDef(zoneId);
    const camps = Object.values(this.s.bases).filter((b) => b.scav && b.zoneId === zoneId);
    const camp = camps.length ? this.rng.pick(camps) : null;
    const p = camp ? this.zonePoint(zoneId, camp.x, camp.z, 40, 140, HUB_QUIET_R) : this.zonePoint(zoneId, zd.cx, zd.cz, 0, 220, HUB_QUIET_R);
    return { ...p, camp };
  }

  // Random point near (cx, cz) inside the zone, at least minHub from the Hub centre (and, given a squad,
  // reachable from where it is without cutting through that ring)
  zonePoint(zoneId, cx, cz, rMin, rMax, minHub = 0, from = null) {
    const T = this.world.terrain;
    for (let i = 0; i < 16; i++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(rMin, rMax);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!T.inBounds(x, z) || (zoneId && T.zoneAt(x, z).id !== zoneId)) continue;
      if (minHub && (Math.hypot(x, z) < minHub || (from && segDist0(from.x, from.z, x, z) < minHub * 0.9))) continue;
      return { x, z };
    }
    const d = Math.hypot(cx, cz);
    if (minHub && d < minHub) { const k = (minHub + 40) / Math.max(1, d); return { x: cx * k, z: cz * k }; }
    return { x: cx, z: cz };
  }

  respawnScavs() {
    const s = this.s;
    const wild = this.world.zones.filter((z) => z.biome !== 'hub' && s.zones[z.id].claimable);
    if (this.scavRoamers() < this.scavRoamCap() && wild.length) {
      // gangs ride out of an existing camp when there is one
      const camped = wild.filter((z) => Object.values(s.bases).some((b) => b.scav && b.zoneId === z.id));
      const zd = this.rng.pick(camped.length ? camped : wild);
      const ids = [];
      const n = this.rng.int(2, 3 + Math.min(2, Math.floor(this.day / 5)));
      for (let i = 0; i < n; i++) ids.push(this.createNpc('scavvers', 'driver', { design: this.rng.chance(0.2) ? { ...PRESET_DESIGNS.raider } : { ...PRESET_DESIGNS.scav }, skill: this.rng.range(0.15, 0.45) }).id);
      const p = this.scavSpot(zd.id);
      this.createSquad('scavvers', ids, { type: 'roam', zoneId: zd.id, legs: 8 }, { x: p.x, z: p.z, from: p.camp, speed: 11 });
    }
    // camps regrow in empty wild zones every few days
    if (this.day % 3 === 0) for (const zd of wild) {
      const has = Object.values(s.bases).some((b) => b.zoneId === zd.id);
      if (!has && this.rng.chance(0.4)) this.spawnScavCamp(zd.id);
    }
  }

  // ---------- Chronicle ----------
  chronicle(kind, ctx) {
    const entry = this.writeChronicle ? this.writeChronicle(kind, ctx) : null;
    if (!entry) return null;
    entry.id = this.id('c');
    entry.day = this.day;
    entry.year = this.s.year;
    entry.kind = kind;
    entry.text = entry.text.replace(/\b([Tt])he The\b/g, 'The');
    entry.title = entry.title.replace(/\b([Tt])he The\b/g, 'The');
    if (entry.importance <= 0 && !entry.tags.includes('player')) { this.emit('news', entry); return entry; }
    this.s.chronicle.push(entry);
    if (this.s.chronicle.length > 400) this.s.chronicle.splice(HISTORY.length, 1);
    this.emit('chronicle', entry);
    return entry;
  }

  // ---------- Serialization ----------
  serialize() { return JSON.parse(JSON.stringify(this.s)); }
  load(state) {
    this.s = state;
    this.rng = new RNG((state.seed * 7919 + Math.floor(state.time)) >>> 0);
  }
}

// distance from the origin (the Hub) to the segment a-b
function segDist0(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(-(ax * dx + az * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(ax + dx * t, az + dz * t);
}

export { STRUCTS, TILE, DAY_LEN, HOUR, unitPrice, buyPrice, marketSell, marketBuy };
