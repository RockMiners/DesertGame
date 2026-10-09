// Bridge between the strategic sim and the physical world: squads and garrisons near a player
// become real cars; deaths, arrivals and structure damage flow back into the sim.
import * as THREE from 'three';
import { PHYS_R, PHYS_R_OUT, GUARD_R, GUARD_R_OUT, TILE, STRUCTS } from './sim/defs.js';
import { combatValue } from './sim/sim.js';
import { NODE_TYPES } from './world/worldgen.js';
import { HUB_SAFE_R } from './sim/constants.js';
import { CHASSIS } from './vehicle/parts.js';
import { formationSlots, slotOffset } from './ai/driver.js';

const sizeOf = (n) => CHASSIS[n.design?.chassis]?.size ?? 1;
// convoys and caravans ride nose to tail; fighting groups ride in a wedge
// guards loop outside the compound's corners
const guardRing = (b) => (b.size * TILE) / 2 * Math.SQRT2 + 14;
const shapeOf = (sq) => (sq.task.type === 'convoy' || sq.task.type === 'trade' ? 'column' : 'wedge');

export class Bridge {
  constructor(game, sim) {
    this.game = game;
    this.sim = sim;
    this.npcCars = new Map();
    this.guardBases = new Map(); // baseId -> Set(npcId)
    this.t = 0;
    this.traffic = [];
    game.on('kill', (car, killer) => { if (!this.disposed) this.onKill(car, killer); });
    sim.on('bonusNodes', () => { if (!this.disposed) this.syncBonusNodes(); });
    sim.on('lootDrops', () => { if (!this.disposed) this.syncLootDrops(); });
    sim.on('structDestroyed', (b, st) => {
      if (this.disposed) return;
      const p = sim.structWorld(b, st);
      if (Math.hypot(p.x - game.camera.position.x, p.z - game.camera.position.z) < 450) {
        const y = game.terrain.heightAt(p.x, p.z);
        game.fx.explosion(p.x, y + 2, p.z, 1.6);
        game.fx.wreckDebris(p.x, y, p.z, '#8d99ae', 10);
        game.audio?.play('bigexplosion', new THREE.Vector3(p.x, y, p.z));
      }
    });
    sim.on('baseDestroyed', (b) => { if (!this.disposed) this.onBaseDestroyed(b); });
    this.syncBonusNodes();
    this.syncLootDrops();
  }

  playerCars() {
    const out = [];
    for (const c of this.game.cars) if (c.isPlayer || c.isRemotePlayer) out.push(c);
    return out;
  }

  nearestPlayerDist(x, z) {
    let d = Infinity;
    for (const c of this.playerCars()) d = Math.min(d, Math.hypot(c.body.pos.x - x, c.body.pos.z - z));
    return d;
  }

  syncBonusNodes() {
    const st = this.sim.s.story;
    for (const n of st.bonusNodes || []) {
      if (this.game.pickups.nodes.some((x) => x.id === n.id)) continue;
      this.game.pickups.nodes.push({ ...n, type: n.type || NODE_TYPES[n.res], y: this.game.terrain.heightAt(n.x, n.z), active: true, respawn: 0, bonus: true });
    }
  }
  syncLootDrops() {
    const st = this.sim.s.story;
    for (const d of st.lootDrops || []) { this.game.pickups.drop(d.x, d.z, d.loot, { life: 900, type: 'lootCrate' }); }
    st.lootDrops = [];
  }

  update(dt) {
    const g = this.game, sim = this.sim;
    if (!sim.s || this.disposed) return;
    if (sim.isReplica) return; // co-op clients get cars from the host
    this.t -= dt;
    // per frame: steer physical squads
    for (const sq of Object.values(sim.s.squads)) if (sq.physical) this.driveSquad(sq, dt);
    if (this.t > 0) return;
    this.t = 0.5;
    const players = this.playerCars();
    if (!players.length) return;
    // squads
    for (const sq of Object.values(sim.s.squads)) {
      const lead = sq.physical ? this.leaderCar(sq) : null;
      const x = lead ? lead.body.pos.x : sq.x, z = lead ? lead.body.pos.z : sq.z;
      const d = this.nearestPlayerDist(x, z);
      const escort = sq.task.type === 'escort';
      if (!sq.physical && (d < PHYS_R || escort)) this.materialize(sq);
      else if (sq.physical && d > PHYS_R_OUT && !escort) this.dematerialize(sq);
    }
    // garrisons: guard cars only roll out when a player is close, or further out if a battle is on at the gates
    for (const b of Object.values(sim.s.bases)) {
      const d = this.nearestPlayerDist(b.x, b.z);
      const active = this.guardBases.get(b.id);
      const battle = !!sim.s.squads[b.siegedBy]?.physical;
      if (!active && d < (battle ? PHYS_R * 0.85 : GUARD_R)) this.spawnGuards(b);
      else if (active && d > (battle ? PHYS_R_OUT * 0.9 : GUARD_R_OUT)) this.despawnGuards(b, true);
      b.physical = d < PHYS_R * 0.85;
      const set = this.guardBases.get(b.id);
      if (set?.size) {
        // a guard called up into a squad now rides with that squad
        for (const id of set) if (sim.s.npcs[id]?.squadId) { const c = this.npcCars.get(id); if (c) { c.guard = false; c.guardBase = null; } set.delete(id); }
        // break formation to defend when the base is hit; re-form (or pick a new patrol leader) otherwise
        const alarmed = b.alarm > 0;
        const leadOk = set.lead?.alive && set.has(set.lead.npcId);
        if (alarmed !== set.alarmed || (!alarmed && !leadOk)) { set.alarmed = alarmed; this.assignGuardOrders(b, set); }
      }
    }
    // clean up wrecks and stray cars
    for (const c of [...g.cars]) {
      if (!c.alive && g.time - c.deathTime > 9 && !c.isPlayer && !c.isRemotePlayer) g.removeCar(c);
      else if (c.npcId && c.alive && !c.guard) {
        const n = sim.s.npcs[c.npcId];
        if (!n || !n.alive || !n.squadId || !sim.s.squads[n.squadId]?.physical) {
          // a squad disbanded under them (e.g. base captured): leave quietly when unseen
          if (this.nearestPlayerDist(c.body.pos.x, c.body.pos.z) > 260 || !n?.alive) this.despawnCar(c, n);
          else if (c.ai && n && n.baseId && sim.s.bases[n.baseId]) { const b = sim.s.bases[n.baseId]; c.ai.setOrder({ type: 'goto', x: b.x, z: b.z, speed: 0.6 }); }
        }
      }
    }
    this.updateTraffic();
  }

  leaderCar(sq) {
    for (const m of sq.members) { const c = this.npcCars.get(m); if (c && c.alive) return c; }
    return null;
  }

  spawnNpcCar(n, x, z, heading, extra = {}) {
    const g = this.game;
    if (this.npcCars.has(n.id)) return this.npcCars.get(n.id);
    let tries = 0;
    while (tries++ < 8 && (g.solidNear(x, z, 4) || g.terrain.liquidAt(x, z)?.depth > 1)) { x += (Math.random() - 0.5) * 16; z += (Math.random() - 0.5) * 16; }
    const f = this.sim.s.factions[n.factionId];
    const car = g.spawnCar({
      id: `npc_${n.id}`, npcId: n.id, name: n.name, design: n.design, team: n.factionId || 'scavvers', x, z, heading,
      ai: { order: extra.order || { type: 'idle' }, skill: n.skill, courage: n.courage, aggro: extra.aggro ?? 170 },
      squadId: extra.squadId || null, role: n.role,
    });
    car.hp = Math.max(car.stats.hp * 0.15, car.stats.hp * n.hp);
    car.fuel = car.stats.fuelCap;
    car.guard = !!extra.guard;
    car.factionColor = f?.color;
    car.title = n.epithet ? `${n.name}, ${n.epithet}` : n.role === 'leader' ? `${n.title || ''} ${n.name}` : n.name;
    car.vip = n.role === 'leader' || n.role === 'lieutenant' || !!n.epithet;
    car.lootCaps = n.role === 'lieutenant' ? 40 : n.epithet ? 60 : 0;
    this.npcCars.set(n.id, car);
    return car;
  }

  despawnCar(car, n) {
    if (n && car.alive) n.hp = Math.max(0.05, car.hp / car.stats.hp);
    this.npcCars.delete(car.npcId);
    this.game.removeCar(car);
  }

  materialize(sq) {
    const sim = this.sim;
    const members = sq.members.map((m) => sim.s.npcs[m]).filter((n) => n?.alive);
    if (!members.length) return;
    sq.physical = true;
    let heading = Math.atan2(sq.tx - sq.x, sq.tz - sq.z);
    let x0 = sq.x, z0 = sq.z, slots;
    const p = sq.task.type === 'escort' ? this.game.player?.car : null;
    if (p) {
      // escorts fall in behind the player
      x0 = p.body.pos.x; z0 = p.body.pos.z; heading = p.body.heading();
      slots = formationSlots([p.stats.size, ...members.map(sizeOf)], 'wedge', 5).slice(1);
    } else slots = formationSlots(members.map(sizeOf), shapeOf(sq));
    // appear already in formation
    members.forEach((n, i) => {
      const [ox, oz] = slotOffset(heading, slots[i]);
      this.spawnNpcCar(n, x0 + ox, z0 + oz, heading, { squadId: sq.id });
    });
    this.assignOrders(sq);
  }

  dematerialize(sq) {
    const lead = this.leaderCar(sq);
    if (lead) { sq.x = lead.body.pos.x; sq.z = lead.body.pos.z; }
    for (const m of sq.members) {
      const c = this.npcCars.get(m);
      if (c) this.despawnCar(c, this.sim.s.npcs[m]);
    }
    sq.physical = false;
  }

  assignOrders(sq) {
    const sim = this.sim;
    const t = sq.task;
    const cars = sq.members.map((m) => this.npcCars.get(m)).filter((c) => c && c.alive);
    if (!cars.length) return;
    const lead = cars[0];
    let order;
    const playerCar = this.game.player?.car;
    const escort = t.type === 'escort' && playerCar;
    if (sq.wait > 0) order = { type: 'idle' };
    else if (escort) order = { type: 'follow', leader: playerCar, aggro: 160 };
    else if (sq.state === 'returning' || sq.retreating) order = { type: 'goto', x: sq.tx, z: sq.tz, speed: 0.85, noFlee: true, aggro: 60 };
    else if ((t.type === 'attack' || t.type === 'raidBase') && sim.s.bases[t.targetBaseId]) {
      const b = sim.s.bases[t.targetBaseId];
      const d = Math.hypot(lead.body.pos.x - b.x, lead.body.pos.z - b.z);
      if (d < 110 || sq.state === 'fighting') { order = { type: 'siege', baseId: b.id, x: b.x, z: b.z, r: (b.size * TILE) / 2 + 22, aggro: 200, noFlee: false }; sq.state = 'fighting'; b.siegedBy = sq.id; }
      else order = { type: 'goto', x: b.x, z: b.z, speed: 0.9, aggro: 120 };
    } else if (t.type === 'hunt') {
      const pc = this.nearestPlayerCar(lead.body.pos);
      order = { type: 'goto', x: pc ? pc.body.pos.x : sq.tx, z: pc ? pc.body.pos.z : sq.tz, speed: 1, aggro: 260 };
    } else {
      const slow = t.type === 'convoy' || t.type === 'trade';
      order = { type: 'goto', x: sq.tx, z: sq.tz, speed: slow ? 0.6 : sq.duel ? 0.3 : 0.75, aggro: slow ? 90 : 150, slowNear: false };
      // convoys and caravans should not drive into the Hub walls
      if (t.type === 'trade' && Math.hypot(sq.tx, sq.tz) < HUB_SAFE_R + 10) { const a = Math.atan2(lead.body.pos.z, lead.body.pos.x); order.x = Math.cos(a) * 215; order.z = Math.sin(a) * 215; }
    }
    if (order.type === 'goto' && cars.length > 1) {
      // the group moves at the pace of its slowest car and eases off while anyone is out of formation
      const slowest = Math.min(...cars.map((c) => c.stats.topSpeed));
      order.speed = Math.min(order.speed ?? 1, (0.85 * slowest) / Math.max(1, lead.stats.topSpeed));
      if (cars.some((c, i) => i && c.ai && !c.ai.target?.alive && c.ai.slotDist > 45)) order.speed *= 0.4;
    }
    if (escort) {
      const slots = formationSlots([playerCar.stats.size, ...cars.map((c) => c.stats.size)], 'wedge', 5);
      cars.forEach((c, i) => c.ai?.setOrder({ ...order, offset: slots[i + 1] }));
    } else {
      const slots = formationSlots(cars.map((c) => c.stats.size), shapeOf(sq));
      cars.forEach((c, i) => {
        if (!c.ai) return;
        if (i === 0 || order.type !== 'goto') c.ai.setOrder({ ...order });
        else c.ai.setOrder({ type: 'follow', leader: lead, offset: slots[i], aggro: order.aggro });
      });
    }
    sq._orderType = order.type;
  }

  nearestPlayerCar(pos) {
    let best = null, bd = Infinity;
    for (const c of this.playerCars()) { if (!c.alive) continue; const d = c.body.pos.distanceTo(pos); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  driveSquad(sq, dt) {
    const sim = this.sim;
    sq.members = sq.members.filter((m) => sim.s.npcs[m]?.alive);
    if (!sq.members.length) { sim.squadWiped(sq); return; }
    const lead = this.leaderCar(sq);
    if (!lead) return;
    sq.x = lead.body.pos.x; sq.z = lead.body.pos.z;
    if (sq.wait > 0) { sq.wait -= dt; if (sq.wait <= 0) this.assignOrders(sq); return; }
    sq._reorder = (sq._reorder || 0) - dt;
    if (sq._reorder <= 0) { sq._reorder = 1.5; this.assignOrders(sq); }
    const t = sq.task;
    // arrival checks
    const d = Math.hypot(sq.tx - sq.x, sq.tz - sq.z);
    if (sq.retreating || sq.state === 'returning') { if (d < 40) sim.squadArrived(sq); return; }
    if (t.type === 'attack' || t.type === 'raidBase') {
      if (!sim.s.bases[t.targetBaseId]) return;
      if (sq.state === 'fighting') {
        sq.battleT += dt;
        const att = sq.members.map((m) => sim.s.npcs[m]);
        for (const n of att) { const c = this.npcCars.get(n.id); if (c) n.hp = Math.max(0.01, c.hp / c.stats.hp); }
        const f = sim.s.factions[sq.factionId];
        const now = combatValue(sim.groupCombat(att));
        if (now < (sq.startValue || 1) * (0.15 + (f?.traits?.caution ?? 0.5) * 0.2) || sq.battleT > 420) sim.squadReturn(sq);
      }
      return;
    }
    if (t.type === 'escort' || t.type === 'hunt') return;
    // caravans sell once they reach the Hub walls (they are steered to the gate, not the centre)
    const there = t.type === 'trade' ? Math.hypot(sq.x, sq.z) < HUB_SAFE_R + 40 : d < (t.type === 'convoy' || t.type === 'reinforce' ? 45 : 30);
    if (there) {
      sim.squadArrived(sq);
      if (sim.s.squads[sq.id]) this.assignOrders(sq);
    }
  }

  spawnGuards(b) {
    const sim = this.sim;
    const set = new Set();
    this.guardBases.set(b.id, set);
    // leaders only ride out to defend their own capital (a boss fight worth remembering), at the head of the patrol
    const gar = sim.garrison(b).filter((n) => n.role !== 'leader' || b.capital).sort((a, c) => (c.role === 'leader') - (a.role === 'leader')).slice(0, Math.min(3, 1 + b.level));
    if (!gar.length) return;
    // roll out in formation on the far side of the compound from the nearest player
    let pd = Infinity, pa = 0;
    for (const c of this.playerCars()) { const d = Math.hypot(c.body.pos.x - b.x, c.body.pos.z - b.z); if (d < pd) { pd = d; pa = Math.atan2(c.body.pos.z - b.z, c.body.pos.x - b.x); } }
    const a = pa + Math.PI, r = guardRing(b);
    const h = Math.atan2(-Math.sin(a), Math.cos(a)); // tangent, counter-clockwise like the patrol loop
    const slots = formationSlots(gar.map(sizeOf), 'column');
    gar.forEach((n, i) => {
      const [ox, oz] = slotOffset(h, slots[i]);
      const car = this.spawnNpcCar(n, b.x + Math.cos(a) * r + ox, b.z + Math.sin(a) * r + oz, h, { guard: true, aggro: 130 });
      car.guard = true;
      car.guardBase = b.id;
      set.add(n.id);
    });
    set.alarmed = b.alarm > 0;
    this.assignGuardOrders(b, set);
  }

  // Guards patrol as one group: the first drives a slow loop round the compound, the rest hold formation on it.
  // Under attack they scatter and defend the base on their own.
  assignGuardOrders(b, set) {
    const cars = [...set].map((id) => this.npcCars.get(id)).filter((c) => c?.alive && c.ai);
    const lead = cars[0];
    set.lead = lead || null;
    if (!lead) return;
    const r = guardRing(b);
    if (set.alarmed) {
      for (const c of cars) { c.ai.aggro = 240; c.ai.setOrder({ type: 'guard', x: b.x, z: b.z, r: r + 4 }); }
      return;
    }
    const a0 = Math.atan2(lead.body.pos.z - b.z, lead.body.pos.x - b.x);
    const points = [];
    for (let k = 1; k <= 8; k++) { const a = a0 + (k / 8) * Math.PI * 2; points.push([b.x + Math.cos(a) * r, b.z + Math.sin(a) * r]); }
    lead.ai.aggro = 130;
    lead.ai.setOrder({ type: 'patrol', points, i: 0, x: points[0][0], z: points[0][1], speed: 0.28, radius: 12 });
    // single file: a wedge's inner wing would cut through the compound on such a tight loop
    const slots = formationSlots(cars.map((c) => c.stats.size), 'column');
    cars.forEach((c, i) => { if (i) { c.ai.aggro = 130; c.ai.setOrder({ type: 'follow', leader: lead, offset: slots[i] }); } });
  }

  // onlyUnseen: guards still near a player (say, chasing them) stay until they are out of sight
  despawnGuards(b, onlyUnseen = false) {
    const set = this.guardBases.get(b.id);
    if (set) for (const id of [...set]) {
      const c = this.npcCars.get(id);
      if (onlyUnseen && c?.alive && this.nearestPlayerDist(c.body.pos.x, c.body.pos.z) < 220) continue;
      if (c && c.guard) this.despawnCar(c, this.sim.s.npcs[id]);
      set.delete(id);
    }
    if (!onlyUnseen || !set?.size) this.guardBases.delete(b.id);
  }

  onBaseDestroyed(b) {
    const sim = this.sim;
    this.despawnGuards(b);
    for (const sq of Object.values(sim.s.squads)) {
      if (sq.physical && sq.task.targetBaseId === b.id && sq.state === 'fighting') sim.siegeWon(sq, b);
    }
  }

  onKill(car, killer) {
    const sim = this.sim, g = this.game;
    if (car.isPlayer || car.isRemotePlayer) { g.emit('playerDied', car, killer); return; }
    if (car.traffic) return;
    if (!car.npcId) return;
    const n = sim.s.npcs[car.npcId];
    this.npcCars.delete(car.npcId);
    const byGroup = !!(killer && (killer.isPlayer || killer.isRemotePlayer));
    if (n) sim.killNpc(n, { team: killer?.team, byGroup, car: true });
    if (car.guardBase) this.guardBases.get(car.guardBase)?.delete(car.npcId);
    if (byGroup) g.emit('playerKill', car, n, killer);
  }

  // Ambient Hub traffic: a few harmless locals pottering about inside the walls
  updateTraffic() {
    const g = this.game;
    const pc = g.player?.car;
    if (!pc) return;
    const near = Math.hypot(pc.body.pos.x, pc.body.pos.z) < PHYS_R;
    this.traffic = this.traffic.filter((c) => !c.removed);
    if (!near) { for (const c of this.traffic) g.removeCar(c); this.traffic = []; return; }
    // a local that wandered out of town and out of sight goes home for good
    for (const c of this.traffic) if (Math.hypot(c.body.pos.x, c.body.pos.z) > 230 && c.body.pos.distanceTo(pc.body.pos) > 150) g.removeCar(c);
    this.traffic = this.traffic.filter((c) => !c.removed);
    while (this.traffic.length < 3) {
      const a = Math.random() * Math.PI * 2;
      const colors = ['#ef476f', '#06d6a0', '#118ab2', '#ffd166', '#8338ec', '#fb5607'];
      const ch = ['buggy', 'coupe', 'pickup', 'van'][Math.floor(Math.random() * 4)];
      const car = g.spawnCar({
        name: 'Local', team: 'hub', x: Math.cos(a) * 90, z: Math.sin(a) * 90, heading: Math.random() * 6,
        design: { name: 'Local', chassis: ch, engine: 'v4', wheels: 'standard', armor: 'none', weapons: [], utils: [], paint: colors[Math.floor(Math.random() * colors.length)], paint2: '#ffffff' },
        ai: { order: { type: 'idle' }, skill: 0.5, aggro: 0 },
      });
      car.traffic = true;
      car.title = '';
      this.traffic.push(car);
    }
    for (const c of this.traffic) {
      if (!c.ai) continue;
      const out = Math.hypot(c.body.pos.x, c.body.pos.z) > 170;
      if (out ? !c.ai.order.home : c.ai.arrived || c.ai.order.type === 'idle' || Math.random() < 0.01) {
        // destinations stay well inside the wall ring; strays are turned back toward the middle
        const a = out ? Math.atan2(c.body.pos.z, c.body.pos.x) : Math.random() * Math.PI * 2, r = out ? 90 : 50 + Math.random() * 100;
        c.ai.arrived = false;
        c.ai.setOrder({ type: 'goto', x: Math.cos(a) * r, z: Math.sin(a) * r, speed: 0.35, aggro: 0, home: out });
      }
    }
  }
}

export { STRUCTS };
