// Player commands: factions, bases, building, trade, recruits, quests, routes, diplomacy, coups.
// Every command is serializable so multiplayer clients can send them to the host.
import { Sim, pairKey } from './sim.js';
import { STRUCTS, BASE_SIZES, TILE, DAY_LEN, RANK_REP } from './defs.js';
import { marketBuy, marketSell, quote, unitPrice, localPrice } from './economy.js';
import { designStats, addCost, PART_TABLES } from '../vehicle/parts.js';
import { RES_INFO } from '../world/biomes.js';
import { HUB_SAFE_R } from './constants.js';

const P = Sim.prototype;
const ok = (msg, extra = {}) => ({ ok: true, msg, ...extra });
const no = (msg) => ({ ok: false, msg });

P.cmd = function (name, args = {}, pid = 'host') {
  const fn = COMMANDS[name];
  if (!fn) return no(`Unknown command ${name}`);
  try { return fn.call(this, args, pid) || ok(''); } catch (e) { console.error('cmd', name, e); return no('Something went wrong: ' + e.message); }
};

function groupFaction(sim) { const f = sim.s.factions[sim.s.group.factionId]; return f && f.isPlayer ? f : null; }

// pay a cost from base storage, topping up from the wallet at market prices
function payCost(sim, base, cost, opts = {}) {
  const s = sim.s;
  let caps = 0;
  const fromBase = {};
  for (const [r, v] of Object.entries(cost)) {
    const have = base ? Math.min(v, base.storage[r] || 0) : 0;
    fromBase[r] = have;
    const short = v - have;
    if (short > 0) caps += Math.ceil(short * unitPrice(s.market, r) * 1.25);
  }
  if (caps > s.group.wallet) return { ok: false, caps };
  if (opts.dry) return { ok: true, caps };
  for (const [r, v] of Object.entries(fromBase)) if (v && base) base.storage[r] -= v;
  s.group.wallet -= caps;
  return { ok: true, caps };
}

export function costLabel(cost) { return Object.entries(cost).map(([k, v]) => `${v} ${RES_INFO[k]?.icon || k}`).join(' '); }

const COMMANDS = {
  // ----- player presence -----
  playerPos({ x, z, name, design, hp }, pid) {
    const p = (this.s.players[pid] ||= { id: pid, name: name || 'Driver' });
    p.pos = [Math.round(x), Math.round(z)];
    if (name) p.name = name;
    if (design) p.design = design;
    if (hp !== undefined) p.hp = hp;
    return null;
  },

  // ----- factions -----
  join({ fid, force }) {
    const s = this.s, g = s.group;
    const f = s.factions[fid];
    if (!f || !f.alive || f.isPlayer || f.bandit) return no('No such faction');
    if (!force && (g.rep[fid] ?? 0) < 10) return no(`The ${f.short} don't trust you yet. Do a job for them first (reputation 10+).`);
    const old = s.factions[g.factionId];
    if (old?.isPlayer) return no('You lead your own faction. Disband it first.');
    if (old) { this.changeRep(old.id, -15); this.chronicle('player', { title: `The Stranger Leaves the ${old.short}`, text: `${g.leaderName || 'The stranger'} handed back their ${old.short} colours and rode off.`, importance: 1 }); }
    g.factionId = fid;
    g.rank = 0;
    g.joinedDay = this.day;
    this.changeRep(fid, 5);
    this.checkRank();
    this.chronicle('joined', { f });
    this.emit('teamChanged');
    return ok(`You joined the ${f.name}!`);
  },
  cmdJoinFaction: null,

  leave() {
    const s = this.s, g = s.group;
    const f = s.factions[g.factionId];
    if (!f) return no('You are not in a faction');
    if (f.isPlayer) return no('You lead this faction!');
    this.changeRep(f.id, -20);
    g.factionId = null; g.rank = 0;
    this.emit('teamChanged');
    return ok(`You left the ${f.name}.`);
  },

  found({ name, color, accent, motto, x, z }) {
    const s = this.s, g = s.group;
    if (groupFaction(this)) return no('You already lead a faction');
    const T = this.world.terrain;
    const zone = T.zoneAt(x, z);
    const zs = s.zones[zone.id];
    if (zone.biome === 'hub' || Math.hypot(x, z) < HUB_SAFE_R + 60) return no('You cannot build inside the Hub.');
    if (!zs.claimable) return no(`${zone.name} is held by the ${s.factions[zs.owner]?.short}. Destroy their bases to make it claimable.`);
    if (g.wallet < 150) return no('Founding a faction costs 150 caps (charter, flags, a terrible party).');
    if (Object.values(s.bases).some((b) => Math.hypot(b.x - x, b.z - z) < 110)) return no('Too close to another base.');
    const old = s.factions[g.factionId];
    if (old) { this.changeRep(old.id, -25); this.chronicle('player', { title: `The Stranger Strikes Out Alone`, text: `${g.leaderName || 'The stranger'} quit the ${old.short} to found their own faction.`, importance: 1 }); }
    g.wallet -= 150;
    const f = this.createFaction({ name: name || `${g.leaderName}'s Crew`, short: (name || 'Crew').replace(/^The /, '').split(' ').slice(-1)[0], color: color || '#ff7f50', accent: accent || '#ffd166', motto: motto || 'We go where we please.', leader: { name: g.leaderName, traits: {} }, strength: 1 }, { isPlayer: true, treasury: 0 });
    for (const o of Object.values(s.factions)) if (o.id !== f.id) this.setRel(f.id, o.id, Math.round((g.rep[o.id] ?? 0) * 0.8));
    g.factionId = f.id; g.rank = 4;
    const b = this.createBase(f.id, { x, z, zoneId: zone.id }, 1, { name: `${g.leaderName?.split(' ')[0] || 'Home'}'s Rest`, capital: true });
    this.terrainEdit(b.x, b.z, TILE + 1, TILE + 1, b.y);
    this.computeBlocked(b);
    const c = Math.floor(b.size / 2) - 1;
    this.addStruct(b, 'hq', c, c);
    b.blocked = b.blocked.filter((t) => { const tx = t % b.size, tz = Math.floor(t / b.size); return !(tx >= c && tx <= c + 1 && tz >= c && tz <= c + 1); });
    b.storage = { scrap: 30, water: 10, food: 10 };
    this.updateZoneOwnership();
    this.chronicle('founded', { f });
    this.addDeed('conqueror');
    this.emit('teamChanged');
    return ok(`The ${f.name} are born! Build lodgings and production at your new base.`, { baseId: b.id });
  },

  newBase({ x, z }) {
    const s = this.s;
    const f = groupFaction(this);
    if (!f) return no('Found a faction first.');
    const T = this.world.terrain;
    const zone = T.zoneAt(x, z);
    const zs = s.zones[zone.id];
    if (zone.biome === 'hub' || Math.hypot(x, z) < HUB_SAFE_R + 60) return no('Not inside the Hub.');
    if (zs.owner && zs.owner !== f.id) return no(`${zone.name} belongs to the ${s.factions[zs.owner]?.short}. Raze their bases first.`);
    if (Object.values(s.bases).some((b) => Math.hypot(b.x - x, b.z - z) < 110)) return no('Too close to another base.');
    const cost = { scrap: 80 };
    const near = this.nearestGroupBase(x, z);
    const pay = payCost(this, null, cost);
    if (!pay.ok) return no(`A new HQ costs ${costLabel(cost)} (≈${pay.caps} caps).`);
    void near;
    const b = this.createBase(f.id, { x, z, zoneId: zone.id }, 1, {});
    this.terrainEdit(b.x, b.z, TILE + 1, TILE + 1, b.y);
    this.computeBlocked(b);
    const c = Math.floor(b.size / 2) - 1;
    this.addStruct(b, 'hq', c, c);
    b.blocked = b.blocked.filter((t) => { const tx = t % b.size, tz = Math.floor(t / b.size); return !(tx >= c && tx <= c + 1 && tz >= c && tz <= c + 1); });
    this.updateZoneOwnership();
    if (!zs.owner || zs.owner === f.id) this.chronicle('claim', { f, z: zone, b });
    this.addDeed('conqueror');
    return ok(`New base founded in ${zone.name}.`, { baseId: b.id });
  },

  // ----- building -----
  build({ baseId, type, tx, tz }) {
    const b = this.s.bases[baseId];
    const f = groupFaction(this);
    if (!b || !f || b.factionId !== f.id) return no('Not your base');
    const def = STRUCTS[type];
    if (!def) return no('Unknown structure');
    if (def.unique && b.structs.some((st) => st.type === type)) return no('Only one per base');
    if (def.tier && def.tier > this.s.group.unlocked.tier && !this.s.group.unlocked.extra.includes(type)) return no('Not unlocked yet');
    if (type === 'bulldozed') return COMMANDS.bulldoze.call(this, { baseId, tx, tz });
    if (!this.canPlace(b, type, tx, tz)) return no('Blocked: rough ground or occupied. Bulldoze rough tiles first.');
    const pay = payCost(this, b, def.cost);
    if (!pay.ok) return no(`Need ${costLabel(def.cost)} (short ≈${pay.caps} caps).`);
    const st = this.addStruct(b, type, tx, tz);
    this.emit('structBuilt', b, type);
    return ok(`${def.name} built${pay.caps ? ` (bought materials for ${pay.caps} caps)` : ''}.`, { structId: st.id });
  },

  demolish({ baseId, structId }) {
    const b = this.s.bases[baseId];
    const f = groupFaction(this);
    if (!b || !f || b.factionId !== f.id) return no('Not your base');
    const st = b.structs.find((x) => x.id === structId);
    if (!st) return no('Nothing there');
    if (st.type === 'hq') return no('Demolishing the HQ would abandon the base. Use Abandon Base.');
    b.structs = b.structs.filter((x) => x !== st);
    for (const [r, v] of Object.entries(STRUCTS[st.type].cost)) this.addStorage(b, r, Math.floor(v * 0.5));
    this.emit('structDestroyed', b, st, null);
    return ok(`${STRUCTS[st.type].name} demolished (half the materials refunded).`);
  },

  bulldoze({ baseId, tx, tz }) {
    const b = this.s.bases[baseId];
    const f = groupFaction(this);
    if (!b || !f || b.factionId !== f.id) return no('Not your base');
    const idx = tz * b.size + tx;
    if (!b.blocked.includes(idx)) return no('That tile is already buildable.');
    const p = this.tileWorld(b, tx, tz);
    const T = this.world.terrain;
    if (T.liquidAt(p.x, p.z) && T.liquidAt(p.x, p.z).depth > 2.5) return no('Too deep to fill.');
    const earth = T.flattenCost(p.x, p.z, TILE / 2, TILE / 2, b.y);
    const cost = { scrap: Math.max(4, Math.round(earth * 0.25)) };
    const pay = payCost(this, b, cost);
    if (!pay.ok) return no(`Bulldozing here needs ${costLabel(cost)}.`);
    this.terrainEdit(p.x, p.z, TILE / 2, TILE / 2, b.y);
    b.blocked = b.blocked.filter((t) => t !== idx);
    return ok(`Ground levelled (${costLabel(cost)}).`);
  },

  upgradeBase({ baseId }) {
    const b = this.s.bases[baseId];
    const f = groupFaction(this);
    if (!b || !f || b.factionId !== f.id) return no('Not your base');
    if (b.level >= 3) return no('Already maximum size');
    const cost = { scrap: 120 * b.level, electronics: 10 * b.level };
    const pay = payCost(this, b, cost);
    if (!pay.ok) return no(`Expanding needs ${costLabel(cost)}.`);
    this.upgradeBase(b, false);
    return ok(`${b.name} expanded to ${b.size}×${b.size}.`);
  },

  abandonBase({ baseId }) {
    const b = this.s.bases[baseId];
    const f = groupFaction(this);
    if (!b || !f || b.factionId !== f.id) return no('Not your base');
    this.destroyBase(b, { abandoned: true }, true);
    return ok(`${b.name} abandoned.`);
  },

  renameBase({ baseId, name }) {
    const b = this.s.bases[baseId];
    if (!b || b.factionId !== this.s.group.factionId) return no('Not your base');
    b.name = String(name).slice(0, 28);
    return ok('Renamed');
  },

  saveBlueprint({ baseId, name }) {
    const b = this.s.bases[baseId];
    if (!b) return no('No base');
    const c = b.size / 2;
    const bp = { name: name || `${b.name} layout`, items: b.structs.filter((st) => st.type !== 'hq').map((st) => ({ type: st.type, dx: st.tx - c, dz: st.tz - c })) };
    this.s.group.baseBlueprints.push(bp);
    return ok(`Blueprint "${bp.name}" saved (${bp.items.length} buildings).`);
  },

  // A recruit builds everything in a saved layout for you (pays as it goes)
  applyBlueprint({ baseId, index }) {
    const b = this.s.bases[baseId];
    const bp = this.s.group.baseBlueprints[index];
    if (!b || !bp || b.factionId !== this.s.group.factionId) return no('Cannot apply');
    const c = b.size / 2;
    let built = 0, skipped = 0, spent = 0;
    for (const it of bp.items) {
      const tx = Math.round(it.dx + c), tz = Math.round(it.dz + c);
      if (!this.canPlace(b, it.type, tx, tz)) { skipped++; continue; }
      const pay = payCost(this, b, STRUCTS[it.type].cost);
      if (!pay.ok) { skipped++; continue; }
      spent += pay.caps;
      this.addStruct(b, it.type, tx, tz);
      built++;
    }
    this.emit('structBuilt', b, 'blueprint');
    return ok(`Your crew built ${built} buildings from "${bp.name}"${skipped ? `, skipped ${skipped} (blocked or unaffordable)` : ''}${spent ? `, bought materials for ${spent} caps` : ''}.`);
  },

  // ----- storage & trade -----
  deposit({ baseId, cargo }) {
    const b = this.s.bases[baseId];
    if (!b || b.factionId !== this.s.group.factionId) return no('Not your base');
    const moved = {};
    for (const [r, v] of Object.entries(cargo)) { const n = this.addStorage(b, r, v); if (n > 0) moved[r] = n; }
    const delivered = this.tryDeliver('host', { ...cargo }, b.id);
    return ok(Object.keys(moved).length ? 'Stashed cargo' : 'Storage full!', { moved, delivered: delivered.length });
  },

  withdraw({ baseId, res, n }) {
    const b = this.s.bases[baseId];
    if (!b || b.factionId !== this.s.group.factionId) return no('Not your base');
    const got = this.takeStorage(b, res, n);
    return ok(`Took ${got} ${RES_INFO[res].name}`, { got });
  },

  sell({ res, n, at }) {
    const s = this.s;
    if (n <= 0) return no('Nothing to sell');
    let caps;
    if (!at || at === 'hub') caps = marketSell(s.market, res, n);
    else {
      const b = s.bases[at];
      const f = s.factions[b?.factionId];
      if (!b || !f) return no('No market here');
      caps = Math.round(localPrice(s.market, res, f, this.factionStock(f.id), true) * n);
      if (!f.isPlayer && f.treasury < caps) return no(`The ${f.short} can't afford that much.`);
      if (!f.isPlayer) f.treasury -= caps;
      this.addStorage(b, res, n);
    }
    s.group.wallet += caps;
    this.addDeed('trader', caps);
    return ok(`Sold ${n} ${RES_INFO[res].name} for ${caps} caps`, { caps, sold: n });
  },

  buy({ res, n, at }) {
    const s = this.s;
    if (n <= 0) return no('Nothing to buy');
    if (!at || at === 'hub') {
      const cost = quote(s.market, res, n, false);
      if (cost > s.group.wallet) return no(`Costs ${cost} caps — you have ${s.group.wallet}.`);
      const r = marketBuy(s.market, res, n);
      s.group.wallet -= r.caps;
      return ok(`Bought ${r.n} ${RES_INFO[res].name} for ${r.caps} caps`, { got: r.n, caps: r.caps });
    }
    const b = s.bases[at];
    const f = s.factions[b?.factionId];
    if (!b || !f) return no('No market here');
    const have = Math.floor(b.storage[res] || 0);
    const take = Math.min(n, have);
    if (take <= 0) return no(`${b.name} has none to sell.`);
    const price = f.isPlayer ? 0 : localPrice(s.market, res, f, this.factionStock(f.id), false);
    const cost = Math.round(price * take);
    if (cost > s.group.wallet) return no(`Costs ${cost} caps.`);
    s.group.wallet -= cost;
    if (!f.isPlayer) f.treasury += cost;
    b.storage[res] -= take;
    return ok(`Bought ${take} ${RES_INFO[res].name}${cost ? ` for ${cost} caps` : ''}`, { got: take, caps: cost });
  },

  service({ kind, amount, at }) {
    // refuel / rearm / repair priced in caps; at own bases it uses storage
    const s = this.s;
    const b = at && at !== 'hub' ? s.bases[at] : null;
    const own = b && b.factionId === s.group.factionId;
    const res = kind === 'fuel' ? 'fuel' : kind === 'ammo' ? 'ammo' : 'scrap';
    const units = kind === 'repair' ? Math.ceil(amount / 25) : Math.ceil(amount);
    if (own) {
      const got = Math.min(units, Math.floor(b.storage[res] || 0));
      const short = units - got;
      const caps = Math.ceil(short * unitPrice(s.market, res) * 1.2);
      if (caps > s.group.wallet) return no(`Need ${short} more ${RES_INFO[res].name} or ${caps} caps.`);
      b.storage[res] -= got; s.group.wallet -= caps;
      return ok(`${kind === 'repair' ? 'Repaired' : kind === 'fuel' ? 'Refuelled' : 'Rearmed'}${caps ? ` (${caps} caps)` : ' from base stores'}`, { amount });
    }
    const caps = Math.ceil(units * unitPrice(s.market, res) * (kind === 'repair' ? 1.0 : 1.15));
    if (caps > s.group.wallet) return no(`Costs ${caps} caps.`);
    s.group.wallet -= caps;
    return ok(`${kind === 'repair' ? 'Repaired' : kind === 'fuel' ? 'Refuelled' : 'Rearmed'} for ${caps} caps`, { amount, caps });
  },

  buyBlueprint({ tier }) {
    const g = this.s.group;
    const price = tier === 2 ? 600 : 1800;
    if (g.unlocked.tier >= tier) return no('Already unlocked');
    if (tier === 3 && g.unlocked.tier < 2) return no('Unlock tier 2 first');
    if (g.wallet < price) return no(`Wrench Wendy wants ${price} caps for those schematics.`);
    g.wallet -= price;
    g.unlocked.tier = tier;
    this.emit('unlock', `Tier ${tier} parts`);
    return ok(`Tier ${tier} schematics unlocked!`);
  },

  // ----- car designs -----
  saveDesign({ design, index }) {
    const g = this.s.group;
    const d = JSON.parse(JSON.stringify(design));
    d.id = d.id || `d${Date.now().toString(36)}`;
    if (index !== undefined && g.designs[index]) g.designs[index] = d; else g.designs.push(d);
    if (g.designs.length > 24) g.designs.shift();
    return ok(`Design "${d.name}" saved.`);
  },
  buyCar({ design, old, at }) {
    if (!this.designAllowed(design)) return no('That design uses parts you have not unlocked.');
    const s = this.s;
    const a = designStats(design).cost, b = designStats(old).cost;
    const net = {};
    for (const [k, v] of Object.entries(a)) { const n = Math.max(0, Math.ceil(v - (b[k] || 0) * 0.6)); if (n > 0) net[k] = n; }
    const base = at && at !== 'hub' ? s.bases[at] : null;
    if (base && !base.structs.some((st) => st.type === 'garage')) return no('This base has no garage.');
    const own = base && base.factionId === s.group.factionId;
    if (base && !own) {
      // allied/member garages charge caps like the Hub, slightly cheaper
      let caps = 0;
      for (const [k, v] of Object.entries(net)) caps += Math.ceil(v * unitPrice(s.market, k) * 1.1);
      if (caps > s.group.wallet) return no(`The mechanics want ${caps} caps.`);
      s.group.wallet -= caps;
      return ok(`Your new ride is ready (${caps} caps).`);
    }
    const pay = payCost(this, own ? base : null, net);
    if (!pay.ok) return no(`You need ${costLabel(net)} — about ${pay.caps} caps' worth that you don't have.`);
    return ok(`Built "${design.name}"${pay.caps ? ` for ${pay.caps} caps` : ' from your stores'}.`);
  },
  deleteDesign({ index }) {
    const g = this.s.group;
    if (g.designs.length <= 1) return no('Keep at least one design');
    g.designs.splice(index, 1);
    return ok('Design deleted');
  },

  // ----- recruits -----
  hire({ npcId }) {
    const s = this.s;
    const f = groupFaction(this);
    if (!f) return no('You need your own faction to hire crew. (Found one at a claimable zone.)');
    const n = s.npcs[npcId];
    if (!n || !s.recruitPool.includes(npcId)) return no('They already left');
    const cost = n.signing || 20;
    if (s.group.wallet < cost) return no(`Signing bonus is ${cost} caps.`);
    s.group.wallet -= cost;
    s.recruitPool = s.recruitPool.filter((x) => x !== npcId);
    this.adoptNpc(n);
    const beds = this.factionBases(f.id).reduce((t, b) => t + this.baseBeds(b), 0);
    const mem = this.members(f.id).length;
    return ok(`${n.name} joins for ${n.wage} caps/day.${mem > beds ? ' Warning: not enough beds! Build lodgings.' : ''}`);
  },

  dismiss({ npcId }) {
    const n = this.s.npcs[npcId];
    const f = groupFaction(this);
    if (!n || !f || n.factionId !== f.id) return no('Not your crew');
    if (n.squadId) return no('They are out on a job');
    n.factionId = null; n.baseId = null;
    this.s.recruitPool.push(n.id);
    return ok(`${n.name} packs up and heads to the Hub.`);
  },

  setWage({ npcId, wage }) {
    const n = this.s.npcs[npcId];
    if (!n || n.factionId !== this.s.group.factionId) return no('Not your crew');
    const old = n.wage;
    n.wage = Math.max(1, Math.min(60, Math.round(wage)));
    n.loyalty = Math.max(0, Math.min(100, n.loyalty + (n.wage - old) * 2.5 * (0.5 + n.greed)));
    return ok(`${n.name}'s wage set to ${n.wage}/day`);
  },

  bonus({ npcId, caps }) {
    const n = this.s.npcs[npcId];
    if (!n || n.factionId !== this.s.group.factionId) return no('Not your crew');
    if (this.s.group.wallet < caps) return no('Not enough caps');
    this.s.group.wallet -= caps;
    n.loyalty = Math.min(100, n.loyalty + caps * 0.4 * (0.5 + n.greed));
    return ok(`${n.name} pockets the bonus with a grin.`);
  },

  assign({ npcId, baseId }) {
    const n = this.s.npcs[npcId];
    const b = this.s.bases[baseId];
    if (!n || !b || n.factionId !== this.s.group.factionId || b.factionId !== n.factionId) return no('Cannot assign');
    if (n.squadId) return no('Busy on a job');
    n.baseId = b.id;
    return ok(`${n.name} moves to ${b.name}.`);
  },

  // Give a recruit one of your saved designs: their garage builds it from base storage
  giveDesign({ npcId, index, baseId }) {
    const s = this.s;
    const n = s.npcs[npcId];
    const d = s.group.designs[index];
    const b = s.bases[baseId || n?.baseId];
    if (!n || !d || n.factionId !== s.group.factionId) return no('Cannot');
    if (!b || !b.structs.some((st) => st.type === 'garage')) return no('That base needs a Garage to build cars.');
    if (!this.designAllowed(d)) return no('That design uses parts you have not unlocked.');
    const st = designStats(d);
    const pay = payCost(this, b, st.cost);
    if (!pay.ok) return no(`Building it needs ${costLabel(st.cost)} (≈${pay.caps} caps short).`);
    b.carQueue.push({ npcId: n.id, design: JSON.parse(JSON.stringify(d)), progress: 0 });
    return ok(`${b.name}'s garage starts building "${d.name}" for ${n.name} (~${Math.round(st.buildTime * 1.5)}h).`);
  },

  // Send recruits on a quest (they become a squad on the strategic map)
  quest({ npcIds, task }) {
    const s = this.s;
    const f = groupFaction(this);
    if (!f) return no('Found a faction first');
    const crew = npcIds.map((id) => s.npcs[id]).filter((n) => n && n.alive && n.factionId === f.id && !n.squadId);
    if (!crew.length) return no('Pick some available crew');
    const from = s.bases[crew[0].baseId] || this.capital(f.id);
    let t, name;
    switch (task.type) {
      case 'scavenge': t = { type: 'scavenge', zoneId: task.zoneId, legs: 4 }; name = `Scavengers → ${this.zoneDef(task.zoneId).name}`; break;
      case 'attack': { const b = s.bases[task.baseId]; if (!b) return no('No target'); t = { type: 'attack', targetBaseId: b.id, zoneId: b.zoneId, claimAfter: false }; name = `Raid on ${b.name}`; const o = s.factions[b.factionId]; if (o && !o.bandit && !this.atWar(f.id, o.id)) { this.setPact(f.id, o.id, 'war'); this.chronicle('war', { a: f, b: o }); } break; }
      case 'defend': { const b = s.bases[task.baseId]; if (!b) return no('No base'); t = { type: 'reinforce', destBaseId: b.id }; name = `Guards → ${b.name}`; break; }
      case 'patrol': t = { type: 'patrol', zoneId: task.zoneId, legs: 6 }; name = `Patrol ${this.zoneDef(task.zoneId).name}`; break;
      case 'trade': {
        const cargo = {};
        let total = 0;
        for (const [r, v] of Object.entries(from.storage)) { const take = Math.floor(v * (task.share ?? 0.7)); if (take > 0 && !['food', 'water'].includes(r)) { cargo[r] = take; from.storage[r] -= take; total += take; } }
        if (!total) return no('Nothing in storage worth selling');
        t = { type: 'trade' }; name = 'Trade run to the Hub';
        const sq = this.createSquad(f.id, crew.map((n) => n.id), t, { from, cargo, name, speed: 10 });
        return ok(`${crew.length} crew haul ${total} goods to the Hub.`, { squadId: sq.id });
      }
      case 'follow': return ok('They\'ll follow you once you drive off (Escort).', { follow: crew.map((n) => n.id) });
      default: return no('Unknown task');
    }
    const sq = this.createSquad(f.id, crew.map((n) => n.id), t, { from, name });
    sq.playerQuest = true;
    return ok(`${crew.length} crew sent: ${name}.`, { squadId: sq.id });
  },

  recall({ squadId }) {
    const sq = this.s.squads[squadId];
    if (!sq || sq.factionId !== this.s.group.factionId) return no('Not your squad');
    this.squadReturn(sq);
    return ok('Recalled.');
  },

  // ----- transport -----
  addRoute({ fromId, toId, res }) {
    const s = this.s;
    const a = s.bases[fromId], b = s.bases[toId];
    if (!a || !b || a.factionId !== s.group.factionId || b.factionId !== a.factionId || a === b) return no('Pick two of your bases');
    if (!a.structs.some((st) => st.type === 'depot')) return no(`${a.name} needs a Depot to dispatch convoys.`);
    s.group.routes = s.group.routes || [];
    s.group.routes.push({ id: this.id('r'), from: a.id, to: b.id, res: res || 'all', last: s.time, active: true });
    return ok(`Convoy route ${a.name} → ${b.name} created. Assign a crew member to the depot base and they'll haul automatically.`);
  },
  removeRoute({ id }) {
    const g = this.s.group;
    g.routes = (g.routes || []).filter((r) => r.id !== id);
    return ok('Route removed');
  },

  // ----- diplomacy for the player's own faction -----
  diplomacy({ fid, action }) {
    const s = this.s;
    const f = groupFaction(this);
    const o = s.factions[fid];
    if (!f || !o || !o.alive) return no('Not possible');
    const r = this.rel(f.id, o.id);
    const T = o.traits;
    const pact = this.pact(f.id, o.id);
    const myP = this.factionPower(f.id) + 60, theirP = o.powerCache || this.factionPower(o.id);
    switch (action) {
      case 'alliance': {
        if (pact === 'alliance') return no('Already allies');
        if (pact === 'war') return no('Make peace first');
        const chance = (r + 10) / 60 + (myP / theirP) * 0.2 - T.paranoia * 0.3;
        if (r < 25 || this.rng.next() > chance) { this.addRel(f.id, o.id, -3); return no(`${this.leaderName(o)} laughs. "Earn it first." (relations ${r})`); }
        this.setPact(f.id, o.id, 'alliance', this.allianceName(f, o));
        this.chronicle('alliance', { a: f, b: o, name: this.pactInfo(f.id, o.id).name });
        return ok(`Alliance with the ${o.short}: ${this.pactInfo(f.id, o.id).name}`);
      }
      case 'peace': {
        if (pact !== 'war') return no('Not at war');
        const chance = 0.25 + (theirP < myP ? 0.35 : 0) + T.caution * 0.3 + o.warWeariness * 0.01 - T.aggression * 0.3;
        if (this.rng.next() > chance) return no(`"${(o.quotes && o.quotes[0]) || 'No.'}" — ${this.leaderName(o)} refuses.`);
        this.setPact(f.id, o.id, 'truce');
        this.chronicle('truce', { a: f, b: o });
        return ok(`Truce with the ${o.short}.`);
      }
      case 'war': {
        if (pact === 'war') return no('Already at war');
        if (pact === 'alliance') return COMMANDS.diplomacy.call(this, { fid, action: 'betray' });
        this.setPact(f.id, o.id, 'war');
        this.changeRep(o.id, -30);
        this.chronicle('war', { a: f, b: o });
        return ok(`War declared on the ${o.short}!`);
      }
      case 'betray': {
        if (pact !== 'alliance') return no('You can only betray an ally.');
        const target = this.factionBases(o.id)[0];
        this.setPact(f.id, o.id, 'war');
        this.setRel(f.id, o.id, -95);
        this.changeRep(o.id, -80);
        o.grudges[f.id] = 150;
        for (const x of Object.values(s.factions)) if (x.alive && x !== f && x !== o) { this.addRel(x.id, f.id, -12 * (x.traits.honor || 0.5)); this.changeRep(x.id, -Math.round(10 * (x.traits.honor || 0.5))); }
        // surprise: their turrets are offline for a while
        for (const b of this.factionBases(o.id)) for (const st of b.structs) if (STRUCTS[st.type].defense) st.hp *= 0.75;
        this.s.stats.betrayals++;
        this.chronicle('betrayal', { a: f, b: o, pactName: null, target, byPlayer: true });
        this.addDeed('betrayer');
        return ok(`You broke the alliance. The ${o.short} are caught off guard — their defences are weakened. Strike now!`);
      }
      case 'gift': {
        if (s.group.wallet < 100) return no('A gift costs 100 caps');
        s.group.wallet -= 100;
        this.addRel(f.id, o.id, 8 + T.greed * 8);
        this.changeRep(o.id, 5);
        return ok(`The ${o.short} accept your gift. Relations ${this.rel(f.id, o.id)}.`);
      }
    }
    return no('Unknown action');
  },

  // ----- coup: take over the AI faction you serve -----
  coup() {
    const s = this.s, g = s.group;
    const f = s.factions[g.factionId];
    if (!f || f.isPlayer) return no('You are not in an AI faction');
    if (g.rank < 4) return no(`You need to be ${'Right Hand'} (reputation ${RANK_REP[4]}) to make your move.`);
    const loyal = this.members(f.id).filter((n) => n.loyalty > 75 && n.role !== 'leader').length;
    const all = this.members(f.id).length;
    const support = (g.rep[f.id] - 60) / 40 + (1 - loyal / Math.max(1, all)) * 0.5;
    const old = this.leaderName(f);
    const leader = s.npcs[f.leaderId];
    if (this.rng.next() > support * 0.9 + 0.2) {
      this.changeRep(f.id, -100);
      g.factionId = null; g.rank = 0;
      this.chronicle('player', { title: 'The Failed Coup', text: `${g.leaderName} tried to seize the ${f.name} from ${old}. The garage crews stayed loyal. ${g.leaderName} fled into the night with a price on their head.`, importance: 3 });
      this.addDeed('betrayer');
      this.emit('teamChanged');
      return no('The coup FAILED. The faction turns on you — run!');
    }
    if (leader) { leader.alive = false; this.killNpc(leader, { coup: true, byGroup: true }); }
    f.isPlayer = true;
    f.leaderId = null;
    g.rank = 4;
    for (const n of this.members(f.id)) { n.loyalty = Math.max(30, n.loyalty - 15); n.wage = n.wage || 6; }
    this.chronicle('player', { title: `The Stranger Takes the Throne`, text: `${g.leaderName} walked into the ${f.short} war room, and ${old} did not walk out. The ${f.name} have a new master — the stranger from the Hub.`, importance: 3 });
    this.addDeed('betrayer');
    this.addDeed('conqueror', 2);
    s.stats.coups++;
    this.emit('teamChanged');
    return ok(`You now rule the ${f.name}! Their bases, crews and enemies are yours.`);
  },

  // ----- misc -----
  acceptMission({ id }) { return this.acceptMission(id); },
  abandonMission({ id }) { return this.abandonMission(id); },
  answerOffer({ id, choice }) { return this.answerOffer(id, choice); },
  sleep({ baseId, pid }) {
    const s = this.s;
    const p = (s.players[pid || 'host'] ||= { id: pid || 'host' });
    p.sleepBase = baseId;
    // skip to next morning
    const t = (s.time / DAY_LEN + 0.3) % 1;
    const target = t < 0.27 ? 0.28 : 1.28;
    const skip = (target - t) * DAY_LEN;
    if (pid === 'host' || Object.keys(s.players).length <= 1) {
      // fast-forward the world in chunks so production & AI catch up
      let left = skip;
      while (left > 0) { const d = Math.min(5, left); this.tick(d); left -= d; }
      return ok('You sleep like a log. Respawn point set.', { slept: skip });
    }
    return ok('Respawn point set.');
  },
  setLeaderName({ name }) { this.s.group.leaderName = name; return ok(''); },
};

COMMANDS.cmdJoinFaction = function ({ fid }) { return COMMANDS.join.call(this, { fid, force: true }); };
P.cmdJoinFaction = function (fid, force) { return COMMANDS.join.call(this, { fid, force }); };

P.nearestGroupBase = function (x, z) {
  let best = null, bd = Infinity;
  for (const b of Object.values(this.s.bases)) if (b.factionId === this.s.group.factionId) { const d = Math.hypot(b.x - x, b.z - z); if (d < bd) { bd = d; best = b; } }
  return best;
};

P.designAllowed = function (d) {
  const g = this.s.group;
  const check = (table, id) => !id || !table[id] || (table[id].tier || 1) <= g.unlocked.tier || g.unlocked.extra.includes(id);
  if (!check(PART_TABLES.chassis, d.chassis) || !check(PART_TABLES.engine, d.engine) || !check(PART_TABLES.wheels, d.wheels) || !check(PART_TABLES.armor, d.armor)) return false;
  for (const w of d.weapons || []) if (!check(PART_TABLES.weapon, w)) return false;
  for (const u of d.utils || []) if (!check(PART_TABLES.util, u)) return false;
  return true;
};

P.partUnlocked = function (table, id) {
  const g = this.s.group;
  const t = PART_TABLES[table][id];
  return !t || (t.tier || 1) <= g.unlocked.tier || g.unlocked.extra.includes(id);
};

// Transport routes run hourly: a hauler carries goods from one base to another
P.processRoutes = function () {
  const s = this.s;
  const f = groupFaction(this);
  if (!f) return;
  for (const r of s.group.routes || []) {
    if (!r.active) continue;
    const a = s.bases[r.from], b = s.bases[r.to];
    if (!a || !b) { r.active = false; continue; }
    if (Object.values(s.squads).some((q) => q.routeId === r.id)) continue;
    if (s.time - r.last < DAY_LEN / 4) continue;
    const hauler = this.garrison(a).find((n) => n.role !== 'leader');
    if (!hauler) continue;
    const cargo = {};
    let total = 0;
    const cap = 120 + (hauler.design?.chassis === 'truck' ? 200 : hauler.design?.chassis === 'rig' ? 500 : 0);
    for (const [res, v] of Object.entries(a.storage)) {
      if (r.res !== 'all' && res !== r.res) continue;
      const take = Math.min(Math.floor(v), cap - total);
      if (take > 0) { cargo[res] = take; a.storage[res] -= take; total += take; }
    }
    if (total < 10) { for (const [res, v] of Object.entries(cargo)) a.storage[res] += v; continue; }
    r.last = s.time;
    const sq = this.createSquad(f.id, [hauler.id], { type: 'convoy', destBaseId: b.id }, { from: a, cargo, speed: 10, name: `Convoy ${a.name} → ${b.name}` });
    sq.routeId = r.id;
  }
};

export { COMMANDS, payCost };
void pairKey; void BASE_SIZES; void addCost;
