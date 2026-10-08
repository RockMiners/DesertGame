// Missions: board jobs, faction war missions, event missions. Objectives are checked against sim state.
import { Sim } from './sim.js';
import { RES_INFO, RESOURCES } from '../world/biomes.js';
import { RANK_REP, RANKS, DAY_LEN } from './defs.js';
import { PRESET_DESIGNS } from '../vehicle/parts.js';
import { genDriverName } from './lore.js';

const P = Sim.prototype;

P.createMission = function (m) {
  const s = this.s;
  const id = this.id('m');
  const mission = {
    id, status: 'offered', created: s.time, expires: m.expires ?? s.time + DAY_LEN * 1.5, giver: m.giver || 'hub',
    reward: { caps: 0, rep: {}, ...(m.reward || {}) }, penalty: m.penalty || {}, ...m, id,
  };
  mission.obj = { progress: 0, ...m.obj };
  s.missions[id] = mission;
  this.emit('missionOffered', mission);
  return mission;
};

P.acceptMission = function (id) {
  const m = this.s.missions[id];
  if (!m || m.status !== 'offered') return { ok: false, msg: 'Mission unavailable' };
  const active = Object.values(this.s.missions).filter((x) => x.status === 'active').length;
  if (active >= 5) return { ok: false, msg: 'You already have 5 active missions' };
  m.status = 'active';
  m.acceptedAt = this.s.time;
  if (m.obj.timeLimit) m.deadline = this.s.time + m.obj.timeLimit;
  this.onMissionAccepted?.(m);
  this.emit('missionAccepted', m);
  return { ok: true, msg: `Accepted: ${m.title}` };
};

P.abandonMission = function (id) {
  const m = this.s.missions[id];
  if (!m || m.status !== 'active') return { ok: false };
  this.failMission(m, 'abandoned');
  return { ok: true, msg: 'Mission abandoned' };
};

P.completeMission = function (m) {
  if (m.status !== 'active') return;
  m.status = 'done';
  const g = this.s.group;
  const r = m.reward;
  if (r.caps) g.wallet += r.caps;
  for (const [fid, v] of Object.entries(r.rep || {})) this.changeRep(fid, v);
  if (r.unlockTier) g.unlocked.tier = Math.max(g.unlocked.tier, r.unlockTier);
  if (r.unlock) for (const p of [].concat(r.unlock)) if (!g.unlocked.extra.includes(p)) g.unlocked.extra.push(p);
  if (r.items) this.emit('giveItems', r.items);
  g.missionsDone++;
  this.emit('missionComplete', m);
  if (m.onComplete) this.runAction(m.onComplete, m);
  this.checkRank();
};

P.failMission = function (m, why = 'failed') {
  if (m.status !== 'active' && m.status !== 'offered') return;
  const wasActive = m.status === 'active';
  m.status = 'failed';
  if (wasActive) for (const [fid, v] of Object.entries(m.penalty.rep || {})) this.changeRep(fid, v);
  if (wasActive) this.emit('missionFailed', m, why);
  if (m.onFail) this.runAction(m.onFail, m);
};

P.changeRep = function (fid, d) {
  const g = this.s.group;
  if (!this.s.factions[fid]) return;
  const before = g.rep[fid] ?? 0;
  g.rep[fid] = Math.max(-100, Math.min(100, before + d));
  if (before > -35 && g.rep[fid] <= -35) this.emit('nowHostile', fid);
};

P.checkRank = function () {
  const g = this.s.group;
  const f = this.s.factions[g.factionId];
  if (!f || f.isPlayer) return;
  const rep = g.rep[f.id] ?? 0;
  let rank = 0;
  for (let i = 0; i < RANK_REP.length; i++) if (rep >= RANK_REP[i]) rank = i;
  if (rank > g.rank) {
    g.rank = rank;
    this.emit('rankUp', RANKS[rank], f);
    if (rank >= 2) g.unlocked.tier = Math.max(g.unlocked.tier, 2);
    if (rank >= 4) this.emit('coupPossible', f);
  }
};

// Mission objective checks — called every second
P.missionTick = function () {
  const s = this.s;
  for (const m of Object.values(s.missions)) {
    if (m.status === 'offered' && s.time > m.expires) { m.status = 'expired'; continue; }
    if (m.status !== 'active') continue;
    if (m.deadline && s.time > m.deadline) { this.failMission(m, 'time'); continue; }
    const o = m.obj;
    switch (o.kind) {
      case 'destroyBase': if (!s.bases[o.baseId]) this.completeMission(m); break;
      case 'killSquad': if (!s.squads[o.squadId] || !s.squads[o.squadId].members.length) this.completeMission(m); else { const sq = s.squads[o.squadId]; o.x = sq.x; o.z = sq.z; } break;
      case 'killNpc': { const n = s.npcs[o.npcId]; if (!n || !n.alive) this.completeMission(m); else if (n.squadId && s.squads[n.squadId]) { o.x = s.squads[n.squadId].x; o.z = s.squads[n.squadId].z; } break; }
      case 'reach': if (this.anyPlayerNear(o.x, o.z, o.r || 30)) { if (o.then) { Object.assign(o, o.then); delete o.then; this.emit('missionUpdate', m); } else this.completeMission(m); } break;
      case 'race': {
        const cp = o.checkpoints[o.idx];
        if (cp && this.anyPlayerNear(cp[0], cp[1], 18)) { o.idx++; this.emit('checkpoint', m, o.idx, o.checkpoints.length); if (o.idx >= o.checkpoints.length) this.completeMission(m); }
        if (o.checkpoints[o.idx]) { o.x = o.checkpoints[o.idx][0]; o.z = o.checkpoints[o.idx][1]; }
        break;
      }
      case 'protectBase': {
        const b = s.bases[o.baseId];
        if (!b) { this.failMission(m, 'base lost'); break; }
        o.x = b.x; o.z = b.z;
        const sq = s.squads[o.squadId];
        if (!sq || sq.retreating || !sq.members.length) this.completeMission(m);
        break;
      }
      case 'escortSquad': {
        const sq = s.squads[o.squadId];
        if (!sq || !sq.members.length) { if (o.arrived) this.completeMission(m); else this.failMission(m, 'convoy destroyed'); break; }
        o.x = sq.x; o.z = sq.z;
        break;
      }
      case 'destroyStructs': {
        const b = s.bases[o.baseId];
        if (!b) { this.completeMission(m); break; }
        const left = b.structs.filter((st) => st.type === o.structType).length;
        o.progress = o.startCount - left;
        if (o.progress >= o.count) this.completeMission(m);
        o.x = b.x; o.z = b.z;
        break;
      }
      case 'deliver': case 'collect': break; // completed via commands
      case 'kills': if (o.progress >= o.count) this.completeMission(m); break;
      case 'stunt': if (o.progress >= o.count) this.completeMission(m); break;
    }
  }
  // tidy old missions
  if (Math.random() < 0.01) for (const [id, m] of Object.entries(s.missions)) if (['done', 'failed', 'expired'].includes(m.status) && s.time - (m.acceptedAt || m.created) > DAY_LEN * 3) delete s.missions[id];
  this.refreshBoard();
};

P.anyPlayerNear = function (x, z, r) {
  for (const p of Object.values(this.s.players)) if (p.pos && Math.hypot(p.pos[0] - x, p.pos[1] - z) < r) return true;
  return false;
};

// Keep a few jobs on offer from the hub and from factions that like the group
P.refreshBoard = function () {
  const s = this.s;
  if ((this._boardT = (this._boardT || 0) - 1) > 0) return;
  this._boardT = 20;
  const offered = Object.values(s.missions).filter((m) => m.status === 'offered' && m.board);
  const byGiver = {};
  for (const m of offered) byGiver[m.giver] = (byGiver[m.giver] || 0) + 1;
  if ((byGiver.hub || 0) < 4) this.genBoardMission('hub');
  for (const f of Object.values(s.factions)) {
    if (!f.alive || f.isPlayer || f.bandit) continue;
    if ((s.group.rep[f.id] ?? 0) < -20) continue;
    if ((byGiver[f.id] || 0) < (f.id === s.group.factionId ? 4 : 2)) this.genBoardMission(f.id);
  }
};

// Procedural mission generator — endless content once the premade arcs run out
P.genBoardMission = function (giver) {
  const s = this.s, rng = this.rng;
  const f = s.factions[giver];
  const day = this.day;
  const scale = 1 + Math.min(3, day / 8);
  const types = giver === 'hub'
    ? [['race', 2], ['bounty', 3], ['deliver', 2], ['scavenge', 2], ['stunt', 1], ['clearCamp', 2]]
    : [['raidConvoy', 3], ['sabotage', 2], ['attackBase', 2], ['deliver', 2], ['bounty', 2], ['recon', 1], ['scavenge', 1]];
  const pickT = rng.weighted(types, ([, w]) => w)[0];
  const giverName = f ? f.short : 'Hub';
  const repR = (n) => (f ? { [f.id]: n } : {});
  const enemyOf = () => {
    if (!f) return null;
    const ens = Object.values(s.factions).filter((o) => o.alive && o.id !== f.id && !o.bandit && !o.isPlayer && (this.atWar(f.id, o.id) || this.rel(f.id, o.id) < -30));
    return ens.length ? rng.pick(ens) : null;
  };
  switch (pickT) {
    case 'race': {
      const zs = this.world.zones.filter((z) => z.ring === 1);
      const pts = [];
      let a = rng.range(0, Math.PI * 2);
      for (let i = 0; i < 5; i++) { a += rng.range(0.6, 1.3); const r = rng.range(260, 700); pts.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); }
      pts.push([0, 210]);
      void zs;
      const t = Math.round(pts.reduce((acc, p, i) => acc + Math.hypot(p[0] - (pts[i - 1]?.[0] ?? 0), p[1] - (pts[i - 1]?.[1] ?? 210)), 0) / 22 + 20);
      return this.createMission({ board: true, giver, type: 'race', title: rng.pick(['Dune Derby', 'The Rattlesnake Run', 'Tumbleweed Sprint', 'Sandblast Circuit', 'Hub Grand Prix']), desc: `Hit ${pts.length} checkpoints in ${t}s. Auntie Tallow is running a book on it.`, obj: { kind: 'race', checkpoints: pts, idx: 0, x: pts[0][0], z: pts[0][1], timeLimit: t }, reward: { caps: Math.round(60 * scale) }, startOnAccept: true });
    }
    case 'stunt': {
      const n = rng.int(2, 4);
      return this.createMission({ board: true, giver, type: 'stunt', title: 'Show-Off', desc: `Land ${n} big jumps (1.5s+ airtime) for the cantina crowd.`, obj: { kind: 'stunt', count: n, minAir: 1.5 }, reward: { caps: Math.round(35 * scale) } });
    }
    case 'bounty': {
      // spawn a named ace with a small crew in a wild or hostile zone
      const zones = this.world.zones.filter((z) => z.biome !== 'hub' && (s.zones[z.id].claimable || (f && s.zones[z.id].owner && this.hostileTeams(f.id, s.zones[z.id].owner))));
      const zd = rng.pick(zones.length ? zones : this.world.zones.filter((z) => z.biome !== 'hub'));
      const ace = this.createNpc('scavvers', 'lieutenant', { design: { ...PRESET_DESIGNS[rng.pick(['raider', 'spikyHeavy', 'spiky'])], paint: '#3d3a40', paint2: '#e63946' }, skill: Math.min(0.85, 0.4 + day * 0.02), name: genDriverName(rng) });
      ace.epithet = rng.pick(['the Butcher of the Dunes', 'Mad Muffler', 'the Rust Ghost', 'Old Sixguns', 'the Dune Shark']);
      const crew = [ace.id];
      for (let i = 0; i < Math.min(4, 1 + Math.floor(day / 4)); i++) crew.push(this.createNpc('scavvers', 'driver', { design: { ...PRESET_DESIGNS.scav }, skill: 0.35 }).id);
      const sq = this.createSquad('scavvers', crew, { type: 'roam', zoneId: zd.id, legs: 40 }, { x: zd.cx, z: zd.cz, speed: 9 });
      return this.createMission({ board: true, giver, type: 'bounty', title: `Bounty: ${ace.name}`, desc: `${ace.name}, "${ace.epithet}", has been hitting caravans in ${zd.name}. Bring back their hubcap.`, obj: { kind: 'killNpc', npcId: ace.id, x: zd.cx, z: zd.cz }, reward: { caps: Math.round(90 * scale), rep: repR(8) }, squadId: sq.id });
    }
    case 'clearCamp': {
      const camps = Object.values(s.bases).filter((b) => b.scav);
      if (!camps.length) return null;
      const b = rng.pick(camps);
      return this.createMission({ board: true, giver, type: 'clearCamp', title: `Clear ${b.name}`, desc: `Scavvers at ${b.name} in ${this.zoneDef(b.zoneId).name} keep jumping traders. Flatten their headquarters.`, obj: { kind: 'destroyBase', baseId: b.id, x: b.x, z: b.z }, reward: { caps: Math.round(110 * scale), rep: Object.fromEntries(Object.values(s.factions).filter((x) => x.alive && !x.bandit).map((x) => [x.id, 2])) } });
    }
    case 'deliver': {
      const res = rng.pick(['water', 'food', 'fuel', 'ammo', 'chems', 'scrap']);
      const amt = rng.int(15, 35);
      const target = f ? this.capital(f.id) : null;
      const where = target ? target.name : 'the Hub';
      return this.createMission({ board: true, giver, type: 'deliver', title: `${RES_INFO[res].name} Run`, desc: `${giverName} needs ${amt} ${RES_INFO[res].name.toLowerCase()} delivered to ${where}. Buy it, dig it, or steal it.`, obj: { kind: 'deliver', res, amount: amt, baseId: target?.id || null, x: target ? target.x : 0, z: target ? target.z : 0 }, reward: { caps: Math.round(amt * (RES_INFO[res].base * 1.7) * Math.min(1.8, scale * 0.8)), rep: repR(6) } });
    }
    case 'scavenge': {
      const res = rng.pick(['scrap', 'crystal', 'electronics', 'chems']);
      const amt = rng.int(10, 24);
      return this.createMission({ board: true, giver, type: 'scavenge', title: `Scavenge ${RES_INFO[res].name}`, desc: `Bring ${amt} ${RES_INFO[res].name.toLowerCase()} to ${f ? this.capital(f.id)?.name : 'the Hub'}. Check the map for zones rich in it.`, obj: { kind: 'deliver', res, amount: amt, baseId: f ? this.capital(f.id)?.id : null, x: f ? this.capital(f.id)?.x : 0, z: f ? this.capital(f.id)?.z : 0 }, reward: { caps: Math.round(amt * RES_INFO[res].base * 1.6), rep: repR(5) } });
    }
    case 'raidConvoy': {
      const e = enemyOf();
      if (!e) return null;
      const convoy = Object.values(s.squads).find((q) => q.factionId === e.id && (q.task.type === 'trade' || q.task.type === 'convoy'));
      if (!convoy) return null;
      return this.createMission({ board: true, giver, type: 'raidConvoy', title: `Hit the ${e.short} Convoy`, desc: `A ${e.short} ${convoy.task.type === 'trade' ? 'trade caravan' : 'supply convoy'} is on the road. Wreck it and keep whatever falls out.`, obj: { kind: 'killSquad', squadId: convoy.id, x: convoy.x, z: convoy.z }, reward: { caps: Math.round(80 * scale), rep: repR(10) }, expires: s.time + DAY_LEN * 0.5, target: e.id });
    }
    case 'sabotage': {
      const e = enemyOf();
      if (!e) return null;
      const bases = this.factionBases(e.id).filter((b) => b.structs.some((st) => ['pump', 'mine', 'well', 'farm', 'extractor'].includes(st.type)));
      if (!bases.length) return null;
      const b = rng.pick(bases);
      const type = rng.pick(b.structs.filter((st) => ['pump', 'mine', 'well', 'farm', 'extractor'].includes(st.type))).type;
      const cnt = b.structs.filter((st) => st.type === type).length;
      return this.createMission({ board: true, giver, type: 'sabotage', title: `Sabotage at ${b.name}`, desc: `Knock out the ${e.short}'s ${type === 'pump' ? 'pumpjacks' : type + 's'} at ${b.name}. Hit their wallet where it hurts.`, obj: { kind: 'destroyStructs', baseId: b.id, structType: type, count: Math.min(2, cnt), startCount: cnt, x: b.x, z: b.z }, reward: { caps: Math.round(120 * scale), rep: repR(12) }, penalty: {}, target: e.id });
    }
    case 'attackBase': {
      const e = enemyOf();
      if (!e) return null;
      const bases = this.factionBases(e.id).filter((b) => !b.capital);
      if (!bases.length) return null;
      const b = rng.pick(bases);
      return this.createMission({ board: true, giver, type: 'attackBase', title: `Assault on ${b.name}`, desc: `${this.leaderName(f)} wants ${b.name} gone. Destroy its headquarters; ${giverName} drivers will meet you there.`, obj: { kind: 'destroyBase', baseId: b.id, x: b.x, z: b.z }, reward: { caps: Math.round(200 * scale), rep: repR(18) }, support: true, target: e.id });
    }
    case 'recon': {
      const e = enemyOf();
      const b = e ? rng.pick(this.factionBases(e.id)) : null;
      if (!b) return null;
      return this.createMission({ board: true, giver, type: 'recon', title: `Scout ${b.name}`, desc: `Drive within 120m of ${b.name} and get out alive.`, obj: { kind: 'reach', x: b.x, z: b.z, r: 120 }, reward: { caps: Math.round(50 * scale), rep: repR(5) } });
    }
  }
  return null;
};

// When the group's faction launches an attack, offer the player a seat in the warband
P.onMissionAccepted = function (m) {
  const s = this.s;
  if (m.support && m.obj.kind === 'destroyBase') {
    const f = s.factions[m.giver];
    const b = s.bases[m.obj.baseId];
    if (f && b) {
      const fighters = this.availableFighters(f).slice(0, 4);
      if (fighters.length) {
        const sq = this.createSquad(f.id, fighters.map((n) => n.id), { type: 'attack', targetBaseId: b.id, zoneId: b.zoneId, claimAfter: false }, { name: `${f.short} strike team`, wait: 40 });
        sq.missionId = m.id;
        m.supportSquad = sq.id;
      }
      if (!this.atWar(f.id, b.factionId) && !s.factions[b.factionId]?.bandit) { this.setPact(f.id, b.factionId, 'war'); this.chronicle('war', { a: f, b: s.factions[b.factionId] }); }
    }
  }
  if (m.obj.kind === 'race') m.obj.idx = 0;
};

// Player commands for delivering cargo
P.tryDeliver = function (pid, cargo, atBaseId) {
  const out = [];
  for (const m of Object.values(this.s.missions)) {
    if (m.status !== 'active' || m.obj.kind !== 'deliver') continue;
    const okPlace = m.obj.baseId ? m.obj.baseId === atBaseId : atBaseId === 'hub';
    if (!okPlace) continue;
    if ((cargo[m.obj.res] || 0) >= m.obj.amount) {
      cargo[m.obj.res] -= m.obj.amount;
      out.push(m);
      this.completeMission(m);
    }
  }
  return out;
};

P.noteKill = function (victimTeam, npc) {
  const g = this.s.group;
  g.kills++;
  for (const m of Object.values(this.s.missions)) if (m.status === 'active' && m.obj.kind === 'kills' && (!m.obj.team || m.obj.team === victimTeam)) m.obj.progress++;
  this.addDeed('slayer');
  void npc;
};

P.noteStunt = function (air) {
  for (const m of Object.values(this.s.missions)) if (m.status === 'active' && m.obj.kind === 'stunt' && air >= m.obj.minAir) { m.obj.progress++; this.emit('missionUpdate', m); }
};

export { RANKS, RESOURCES };
