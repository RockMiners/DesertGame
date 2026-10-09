// Faction AI: economy, expansion, war planning, market motives, diplomacy. Personality-driven.
import { Sim, combatValue } from './sim.js';
import { DAY_LEN } from './defs.js';
import { STRUCTS, BASE_SIZES, TILE } from './defs.js';
import { RESOURCES } from '../world/biomes.js';
import { marketBuy, priceTrend, unitPrice } from './economy.js';
import { clamp } from '../core/math.js';

const P = Sim.prototype;

P.factionAI = function (dt) {
  const s = this.s;
  for (const f of Object.values(s.factions)) {
    if (!f.alive || f.isPlayer || f.bandit) continue;
    f.aiTimer -= dt;
    if (f.aiTimer > 0) continue;
    f.aiTimer = this.rng.range(18, 32) * (1.2 - (f.traits.ambition || 0.5) * 0.4);
    try { this.factionThink(f); } catch (e) { console.error('AI error', f.id, e); }
  }
  // scavvers: occasionally raid weak convoys / camps nearby
};

P.factionPower = function (fid) {
  let p = 0;
  for (const n of this.members(fid)) p += this.npcStrength(n);
  for (const b of this.factionBases(fid)) { const c = this.baseCombat(b, false); p += Math.sqrt(c.dps * c.hp) / 3 * 0.6; }
  return p;
};

P.availableFighters = function (f, base = null) {
  const list = [];
  for (const n of this.members(f.id)) {
    if (n.squadId || n.role === 'leader' || n.hp < 0.6) continue;
    if (base && n.baseId !== base.id) continue;
    list.push(n);
  }
  // keep a home guard at each base
  const byBase = {};
  for (const n of list) (byBase[n.baseId] ||= []).push(n);
  const out = [];
  for (const [bid, arr] of Object.entries(byBase)) {
    const b = this.s.bases[bid];
    const keep = b && (b.capital ? 3 : 2) + (b.alarm > 0 ? 2 : 0);
    arr.sort((a, b2) => this.npcStrength(b2) - this.npcStrength(a));
    out.push(...arr.slice(0, Math.max(0, arr.length - keep)));
  }
  return out;
};

P.factionZones = function (fid) { return Object.values(this.s.zones).filter((z) => z.owner === fid).map((z) => z.id); };

P.borderZones = function (fid) {
  const mine = new Set(this.factionZones(fid));
  const out = new Set();
  for (const zid of mine) for (const nb of this.zoneDef(zid).neighbors) if (!mine.has(nb)) out.add(nb);
  return [...out];
};

P.factionThink = function (f) {
  const s = this.s;
  const T = f.traits;
  const bases = this.factionBases(f.id);
  if (!bases.length) { this.exileThink(f); return; }
  const stock = this.factionStock(f.id);
  const myPower = this.factionPower(f.id);
  f.powerCache = myPower;

  // 1. Economy: sell surplus, buy essentials, build, recruit
  this.aiBuild(f, bases, stock);
  this.aiRecruit(f, bases);
  this.aiCaravans(f, bases, stock);

  // 2. Defend besieged bases
  for (const b of bases) {
    if (b.siegedBy && s.squads[b.siegedBy] && s.squads[b.siegedBy].state === 'fighting') {
      const others = bases.filter((x) => x !== b);
      for (const o of others) {
        const helpers = this.availableFighters(f, o).slice(0, 3);
        if (helpers.length >= 2 && !Object.values(s.squads).some((q) => q.factionId === f.id && q.task.type === 'reinforce' && q.task.destBaseId === b.id)) {
          this.createSquad(f.id, helpers.map((n) => n.id), { type: 'reinforce', destBaseId: b.id }, { from: o });
          break;
        }
      }
    } else if (b.siegedBy && !s.squads[b.siegedBy]) b.siegedBy = null;
  }

  // 3. War planning
  const ops = Object.values(s.squads).filter((q) => ['attack', 'claim', 'raidBase'].includes(q.task.type) && aiTraffic(s, q));
  const activeOps = ops.filter((q) => q.factionId === f.id).length;
  const opsCap = 1 + (T.ambition + T.aggression > 1.4 ? 1 : 0);
  if (activeOps < opsCap && ops.length < MAX_OPS) {
    const choice = this.chooseOperation(f, myPower, stock);
    if (choice) this.launchOperation(f, choice);
  }

  // 4. Diplomacy every few thinks
  f.dipTimer = (f.dipTimer || 0) - 1;
  if (f.dipTimer <= 0) { f.dipTimer = this.rng.int(2, 4); this.aiDiplomacy(f, myPower); }
};

P.exileThink = function (f) {
  // a faction with no bases tries to grab any claimable zone
  const s = this.s;
  const claimable = this.world.zones.filter((z) => s.zones[z.id].claimable && z.biome !== 'hub');
  const fighters = this.members(f.id).filter((n) => !n.squadId);
  if (!claimable.length || fighters.length < 2) { if (this.rng.chance(0.15)) this.collapseFaction(f, { exile: true }); return; }
  const z = this.rng.pick(claimable);
  const site = this.freeSite(z.id);
  if (!site) return;
  this.createSquad(f.id, fighters.slice(0, 6).map((n) => n.id), { type: 'claim', zoneId: z.id, site }, { x: z.cx + 300, z: z.cz });
};

P.freeSite = function (zoneId) {
  const used = Object.values(this.s.bases);
  return this.world.sites.find((x) => x.zoneId === zoneId && used.every((b) => Math.hypot(b.x - x.x, b.z - x.z) > 110)) || null;
};

P.aiBuild = function (f, bases, stock) {
  const rng = this.rng;
  // beds first
  this.ensureBeds(f.id);
  // pay for something useful at a random base
  const b = rng.pick(bases);
  const zd = this.zoneDef(b.zoneId);
  const has = (t) => b.structs.filter((st) => st.type === t).length;
  const wishes = [];
  const threatened = b.alarm > 0 || b.lastAttacked > this.s.time - 600;
  if (has('turret') + has('cannonT') + has('laserT') < 2 + b.level * 2 || threatened) wishes.push(rng.chance(0.4) ? 'cannonT' : 'turret');
  const best = Object.entries(zd.richness).sort((a, c) => c[1] - a[1])[0];
  if (best) {
    const t = best[0] === 'fuel' ? 'pump' : best[0] === 'water' ? 'well' : best[0] === 'food' ? 'farm' : best[0] === 'chems' ? 'extractor' : 'mine';
    if (has(t) < b.level + 1) wishes.push(t);
  }
  if (!has('garage') && b.level >= 2) wishes.push('garage');
  if (!has('solar') && f.carStyle !== 'heavy') wishes.push('solar');
  if ((stock.ammo || 0) < 60 && !has('ammo') && b.level >= 2) wishes.push('ammo');
  if (has('wall') < b.level * 2 && f.traits.caution > 0.5) wishes.push('wall');
  for (const t of wishes) {
    const def = STRUCTS[t];
    if (def.tier && def.tier > 2 && f.carStyle !== 'tech') continue;
    if (!this.factionAffords(f, def.cost)) continue;
    const spot = this.findSpot(b, t, def.weapon || t === 'wall' ? 'edge' : 'inner');
    if (!spot) { this.aiUpgradeBase(f, b); break; }
    this.factionPayOrBuy(f, def.cost, b);
    this.addStruct(b, t, spot.tx, spot.tz);
    this.emit('structBuilt', b, t);
    break;
  }
  // grow: new outposts inside own zones
  const maxBases = 2 + this.factionZones(f.id).length;
  if (rng.chance(0.08 * f.traits.ambition) && f.treasury > 300 && bases.length < maxBases && this.s.time - (f.lastOutpost || -1e9) > DAY_LEN * 2) {
    for (const zid of this.factionZones(f.id)) {
      const count = bases.filter((x) => x.zoneId === zid).length;
      if (count >= 3) continue;
      const site = this.freeSite(zid);
      if (!site) continue;
      if (!this.factionAffords(f, { scrap: 120 })) break;
      this.factionPayOrBuy(f, { scrap: 120 }, b);
      const nb = this.createBase(f.id, site, 1, { auto: true });
      const movers = this.members(f.id).filter((n) => !n.squadId && n.role !== 'leader').slice(0, 3);
      for (const m of movers) m.baseId = nb.id;
      this.ensureBeds(f.id);
      this.chronicle('outpost', { f, b: nb, z: this.zoneDef(zid) });
      f.lastOutpost = this.s.time;
      break;
    }
  }
};

P.aiUpgradeBase = function (f, b) {
  if (b.level >= 3 || f.treasury < 300) return;
  const cost = { scrap: 150 * b.level };
  if (!this.factionAffords(f, cost)) return;
  this.factionPayOrBuy(f, cost, b);
  this.upgradeBase(b, true);
};

P.upgradeBase = function (b, auto = false) {
  const old = b.size;
  b.level++;
  b.size = BASE_SIZES[b.level];
  const off = (b.size - old) / 2;
  for (const st of b.structs) { st.tx += off; st.tz += off; }
  if (auto) this.terrainEdit(b.x, b.z, (b.size * TILE) / 2 + 2, (b.size * TILE) / 2 + 2, b.y);
  this.computeBlockedKeep(b);
  this.emit('baseUpgraded', b);
};

P.computeBlockedKeep = function (b) {
  const occ = new Set();
  for (const st of b.structs) { const d = STRUCTS[st.type]; for (let i = 0; i < d.w; i++) for (let j = 0; j < d.d; j++) occ.add((st.tz + j) * b.size + st.tx + i); }
  this.computeBlocked(b);
  b.blocked = b.blocked.filter((t) => !occ.has(t));
};

P.factionAffords = function (f, cost) {
  const stock = this.factionStock(f.id);
  let caps = 0;
  for (const [r, v] of Object.entries(cost)) { const short = v - (stock[r] || 0); if (short > 0) caps += short * unitPrice(this.s.market, r) * 1.15; }
  return caps <= f.treasury * 0.6;
};

P.factionPayOrBuy = function (f, cost, prefer) {
  const stock = this.factionStock(f.id);
  for (const [r, v] of Object.entries(cost)) {
    const short = v - (stock[r] || 0);
    if (short > 0) {
      const { n, caps } = marketBuy(this.s.market, r, Math.ceil(short));
      f.treasury -= caps;
      this.addStorage(prefer, r, n);
    }
  }
  this.factionPay(f.id, cost, prefer);
};

P.aiRecruit = function (f, bases) {
  const beds = bases.reduce((t, b) => t + this.baseBeds(b), 0);
  const mem = this.members(f.id).length;
  const cap = Math.min(beds + 2, 10 + f.def.strength * 5 + this.factionZones(f.id).length * 3);
  if (mem < cap && f.treasury > 120 + mem * 3) {
    const n = this.createNpc(f.id, this.rng.chance(0.1) ? 'lieutenant' : 'driver');
    const b = this.rng.pick(bases);
    n.baseId = b.id;
    f.treasury -= 45;
  }
  // refit: rich factions upgrade a member to a heavy rig
  if (f.treasury > 500 && this.rng.chance(0.3)) {
    const n = this.rng.pick(this.members(f.id).filter((m) => !m.squadId && m.role !== 'leader'));
    if (n) { n.design = this.styleDesign(f, true); f.treasury -= 120; }
  }
};

// World-wide limits keep the roads readable: a few purposeful convoys rather than a stream of lone trucks
const MAX_TRADE = 3, MAX_CONVOY = 3, MAX_OPS = 4;
// the world-wide caps keep AI traffic down; the player's own routes and mission squads don't use them up
const aiTraffic = (s, q) => !s.factions[q.factionId]?.isPlayer && !q.missionId;

P.aiCaravans = function (f, bases, stock) {
  const s = this.s;
  const all = Object.values(s.squads);
  const cap = this.capital(f.id);
  if (!cap) return;
  // stagger each faction's first runs so the roads don't fill up all at once on day one
  f.nextConvoy ??= s.time + DAY_LEN * this.rng.range(0.1, 0.8);
  f.nextTrade ??= s.time + DAY_LEN * this.rng.range(0.1, 1.2);
  // crew: the truck plus at least one escort, unless the faction is too small to spare anyone
  const crewFrom = (b, n) => {
    const crew = this.availableFighters(f, b).slice(0, n);
    return crew.length >= 2 || (crew.length && this.members(f.id).length < 4) ? crew : null;
  };
  // supply convoy from an outlying base with a real stockpile to the capital
  if (s.time >= f.nextConvoy && all.filter((q) => q.task.type === 'convoy' && aiTraffic(s, q)).length < MAX_CONVOY) {
    for (const b of bases) {
      if (b === cap) continue;
      const total = Object.values(b.storage).reduce((t, v) => t + v, 0);
      if (total < 120) continue;
      const crew = crewFrom(b, 2 + (f.traits.caution > 0.6 ? 1 : 0));
      if (!crew) continue;
      const cargo = {};
      for (const [r, v] of Object.entries(b.storage)) { const take = Math.floor(v * 0.6); if (take > 0) { cargo[r] = take; b.storage[r] -= take; } }
      crew[0].design = { ...this.styleDesign(f, false), ...PRESET_CONVOY(f) };
      this.createSquad(f.id, crew.map((n) => n.id), { type: 'convoy', destBaseId: cap.id }, { from: b, cargo, speed: 9, name: `${f.short} supply convoy` });
      f.nextConvoy = s.time + DAY_LEN * this.rng.range(0.8, 1.1);
      break;
    }
  }
  // trade caravan to the Hub: sell the most valuable surplus
  if (s.time >= f.nextTrade && all.filter((q) => q.task.type === 'trade' && aiTraffic(s, q)).length < MAX_TRADE) {
    const mem = this.members(f.id).length;
    const keep = { food: mem * 2, water: mem * 2, fuel: 60, ammo: 80, scrap: 120 };
    const cargo = {};
    let value = 0;
    for (const r of RESOURCES) {
      const surplus = Math.floor((stock[r] || 0) - (keep[r] ?? 30));
      if (unitPrice(s.market, r) < RES_BASE(r) * 0.6) continue; // hold stock when the market is flooded
      if (surplus > 25) { const take = Math.min(surplus, 120); cargo[r] = take; value += take * unitPrice(s.market, r); }
    }
    if (value > 150) {
      const crew = crewFrom(cap, 2 + (f.traits.caution > 0.6 ? 1 : 0));
      if (crew) {
        for (const [r, v] of Object.entries(cargo)) { let left = v; for (const b of bases) { left -= this.takeStorage(b, r, left); if (left <= 0) break; } cargo[r] = v - Math.max(0, left); }
        crew[0].design = { ...this.styleDesign(f, false), ...PRESET_CONVOY(f) };
        this.createSquad(f.id, crew.map((n) => n.id), { type: 'trade' }, { from: cap, cargo, speed: 9, name: `${f.short} trade caravan` });
        // greedy factions run caravans a little more often
        f.nextTrade = s.time + DAY_LEN * (1.2 + (1 - (f.traits.greed ?? 0.5)) * 0.4);
      }
    }
  }
};

import { RES_INFO } from '../world/biomes.js';
function RES_BASE(r) { return RES_INFO[r].base; }

function PRESET_CONVOY(f) {
  return { chassis: 'truck', engine: 'diesel', wheels: f.carStyle === 'tech' ? 'hover' : f.carStyle === 'fast' ? 'slicks' : 'standard', armor: 'light', weapons: [null, 'mg', null, null], utils: ['cargoRack', null, null, null, null] };
}

// Score possible operations: claims, attacks, raids. Market motives make producers fight producers.
P.chooseOperation = function (f, myPower, stock) {
  const s = this.s, T = f.traits;
  const day = this.day;
  const fighters = this.availableFighters(f);
  if (fighters.length < 2) return null;
  const options = [];
  const border = this.borderZones(f.id);
  const myZones = this.factionZones(f.id);
  // claims
  if (s.time - f.lastExpand > DAY_LEN * (1.4 - T.ambition * 0.6)) {
    for (const zid of border) {
      const z = s.zones[zid];
      if (!z.claimable) continue;
      const zd = this.zoneDef(zid);
      if (zd.biome === 'hub') continue;
      const site = this.freeSite(zid);
      if (!site) continue;
      // fairness: leave the inner ring alone for the first days so the player can claim one
      if (zd.ring === 1 && day < 7) continue;
      const scav = Object.values(s.bases).find((b) => b.zoneId === zid && b.scav);
      const value = Object.values(zd.richness).reduce((t, v) => t + v, 0);
      if (scav) {
        const ratio = combatValue(this.groupCombat(fighters, zid)) / Math.max(1, combatValue(this.baseCombat(scav)));
        if (ratio < 2.5) continue;
      }
      options.push({ type: scav ? 'attack' : 'claim', zoneId: zid, site, target: scav, score: value * (0.5 + T.ambition) * 1.4 });
    }
  }
  // attacks: bounded by a per-faction cooldown so wars have rhythm
  const attackReady = s.time - f.lastAttack > DAY_LEN * (0.55 + T.caution * 0.6);
  const marketTargets = this.marketRivals(f);
  if (attackReady) for (const b of Object.values(s.bases)) {
    if (b.factionId === f.id) continue;
    const other = s.factions[b.factionId];
    if (!other || !other.alive) continue;
    const reachable = border.includes(b.zoneId) || myZones.includes(b.zoneId) || (T.ambition > 0.8 && fighters.length > 10);
    if (!reachable) continue;
    const war = this.atWar(f.id, other.id);
    const r = this.rel(f.id, other.id);
    const pact = this.pact(f.id, other.id);
    if (pact === 'alliance' || pact === 'truce') continue;
    if (!war && r > -40 && !b.scav) continue;
    if (b.scav && this.zoneDef(b.zoneId).ring === 1 && day < 7) continue;
    if (other.isPlayer) {
      const gate = this.director_playerAttackGate ? this.director_playerAttackGate(f, b) : day >= 4;
      if (!gate) continue;
    }
    const A = this.groupCombat(fighters, b.zoneId);
    const D = this.baseCombat(b);
    const ratio = combatValue(A) / Math.max(1, combatValue(D));
    const need = 1.8 + T.caution * 1.6;
    if (ratio < need) continue;
    const zd = this.zoneDef(b.zoneId);
    const value = Object.values(zd.richness).reduce((t, v) => t + v, 0) + (b.capital ? 1 : 0);
    let motive = (war ? 1.4 : 0.5) * (0.4 + T.aggression) * Math.min(2, ratio / need);
    if (b.scav) motive *= 0.5 + T.ambition * 0.5;
    if (marketTargets.has(b.zoneId)) motive *= 1.6 + T.greed * 0.6;
    if (f.grudges[b.factionId]) motive *= 1 + Math.min(1.5, f.grudges[b.factionId] / 50);
    options.push({ type: 'attack', target: b, zoneId: b.zoneId, score: value * motive, market: marketTargets.has(b.zoneId), need });
  }
  if (!options.length) return null;
  const pick = this.rng.weighted(options, (o) => o.score);
  if (!pick || pick.score < 0.6) return null;
  pick.fighters = fighters;
  return pick;
};

// Zones where a rival produces what we produce, and prices are sliding (oversupply)
P.marketRivals = function (f) {
  const out = new Set();
  const s = this.s;
  for (const [r, v] of Object.entries(f.prod || {})) {
    if (v < 2) continue;
    const trend = priceTrend(s.market, r);
    if (trend > -0.05 && f.traits.greed < 0.7) continue;
    for (const o of Object.values(s.factions)) {
      if (o.id === f.id || !o.alive || !(o.prod?.[r] > 1.5)) continue;
      for (const b of this.factionBases(o.id)) if ((this.zoneDef(b.zoneId).richness[r] || 0) > 0.5) out.add(b.zoneId);
    }
  }
  return out;
};

P.launchOperation = function (f, op) {
  const s = this.s;
  const fighters = op.fighters.sort((a, b) => this.npcStrength(b) - this.npcStrength(a));
  f.lastAttack = s.time;
  if (op.type === 'claim') {
    const crew = fighters.slice(0, 3);
    if (!this.factionAffords(f, { scrap: 80 })) return;
    this.factionPayOrBuy(f, { scrap: 80 }, this.capital(f.id));
    const from = this.s.bases[crew[0].baseId];
    this.createSquad(f.id, crew.map((n) => n.id), { type: 'claim', zoneId: op.zoneId, site: op.site }, { from });
    f.lastExpand = s.time;
    this.emit('aiOperation', f, op);
    return;
  }
  const target = op.target;
  const other = s.factions[target.factionId];
  const D = combatValue(this.baseCombat(target)) + 1;
  const crew = [];
  const need = (op.need || 2) * 1.25;
  for (const n of fighters) { crew.push(n); if (crew.length >= 3 && combatValue(this.groupCombat(crew, target.zoneId)) > D * need) break; if (crew.length >= 10) break; }
  // declare war if needed
  if (other && !other.bandit && !this.atWar(f.id, other.id)) {
    this.setPact(f.id, other.id, 'war');
    this.chronicle('war', { a: f, b: other, market: op.market, res: op.market ? this.sharedProduct(f, other) : null });
  }
  const from = s.bases[crew[0].baseId] || this.capital(f.id);
  const sq = this.createSquad(f.id, crew.map((n) => n.id), { type: 'attack', targetBaseId: target.id, zoneId: target.zoneId }, { from, name: `${f.short} warband`, wait: 20 });
  if (other && !other.bandit) this.chronicle('march', { f, b: target, other, sq, market: op.market });
  this.emit('aiOperation', f, op, sq);
};

P.sharedProduct = function (a, b) {
  let best = null, bv = 0;
  for (const [r, v] of Object.entries(a.prod || {})) { const w = Math.min(v, b.prod?.[r] || 0); if (w > bv) { bv = w; best = r; } }
  return best;
};

// Relations drift, wars, peace, alliances, and the occasional knife in the back.
P.aiDiplomacy = function (f, myPower) {
  const s = this.s, T = f.traits;
  for (const o of Object.values(s.factions)) {
    if (o.id === f.id || !o.alive || o.bandit) continue;
    const pact = this.pact(f.id, o.id);
    let drift = 0;
    const r = this.rel(f.id, o.id);
    drift += r > 0 ? -0.5 : 0.5; // regress to the mean
    // shared enemies bring factions together
    const sharedEnemy = this.enemies(f.id).some((e) => this.atWar(o.id, e.id));
    if (sharedEnemy) drift += 2;
    // border friction
    const border = this.borderZones(f.id).some((z) => s.zones[z].owner === o.id);
    if (border) drift -= 1.2 * T.aggression;
    // competing producers
    for (const [res, v] of Object.entries(f.prod || {})) if (v > 2 && (o.prod?.[res] || 0) > 2) drift -= 0.8 * T.greed;
    // ideology: zealots dislike schemers etc.
    if (T.zeal > 0.8 && o.traits.honor < 0.3) drift -= 0.6;
    this.addRel(f.id, o.id, drift * (o.isPlayer ? 0.5 : 1));
    if (o.isPlayer) continue; // player diplomacy happens through offers
    const theirPower = o.powerCache || this.factionPower(o.id);
    const ratio = myPower / Math.max(1, theirPower);
    if (pact === 'war') {
      f.warWeariness += 1;
      const warAge = s.time - (this.pactInfo(f.id, o.id)?.since || 0);
      if (warAge > DAY_LEN * 1.2 && ((f.warWeariness > 25 + T.aggression * 30 && ratio < 1.2) || ratio < 0.45)) {
        if (this.rng.chance(0.25 + T.caution * 0.4) && o.traits.aggression < 0.8) {
          this.setPact(f.id, o.id, 'truce');
          this.addRel(f.id, o.id, 25);
          f.warWeariness = 0;
          this.chronicle('truce', { a: f, b: o });
        }
      }
    } else if (pact === 'truce') {
      if (s.time - this.pactInfo(f.id, o.id).since > 1800) this.setPact(f.id, o.id, null, null, true);
    } else if (pact === 'alliance') {
      // betrayal is the storyteller's job mostly, but cunning low-honour leaders sometimes act alone
      if (T.honor < 0.3 && ratio > 1.8 && this.rng.chance(0.02 + T.cunning * 0.03) && this.day > 5) this.betrayAlly(f, o);
    } else {
      if (r < -55 && ratio > 1.1 + T.caution && this.rng.chance(T.aggression * 0.5)) {
        this.setPact(f.id, o.id, 'war');
        this.chronicle('war', { a: f, b: o });
      } else if (r > 45 && sharedEnemy && this.allies(f.id).length < 2 && this.rng.chance(0.2 * (1 - T.paranoia * 0.5))) {
        this.setPact(f.id, o.id, 'alliance', this.allianceName(f, o));
        this.chronicle('alliance', { a: f, b: o, name: this.pactInfo(f.id, o.id).name });
      }
    }
  }
};

P.allianceName = function (a, b) {
  const n = ['Accord', 'Pact', 'Compact', 'Union', 'Handshake', 'Covenant', 'Understanding'];
  const place = this.rng.pick(['Dust', 'Iron', 'Salt', 'Sun', 'Oil', 'Glass', 'Bone', 'Rust', 'Chrome', 'Ember']);
  return `The ${place} ${this.rng.pick(n)}`;
};

P.betrayAlly = function (f, victim, opts = {}) {
  const s = this.s;
  const pact = this.pactInfo(f.id, victim.id);
  this.setPact(f.id, victim.id, 'war');
  this.setRel(f.id, victim.id, -90);
  victim.grudges[f.id] = (victim.grudges[f.id] || 0) + 100;
  s.stats.betrayals++;
  // surprise attack on the nearest victim base
  const fighters = this.availableFighters(f);
  const targets = this.factionBases(victim.id).sort((a, b) => this.distToFaction(f, a) - this.distToFaction(f, b));
  const target = targets[0];
  let sq = null;
  if (target && fighters.length >= 2) {
    sq = this.createSquad(f.id, fighters.slice(0, 8).map((n) => n.id), { type: 'attack', targetBaseId: target.id, zoneId: target.zoneId, surprise: true }, { from: this.capital(f.id), name: `${f.short} betrayers` });
    // surprise: defenders start weakened
    for (const st of target.structs) if (STRUCTS[st.type].defense) st.hp *= 0.7;
  }
  // everyone else remembers
  for (const o of Object.values(s.factions)) if (o.alive && o.id !== f.id && o.id !== victim.id) this.addRel(o.id, f.id, -15 * (o.traits.honor || 0.5));
  this.chronicle('betrayal', { a: f, b: victim, pactName: pact?.name, target, ...opts });
  this.emit('betrayal', f, victim, sq);
  return sq;
};

P.distToFaction = function (f, b) {
  const cap = this.capital(f.id);
  return cap ? Math.hypot(cap.x - b.x, cap.z - b.z) : 0;
};
