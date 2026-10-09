// The Storyteller: a director that pulls events "from a hat", runs premade story arcs, then generates
// procedural arcs forever. It paces tension and makes sure the player is the main character.
import { Sim } from './sim.js';
import { DAY_LEN, STRUCTS, HUB_QUIET_R } from './defs.js';
import { genFaction, genDriverName } from './lore.js';
import { PRESET_DESIGNS } from '../vehicle/parts.js';
import { RES_INFO } from '../world/biomes.js';
import { unitPrice } from './economy.js';

const P = Sim.prototype;

// ---------- offers (choice dialogs for the player) ----------
P.offer = function (o) {
  const g = this.s.group;
  const id = this.id('o');
  const off = { id, created: this.s.time, expires: this.s.time + (o.ttl ?? DAY_LEN * 0.6), ...o };
  g.offers.push(off);
  this.emit('offer', off);
  return off;
};

P.answerOffer = function (id, choiceIdx) {
  const g = this.s.group;
  const off = g.offers.find((o) => o.id === id);
  if (!off) return { ok: false, msg: 'Offer expired' };
  g.offers = g.offers.filter((o) => o !== off);
  const ch = off.choices[choiceIdx];
  if (!ch) return { ok: false };
  if (ch.cost && g.wallet < ch.cost) { g.offers.push(off); return { ok: false, msg: 'Not enough caps' }; }
  if (ch.cost) g.wallet -= ch.cost;
  const res = ch.action ? this.runAction(ch.action, off) : null;
  return { ok: true, msg: res?.msg || ch.result || '' };
};

// Serializable actions
P.runAction = function (a, ctx) {
  const s = this.s;
  if (!a) return null;
  if (Array.isArray(a)) { let r = null; for (const x of a) r = this.runAction(x, ctx) || r; return r; }
  switch (a.type) {
    case 'accept': return this.acceptMission(a.missionId);
    case 'rep': this.changeRep(a.fid, a.n); return null;
    case 'caps': s.group.wallet += a.n; return null;
    case 'rel': this.addRel(a.a, a.b, a.n); return null;
    case 'stage': return this.scheduleStage(a.arc, a.stage, a.delay ?? 0, a.ctx);
    case 'pact': this.setPact(a.a, a.b, a.pact, a.name || (a.pact === 'alliance' ? this.allianceName(s.factions[a.a], s.factions[a.b]) : null)); if (a.pact === 'alliance') this.chronicle('alliance', { a: s.factions[a.a], b: s.factions[a.b], name: this.pactInfo(a.a, a.b)?.name }); return null;
    case 'betray': { const A = s.factions[a.a], B = s.factions[a.b]; if (A && B) this.betrayAlly(A, B, { byPlayer: !!a.byPlayer }); return null; }
    case 'deed': this.addDeed(a.kind, a.n || 1); return null;
    case 'tier': s.group.unlocked.tier = Math.max(s.group.unlocked.tier, a.tier); this.emit('unlock', `Tier ${a.tier} parts`); return null;
    case 'unlock': for (const p of [].concat(a.parts)) if (!s.group.unlocked.extra.includes(p)) s.group.unlocked.extra.push(p); this.emit('unlock', a.label || a.parts.join(', ')); return null;
    case 'chronicle': this.chronicle('event', a); return null;
    case 'war': { const A = s.factions[a.a], B = s.factions[a.b]; if (A && B && !this.atWar(A.id, B.id)) { this.setPact(A.id, B.id, 'war'); this.chronicle('war', { a: A, b: B }); } return null; }
    case 'attack': { const A = s.factions[a.a]; const b = s.bases[a.baseId]; if (A && b) { const fs = this.availableFighters(A).slice(0, a.n || 6); if (fs.length) this.createSquad(A.id, fs.map((n) => n.id), { type: 'attack', targetBaseId: b.id, zoneId: b.zoneId }, { name: a.name, wait: a.wait || 30 }); } return null; }
    case 'payTribute': { const A = s.factions[a.to]; if (s.group.wallet >= a.caps) { s.group.wallet -= a.caps; if (A) A.treasury += a.caps; this.changeRep(a.to, 10); return { msg: 'Tribute paid.' }; } return { msg: 'You cannot afford it! They take it as a refusal.' }; }
    case 'joinOffer': return this.cmdJoinFaction?.(a.fid, true);
    case 'recruitNpc': { const n = s.npcs[a.npcId]; if (n && s.group.factionId) { this.adoptNpc(n); return { msg: `${n.name} joins you.` }; } return { msg: 'You need your own faction to take them in.' }; }
    default: return null;
  }
};

// ---------- arcs ----------
P.scheduleStage = function (arc, stage, delay, ctx = {}) {
  this.s.story.arcs.push({ arc, stage, at: this.s.time + delay, ctx });
  return null;
};

P.storyTick = function (dt) {
  const st = this.s.story;
  // run due arc stages
  const due = st.arcs.filter((a) => a.at <= this.s.time);
  if (due.length) {
    st.arcs = st.arcs.filter((a) => a.at > this.s.time);
    for (const a of due) {
      const fn = ARCS[a.arc]?.[a.stage];
      if (fn) { try { fn.call(this, a.ctx || {}); } catch (e) { console.error('arc', a.arc, a.stage, e); } }
    }
  }
  // expire offers
  this.s.group.offers = this.s.group.offers.filter((o) => {
    if (o.expires > this.s.time) return true;
    if (o.onExpire) this.runAction(o.onExpire, o);
    return false;
  });
  // weather & market mods decay
  if (st.marketMods && st.marketModsUntil < this.s.time) { st.marketMods = null; }
  // tension builds over time, more with wars
  const wars = Object.values(this.s.pacts).filter((p) => p.type === 'war').length;
  st.tension = Math.min(1, st.tension + dt * (0.0009 + wars * 0.00012));
  if (this.s.time >= st.nextEventAt) this.pullFromHat();
  this.loyaltyTick?.(dt);
};

P.pullFromHat = function () {
  const st = this.s.story;
  const day = this.day;
  const candidates = [];
  for (const card of CARDS) {
    if ((card.minDay || 0) > day) continue;
    if (card.once && st.fired[card.id]) continue;
    if (st.cooldowns[card.id] && st.cooldowns[card.id] > this.s.time) continue;
    let ctx = null;
    try { ctx = card.prepare ? card.prepare.call(this) : {}; } catch (e) { console.error(card.id, e); }
    if (!ctx) continue;
    let w = typeof card.weight === 'function' ? card.weight.call(this, ctx) : card.weight ?? 1;
    // big events when tension is high, small ones when calm
    const big = card.big ? 1 : 0;
    w *= big ? 0.3 + st.tension * 2 : 1.2 - st.tension * 0.5;
    if (card.premade) w *= 2.2; // premade story first
    if (card.proc) w *= 0.4 + Math.min(2, this.premadeExhaustion() * 2);
    if (w > 0) candidates.push({ card, ctx, w });
  }
  const pick = this.rng.weighted(candidates, (c) => c.w);
  // pacing: 2.5-6 minutes between events, faster when tension is low (things should happen)
  st.nextEventAt = this.s.time + this.rng.range(150, 330) * (0.8 + st.tension * 0.5);
  if (!pick) return;
  st.fired[pick.card.id] = (st.fired[pick.card.id] || 0) + 1;
  st.cooldowns[pick.card.id] = this.s.time + (pick.card.cooldown ?? DAY_LEN);
  st.eventCount++;
  if (pick.card.big) st.tension = Math.max(0, st.tension - 0.45);
  else st.tension = Math.max(0, st.tension - 0.08);
  try { pick.card.run.call(this, pick.ctx); } catch (e) { console.error('event', pick.card.id, e); }
  this.emit('storyEvent', pick.card.id);
};

P.premadeExhaustion = function () {
  const pre = CARDS.filter((c) => c.premade);
  return pre.filter((c) => this.s.story.fired[c.id]).length / pre.length;
};

// Fairness: who may attack the player's bases, when, and how hard
P.director_playerAttackGate = function (f, b) {
  const s = this.s;
  if (this.day < 4) return false;
  const pf = s.factions[b.factionId];
  if (!pf?.isPlayer) return true;
  // only one warband at a time hunts the player's bases
  const busy = Object.values(s.squads).some((q) => q.task.type === 'attack' && s.bases[q.task.targetBaseId]?.factionId === pf.id);
  if (busy) return false;
  if (s.time - (pf.lastAttackedAt || -9999) < DAY_LEN * 0.8) return false;
  // warn first, attack later
  if (!b.warnedBy || b.warnedBy !== f.id || s.time - b.warnedAt < 90) {
    if (b.warnedBy !== f.id || s.time - b.warnedAt > DAY_LEN) {
      b.warnedBy = f.id; b.warnedAt = s.time;
      this.emit('warning', `${f.short} scouts were spotted near ${b.name}. An attack is coming — get back and defend it!`, b);
    }
    return false;
  }
  pf.lastAttackedAt = s.time;
  return true;
};

// ---------- recruits' loyalty in the player's faction ----------
P.payGroupWages = function () {
  const s = this.s;
  const f = s.factions[s.group.factionId];
  if (!f || !f.isPlayer) return;
  const mem = this.members(f.id);
  const total = mem.reduce((t, n) => t + n.wage, 0);
  if (s.group.wallet >= total) {
    s.group.wallet -= total;
    for (const n of mem) { n.unpaid = 0; n.loyalty = Math.min(100, n.loyalty + 2 + (n.greed < 0.4 ? 1 : 0)); }
    if (total > 0) this.emit('payday', total, mem.length);
  } else {
    // pay who we can, most loyal first
    let left = s.group.wallet;
    for (const n of mem.sort((a, b) => b.loyalty - a.loyalty)) {
      if (left >= n.wage) { left -= n.wage; n.unpaid = 0; } else { n.unpaid++; n.loyalty -= 10 + n.greed * 10; }
    }
    s.group.wallet = left;
    this.emit('unpaid', mem.filter((n) => n.unpaid > 0).length);
  }
};

P.loyaltyChecks = function () {
  const s = this.s;
  const desertions = {};
  for (const n of Object.values(s.npcs)) {
    if (!n.alive || !n.factionId || n.role === 'leader') continue;
    const f = s.factions[n.factionId];
    if (!f || f.bandit) continue;
    n.loyalty = Math.max(0, Math.min(100, n.loyalty + (n.loyaltyTrait - 0.5) * 2));
    if (n.loyalty > 25) continue;
    if ((desertions[f.id] || []).length >= 2) continue;
    if (this.rng.next() > 0.35 * (1 - n.loyaltyTrait)) continue;
    // betray: defect to a rival, maybe stealing from stores
    const rivals = Object.values(s.factions).filter((o) => o.alive && o.id !== f.id && !o.bandit && !o.isPlayer && (this.atWar(f.id, o.id) || this.rel(f.id, o.id) < 0));
    const to = rivals.length ? this.rng.pick(rivals) : null;
    let stole = null;
    const home = s.bases[n.baseId];
    if (home && n.greed > 0.5) {
      const res = Object.entries(home.storage).sort((a, b) => b[1] - a[1])[0];
      if (res && res[1] > 10) { const amt = Math.floor(res[1] * 0.4); home.storage[res[0]] -= amt; stole = `${amt} ${RES_INFO[res[0]].name.toLowerCase()}`; }
    }
    if (n.squadId) { const sq = s.squads[n.squadId]; if (sq) sq.members = sq.members.filter((m) => m !== n.id); n.squadId = null; }
    if (f.isPlayer) this.chronicle('recruitBetrayal', { n, to, stole });
    (desertions[f.id] ||= []).push({ n, to });
    if (to) { n.factionId = to.id; n.baseId = this.capital(to.id)?.id || null; n.loyalty = 60; this.addRel(f.id, to.id, -5); }
    else { n.factionId = null; n.baseId = null; s.recruitPool.push(n.id); }
    this.emit('betrayedBy', n, f, to);
  }
  for (const [fid, list] of Object.entries(desertions)) {
    const f = s.factions[fid];
    if (f.isPlayer || !list.length) continue;
    const to = list[0].to;
    this.chronicle('defection', { from: f, to, n: list[0].n, count: list.length });
  }
};

P.loyaltyTick = function () {};

P.adoptNpc = function (n) {
  const s = this.s;
  const f = s.factions[s.group.factionId];
  if (!f) return;
  n.factionId = f.id;
  n.role = n.role === 'leader' ? 'lieutenant' : n.role === 'recruit' ? 'driver' : n.role;
  n.squadId = null;
  n.loyalty = Math.max(n.loyalty, 55);
  n.baseId = this.capital(f.id)?.id || null;
  n.joined = this.day;
  this.emit('recruited', n);
};

// ---------- helpers ----------
function aliveFactions(sim, filter = () => true) { return Object.values(sim.s.factions).filter((f) => f.alive && !f.bandit && filter(f)); }
function playerIn(sim, fid) { return sim.s.group.factionId === fid; }
function q(f) { return f.quotes?.length ? f.quotes[Math.floor(Math.random() * f.quotes.length)] : '...'; }

// ---------- premade arcs & procedural arc stages ----------
const ARCS = {
  betrayal: {
    strike(ctx) {
      const A = this.s.factions[ctx.a], B = this.s.factions[ctx.b];
      if (!A?.alive || !B?.alive || this.pact(A.id, B.id) !== 'alliance') return;
      if (ctx.foiled) { this.chronicle('event', { title: `The Plot Against the ${B.short} Is Exposed`, text: `${this.leaderName(A)} planned to stab the ${B.name} in the back, but the plan leaked. Both sides now glare across the border.`, importance: 2, factions: [A.id, B.id] }); this.setPact(A.id, B.id, null); this.addRel(A.id, B.id, -40); return; }
      this.betrayAlly(A, B);
    },
  },
  oil_schism: {
    sermon() {
      const S = this.s.factions.saints, B = this.s.factions.barons;
      if (!S?.alive || !B?.alive) return;
      this.addRel('saints', 'barons', -25);
      this.chronicle('event', { title: 'The Sermon of the Burning Well', text: `Mother Gasket climbed a pumpjack at Gusher Gulch and declared every barrel of Baron oil "unholy runoff". "${q(S)}" The congregation cheered. In Whitesalt, Baron Brackwater quietly hired more guards.`, importance: 2, factions: ['saints', 'barons'] });
      const target = this.factionBases('barons').find((b) => b.structs.some((st) => st.type === 'pump'));
      if (target) {
        const cnt = target.structs.filter((st) => st.type === 'pump').length;
        const m = this.createMission({ giver: 'saints', type: 'sabotage', title: 'Purge the Unholy Pumps', desc: `Mother Gasket wants the Baron pumpjacks at ${target.name} silenced. "Bring me the silence of their engines."`, obj: { kind: 'destroyStructs', baseId: target.id, structType: 'pump', count: Math.min(2, cnt), startCount: cnt, x: target.x, z: target.z }, reward: { caps: 260, rep: { saints: 20, barons: -25 } }, expires: this.s.time + DAY_LEN * 2 });
        const m2 = this.createMission({ giver: 'barons', type: 'protect', title: 'Insurance Policy', desc: `Baron Brackwater will pay handsomely if ${target.name} survives the Saints' zeal. Be there when they come.`, obj: { kind: 'reach', x: target.x, z: target.z, r: 120 }, reward: { caps: 220, rep: { barons: 15, saints: -10 } }, expires: this.s.time + DAY_LEN * 2 });
        this.offer({ from: 'saints', title: 'A Holy Task', text: `"The Barons pump heresy from the ground at ${target.name}. Will you be the hand of the Engine?" — Mother Gasket`, choices: [{ label: 'Witness me! (accept)', action: { type: 'accept', missionId: m.id } }, { label: 'Warn the Barons instead', action: [{ type: 'accept', missionId: m2.id }, { type: 'rep', fid: 'saints', n: -8 }] }, { label: 'Stay out of it' }] });
      }
      this.scheduleStage('oil_schism', 'crusade', DAY_LEN * 0.8);
    },
    crusade() {
      const S = this.s.factions.saints, B = this.s.factions.barons;
      if (!S?.alive || !B?.alive) return;
      if (!this.atWar('saints', 'barons')) { this.setPact('saints', 'barons', 'war'); }
      const target = this.factionBases('barons').sort((a, b) => (this.zoneDef(b.zoneId).richness.fuel || 0) - (this.zoneDef(a.zoneId).richness.fuel || 0))[0];
      if (target) this.runAction({ type: 'attack', a: 'saints', baseId: target.id, n: 8, name: 'Crusade of the Combustion', wait: 60 });
      this.chronicle('event', { title: 'The Oil Crusade', text: `Chrome cars poured out of Gusher Gulch singing hymns to the Engine. Their target: the Baron wells${target ? ` at ${target.name}` : ''}. Petrol prices jumped before the first shot was fired.`, importance: 3, factions: ['saints', 'barons'] });
      this.s.story.marketMods = { supply: { fuel: 0.5 }, demand: { fuel: 1.4, ammo: 1.6 } };
      this.s.story.marketModsUntil = this.s.time + DAY_LEN;
    },
  },
  rat_gambit: {
    plot() {
      const R = this.s.factions.rats, M = this.s.factions.rustclaw;
      if (!R?.alive || !M?.alive) return;
      const rb = this.capital('rats');
      const collectors = this.availableFighters(M).slice(0, 3);
      if (!rb || collectors.length < 2) return;
      const sq = this.createSquad('rustclaw', collectors.map((n) => n.id), { type: 'patrol', zoneId: rb.zoneId, x: rb.x + 60, z: rb.z + 60, legs: 6 }, { name: 'Rustclaw tithe collectors', wait: 120 });
      const m = this.createMission({ giver: 'rats', type: 'ambush', title: 'The Rat\'s Gambit', desc: `Lil' Spanner wants Mama Rustclaw's tithe collectors ambushed near ${rb.name}. "Nobody misses a few collectors, right? RIGHT?"`, obj: { kind: 'killSquad', squadId: sq.id, x: rb.x, z: rb.z }, reward: { caps: 200, rep: { rats: 30, rustclaw: -35 } }, onComplete: { type: 'stage', arc: 'rat_gambit', stage: 'ratsWin', delay: 20 }, expires: this.s.time + DAY_LEN });
      this.offer({ from: 'rats', title: 'Lil\' Spanner Has a Proposition', text: `A kid with three missing teeth slides into the seat next to you. "Mama Rust takes half of everything we find. Help me ambush her collectors and the Rats will owe you. Big time. Also 200 caps."`, choices: [{ label: 'You\'re on, kid', action: { type: 'accept', missionId: m.id } }, { label: 'Rat the Rats out to Mama', action: [{ type: 'rep', fid: 'rustclaw', n: 25 }, { type: 'rep', fid: 'rats', n: -40 }, { type: 'stage', arc: 'rat_gambit', stage: 'mamaKnows', delay: 30 }], result: 'Mama Rustclaw will remember this kindness. The Rats will remember too.' }, { label: 'Not my business' }] });
    },
    ratsWin() {
      const R = this.s.factions.rats, M = this.s.factions.rustclaw;
      if (!R?.alive || !M?.alive) return;
      this.setPact('rats', 'rustclaw', 'war');
      R.traits.ambition = Math.min(1, R.traits.ambition + 0.1);
      this.chronicle('event', { title: 'The Rust Tithe Is Broken', text: `Mama Rustclaw's collectors were found as smoking scrap outside Old Suburbia. Lil' Spanner announced, to nobody's surprise, that the Rats pay tribute to no one. Mama is said to have bent a wrench in half.`, importance: 3, factions: ['rats', 'rustclaw'], tags: ['betrayal'] });
      this.addDeed('betrayer', 0);
    },
    mamaKnows() {
      const R = this.s.factions.rats, M = this.s.factions.rustclaw;
      if (!R?.alive || !M?.alive) return;
      this.setPact('rats', 'rustclaw', 'war');
      const target = this.capital('rats');
      if (target) this.runAction({ type: 'attack', a: 'rustclaw', baseId: target.id, n: 7, name: 'Mama\'s Spanking', wait: 40 });
      this.chronicle('event', { title: 'Mama Comes to Visit', text: `Tipped off by a stranger, Mama Rustclaw took personal offence at the Rats' little plan. "Nobody touches my babies," she said, "except me." Her warband is headed for Old Suburbia.`, importance: 3, factions: ['rats', 'rustclaw'] });
    },
  },
  neon_deathray: {
    rumor() {
      const G = this.s.factions.glowkin;
      if (!G?.alive) return;
      const cap = this.capital('glowkin');
      if (!cap) return;
      // Doc Neon builds laser towers
      for (let i = 0; i < 2; i++) { const spot = this.findSpot(cap, 'laserT', 'edge'); if (spot) this.addStruct(cap, 'laserT', spot.tx, spot.tz); }
      if (!cap.structs.some((st) => st.type === 'solar')) { const sp = this.findSpot(cap, 'solar', 'inner'); if (sp) this.addStruct(cap, 'solar', sp.tx, sp.tz); }
      this.chronicle('event', { title: 'Doc Neon\'s Death Ray', text: `Purple light flickered over Glowmire all night. Traders whisper that Doc Neon has built "a sunbeam on a stick" and is very excited to point it at someone.`, importance: 2, factions: ['glowkin'] });
      const cnt = cap.structs.filter((st) => st.type === 'laserT').length;
      const m1 = this.createMission({ giver: this.s.factions.dominion?.alive ? 'dominion' : 'hub', type: 'sabotage', title: 'Unplug the Death Ray', desc: `Destroy the laser towers at ${cap.name} before the Glowkin perfect them. The Dominion will share the salvaged schematics.`, obj: { kind: 'destroyStructs', baseId: cap.id, structType: 'laserT', count: cnt, startCount: cnt, x: cap.x, z: cap.z }, reward: { caps: 300, rep: { dominion: 20, glowkin: -40 }, unlock: ['laser', 'laserT'] }, expires: this.s.time + DAY_LEN * 3 });
      const m2 = this.createMission({ giver: 'glowkin', type: 'deliver', title: 'Crystals for the Doctor', desc: `Doc Neon needs 25 crystal delivered to ${cap.name} to "calibrate the beam". In return: the laser schematics. "Science is sharing!"`, obj: { kind: 'deliver', res: 'crystal', amount: 25, baseId: cap.id, x: cap.x, z: cap.z }, reward: { caps: 150, rep: { glowkin: 25, dominion: -10 }, unlock: ['laser', 'laserT', 'tesla'] }, expires: this.s.time + DAY_LEN * 3, onComplete: { type: 'stage', arc: 'neon_deathray', stage: 'firing', delay: DAY_LEN * 0.5 } });
      this.offer({ from: 'glowkin', title: 'A Very Exciting Opportunity', text: `"Hello, test subje— I mean, friend! I need crystals for my beam. Bring me 25 and I'll teach you to make lasers. Isn't science wonderful?" — Doc Neon`, choices: [{ label: 'Help the Doctor', action: { type: 'accept', missionId: m2.id } }, { label: 'Tell the Dominion instead', action: { type: 'accept', missionId: m1.id } }, { label: 'Walk away slowly' }] });
      this.scheduleStage('neon_deathray', 'firing', DAY_LEN * 2.5);
    },
    firing() {
      const G = this.s.factions.glowkin, D = this.s.factions.dominion;
      if (!G?.alive || this.s.story.deathrayFired) return;
      const cap = this.capital('glowkin');
      if (!cap || !cap.structs.some((st) => st.type === 'laserT')) return;
      this.s.story.deathrayFired = true;
      G.def.strength += 2;
      if (D?.alive) {
        this.setPact('glowkin', 'dominion', 'war');
        const target = this.factionBases('dominion').sort((a, b) => Math.hypot(a.x - cap.x, a.z - cap.z) - Math.hypot(b.x - cap.x, b.z - cap.z))[0];
        if (target) for (const st of target.structs) if (STRUCTS[st.type].defense) st.hp *= 0.4;
        if (target) this.runAction({ type: 'attack', a: 'glowkin', baseId: target.id, n: 7, name: 'Neon Lightshow', wait: 20 });
      }
      this.chronicle('event', { title: 'The Night the Sky Turned Purple', text: `Doc Neon fired the Death Ray. Three Dominion turrets melted into modern art, and the Glowkin came pouring through the gap. "IT WORKS!" the Doctor screamed, for an hour.`, importance: 3, factions: ['glowkin', 'dominion'] });
    },
  },
  seed_vault: {
    demand() {
      const C = this.s.factions.choir, D = this.s.factions.dominion;
      if (!C?.alive || !D?.alive) return;
      this.addRel('choir', 'dominion', -35);
      const target = this.factionBases('choir').find((b) => b.zoneId === 'greenhollow') || this.capital('choir');
      if (!target) return;
      this.chronicle('event', { title: 'The Seed Vault Ultimatum', text: `General Hardplate sent the Verdant Choir a polite, eleven-page letter demanding they hand over the last seed vault "for safekeeping". Elder Fern used it to mulch tomatoes.`, importance: 2, factions: ['choir', 'dominion'] });
      const m = this.createMission({ giver: 'choir', type: 'defend', title: 'Roots and Rifles', desc: `The Dominion will come for ${target.name}. Be there when they do and help the Choir hold.`, obj: { kind: 'reach', x: target.x, z: target.z, r: 100 }, reward: { caps: 180, rep: { choir: 30, dominion: -15 }, unlock: ['solar', 'battery', 'electric'], items: { food: 30, water: 30 } }, expires: this.s.time + DAY_LEN * 1.5 });
      this.offer({ from: 'choir', title: 'Elder Fern Asks for Help', text: `"We prefer to sing. Please don't make us shout. But the Dominion are coming for the seeds of every garden that will ever grow again. Will you stand with us?" — Elder Fern Whistledown`, choices: [{ label: 'I\'ll be there', action: { type: 'accept', missionId: m.id } }, { label: 'Sorry, Fern' }] });
      this.scheduleStage('seed_vault', 'assault', DAY_LEN * 0.6, { baseId: target.id });
    },
    assault(ctx) {
      const b = this.s.bases[ctx.baseId];
      if (!b || !this.s.factions.dominion?.alive) return;
      if (!this.atWar('dominion', 'choir')) this.setPact('dominion', 'choir', 'war');
      this.runAction({ type: 'attack', a: 'dominion', baseId: b.id, n: 7, name: 'Vault Requisition Detail', wait: 45 });
      this.chronicle('event', { title: 'Tanks in the Garden', text: `Dominion treads are rolling toward ${b.name}. The Choir are singing louder than ever.`, importance: 2, factions: ['dominion', 'choir'] });
    },
  },
  tallow_well: {
    start() {
      this.s.story.marketMods = { demand: { water: 2.4 } };
      this.s.story.marketModsUntil = this.s.time + DAY_LEN * 2;
      const zd = this.zoneDef('brinewater');
      const m = this.createMission({ giver: 'hub', type: 'reach', title: 'The Deep Pipe', desc: `The Hub's old well is drying up. Auntie Tallow's surveyors think there's an aquifer under Brinewater Pans. Drive out and plant the survey beacon.`, obj: { kind: 'reach', x: zd.cx, z: zd.cz, r: 40 }, reward: { caps: 160, rep: Object.fromEntries(aliveFactions(this).map((f) => [f.id, 4])) }, onComplete: { type: 'stage', arc: 'tallow_well', stage: 'pipe', delay: 10 }, expires: this.s.time + DAY_LEN * 2 });
      this.chronicle('event', { title: 'The Hub Runs Dry', text: `For the first time in 29 years, the bucket in Auntie Tallow's well came up half empty. Water prices doubled by lunch.`, importance: 2, tags: ['hub'] });
      this.offer({ from: 'hub', title: 'Auntie Tallow Needs a Driver', text: `"The well's failing, sugar. If the Hub goes thirsty, the Accord goes with it, and then everybody shoots everybody. Help me find new water?" — Auntie Tallow`, choices: [{ label: 'On my way', action: { type: 'accept', missionId: m.id } }, { label: 'Not now' }] });
    },
    pipe() {
      this.s.story.marketMods = { supply: { water: 2.5 } };
      this.s.story.marketModsUntil = this.s.time + DAY_LEN * 3;
      this.addDeed('savior');
      this.chronicle('event', { title: 'The Deep Pipe Flows', text: `A rickety pipeline now runs from Brinewater Pans to the Hub, and the water is sweet. Auntie Tallow named the pump after ${this.s.group.leaderName || 'the stranger'} who found it.`, importance: 3, tags: ['hub', 'player'] });
    },
  },
  iron_purge: {
    purge() {
      const D = this.s.factions.dominion;
      if (!D?.alive) return;
      const lts = this.members('dominion').filter((n) => n.role === 'lieutenant');
      const victims = lts.slice(0, 2);
      for (const v of victims) this.killNpc(v, { purge: true });
      const defectors = this.members('dominion').filter((n) => n.role === 'driver' && !n.squadId).slice(0, 3);
      for (const n of defectors) { n.factionId = null; n.baseId = null; n.wage = Math.max(6, n.wage - 2); n.signing = 20; n.loyalty = 70; this.s.recruitPool.push(n.id); }
      this.chronicle('event', { title: 'The Clipboard Purge', text: `General Hardplate found an unsigned form and concluded there were traitors in the ranks. ${victims.length} lieutenants were "reassigned to the dunes". ${defectors.length} veteran drivers fled to the Hub and are looking for work. Cheap.`, importance: 2, factions: ['dominion'] });
    },
  },
  // procedural arcs
  rivalry: {
    insult(ctx) {
      const A = this.s.factions[ctx.a], B = this.s.factions[ctx.b];
      if (!A?.alive || !B?.alive) return;
      this.addRel(A.id, B.id, -25);
      const insults = ['called their cars "shopping trolleys with ambition"', 'stole their flag and wore it as a scarf', 'refused to share a fuel pump at the Hub', 'sang a very rude song about their leader on the radio', 'sold them a crate of "ammo" that turned out to be beans'];
      this.chronicle('event', { title: `Bad Blood: ${A.short} vs ${B.short}`, text: `${this.leaderName(A)} ${this.rng.pick(insults)}. ${this.leaderName(B)} has not stopped talking about it.`, importance: 1, factions: [A.id, B.id] });
      this.scheduleStage('rivalry', 'skirmish', DAY_LEN * 0.5, ctx);
    },
    skirmish(ctx) {
      const A = this.s.factions[ctx.a], B = this.s.factions[ctx.b];
      if (!A?.alive || !B?.alive) return;
      if (this.rel(A.id, B.id) < -30 && !this.atWar(A.id, B.id) && this.pact(A.id, B.id) !== 'alliance') { this.setPact(B.id, A.id, 'war'); this.chronicle('war', { a: B, b: A }); }
      const target = this.factionBases(A.id).filter((b) => !b.capital)[0];
      if (target && this.atWar(A.id, B.id)) {
        this.runAction({ type: 'attack', a: B.id, baseId: target.id, n: 5, name: `${B.short} grudge riders`, wait: 30 });
        if (this.s.group.factionId !== B.id && (this.s.group.rep[A.id] ?? 0) >= 0) {
          const m = this.createMission({ giver: A.id, type: 'defend', title: `Hold ${target.name}`, desc: `The ${B.short} are coming for ${target.name}. Help the ${A.short} hold it.`, obj: { kind: 'reach', x: target.x, z: target.z, r: 100 }, reward: { caps: 150, rep: { [A.id]: 15, [B.id]: -10 } } });
          this.offer({ from: A.id, title: `${A.short} Call for Help`, text: `"${q(A)}" — ${this.leaderName(A)}. The ${B.short} are marching on ${target.name}.`, choices: [{ label: 'Ride to help', action: { type: 'accept', missionId: m.id } }, { label: 'Ignore' }] });
        }
      }
    },
  },
  goldrush: {
    strike(ctx) {
      const zd = this.zoneDef(ctx.zoneId);
      const z = this.s.zones[ctx.zoneId];
      if (!zd || !z) return;
      const res = ctx.res;
      zd.richness[res] = +((zd.richness[res] || 0) + 0.9).toFixed(2);
      this.s.story.bonusNodes = (this.s.story.bonusNodes || []).concat(Array.from({ length: 10 }, (_, i) => ({ id: `gr${this.s.time | 0}_${i}`, zoneId: zd.id, res, x: Math.round(zd.cx + this.rng.range(-160, 160)), z: Math.round(zd.cz + this.rng.range(-160, 160)), amount: 12 })));
      this.emit('bonusNodes');
      this.chronicle('event', { title: `${RES_INFO[res].name} Rush in ${zd.name}`, text: `A scavenger stumbled into ${zd.name} with pockets full of ${RES_INFO[res].name.toLowerCase()}. By sundown, every faction with wheels was headed there.${z.claimable ? ' Nobody owns it. Yet.' : ''}`, importance: 2 });
      // the two nearest factions at most send prospecting parties, and only as a pair of cars
      const near = (f) => { const c = this.capital(f.id); return c ? Math.hypot(c.x - zd.cx, c.z - zd.cz) : Infinity; };
      let sent = 0;
      for (const f of aliveFactions(this, (x) => !x.isPlayer).sort((a, b) => near(a) - near(b))) {
        if (sent >= 2) break;
        const fs = this.availableFighters(f).slice(0, 2);
        if (fs.length < 2) continue;
        sent++;
        this.createSquad(f.id, fs.map((n) => n.id), { type: 'scavenge', zoneId: zd.id, legs: 3 }, { name: `${f.short} prospectors` });
      }
      this.createMission({ giver: 'hub', type: 'reach', title: `Stake a Claim in ${zd.name}`, desc: `Get to ${zd.name} and grab the ${RES_INFO[res].name.toLowerCase()} before the factions strip it bare.`, obj: { kind: 'reach', x: zd.cx, z: zd.cz, r: 120 }, reward: { caps: 60 }, board: true });
    },
  },
};

// ---------- the hat ----------
const CARDS = [
  // ===== premade story arcs (each fires once) =====
  { id: 'oil_schism', premade: true, once: true, big: true, minDay: 2, prepare() { return this.s.factions.saints?.alive && this.s.factions.barons?.alive ? {} : null; }, weight: 3, run() { ARCS.oil_schism.sermon.call(this); } },
  { id: 'rat_gambit', premade: true, once: true, big: true, minDay: 2, prepare() { return this.s.factions.rats?.alive && this.s.factions.rustclaw?.alive && this.pact('rats', 'rustclaw') === 'alliance' ? {} : null; }, weight: 2.5, run() { ARCS.rat_gambit.plot.call(this); } },
  { id: 'tallow_well', premade: true, once: true, minDay: 3, prepare() { return {}; }, weight: 2, run() { ARCS.tallow_well.start.call(this); } },
  { id: 'neon_deathray', premade: true, once: true, big: true, minDay: 4, prepare() { return this.s.factions.glowkin?.alive && this.capital('glowkin') ? {} : null; }, weight: 2, run() { ARCS.neon_deathray.rumor.call(this); } },
  { id: 'seed_vault', premade: true, once: true, big: true, minDay: 5, prepare() { return this.s.factions.choir?.alive && this.s.factions.dominion?.alive ? {} : null; }, weight: 2, run() { ARCS.seed_vault.demand.call(this); } },
  { id: 'iron_purge', premade: true, once: true, minDay: 6, prepare() { return this.s.factions.dominion?.alive && this.members('dominion').some((n) => n.role === 'lieutenant') ? {} : null; }, weight: 1.5, run() { ARCS.iron_purge.purge.call(this); } },

  // ===== the great betrayal (generic, repeatable but rare) =====
  {
    id: 'great_betrayal', big: true, minDay: 4, cooldown: DAY_LEN * 4,
    prepare() {
      const pairs = [];
      for (const [k, p] of Object.entries(this.s.pacts)) {
        if (p.type !== 'alliance') continue;
        const [a, b] = k.split('|').map((id) => this.s.factions[id]);
        if (!a?.alive || !b?.alive) continue;
        for (const [X, Y] of [[a, b], [b, a]]) {
          if (X.isPlayer) continue;
          const ratio = (X.powerCache || this.factionPower(X.id)) / Math.max(1, Y.powerCache || this.factionPower(Y.id));
          const w = (1 - X.traits.honor) * (0.5 + X.traits.cunning) * Math.min(2.5, ratio) * (Y.isPlayer ? 0.5 : 1);
          if (w > 0.25) pairs.push({ a: X.id, b: Y.id, w });
        }
      }
      return pairs.length ? this.rng.weighted(pairs, (p) => p.w) : null;
    },
    weight(ctx) { return 1.5 + ctx.w; },
    run(ctx) {
      const A = this.s.factions[ctx.a], B = this.s.factions[ctx.b];
      const g = this.s.group;
      // the player gets a chance to matter
      if (g.factionId === B.id || B.isPlayer || (g.rep[B.id] ?? 0) > 20) {
        this.offer({ from: 'hub', title: 'A Whisper in the Cantina', text: `A nervous ${A.short} mechanic grabs your sleeve: "${this.leaderName(A)} is going to turn on the ${B.short}. Soon. Tomorrow maybe. I never told you this."`, choices: [{ label: `Warn the ${B.short}`, action: [{ type: 'rep', fid: B.id, n: 20 }, { type: 'rep', fid: A.id, n: -15 }], result: `The ${B.short} thank you. They are on alert.` }, { label: 'Keep it to yourself' }] });
        this.scheduleStage('betrayal', 'strike', 100, { a: A.id, b: B.id });
      } else if (g.factionId === A.id || (g.rep[A.id] ?? 0) > 30) {
        const target = this.factionBases(B.id)[0];
        const m = target ? this.createMission({ giver: A.id, type: 'attackBase', title: `Knife in the Back: ${target.name}`, desc: `${this.leaderName(A)} is breaking the alliance with the ${B.short}. Strike ${target.name} while they still think we're friends.`, obj: { kind: 'destroyBase', baseId: target.id, x: target.x, z: target.z }, reward: { caps: 320, rep: { [A.id]: 25, [B.id]: -50 } }, support: true }) : null;
        this.offer({ from: A.id, title: 'Secret Orders', text: `"Our friends the ${B.short} have grown fat and slow. We strike at dawn. Are you with us?" — ${this.leaderName(A)}`, choices: [{ label: 'I\'m in', action: m ? [{ type: 'accept', missionId: m.id }, { type: 'deed', kind: 'betrayer' }] : null }, { label: `Warn the ${B.short}`, action: [{ type: 'rep', fid: A.id, n: -40 }, { type: 'rep', fid: B.id, n: 30 }, { type: 'stage', arc: 'betrayal', stage: 'strike', delay: 60, ctx: { a: A.id, b: B.id, foiled: true } }], result: 'You warned them. The betrayal is exposed.' }, { label: 'Say nothing' }] });
        this.scheduleStage('betrayal', 'strike', 90, { a: A.id, b: B.id });
      } else this.betrayAlly(A, B);
    },
  },

  // ===== coups and civil wars =====
  {
    id: 'coup', big: true, minDay: 7, cooldown: DAY_LEN * 4,
    prepare() {
      const opts = [];
      for (const f of aliveFactions(this, (f) => !f.isPlayer && f.leaderId)) {
        const lts = this.members(f.id).filter((n) => n.role === 'lieutenant');
        if (!lts.length) continue;
        const avgLoy = this.members(f.id).reduce((t, n) => t + n.loyalty, 0) / Math.max(1, this.members(f.id).length);
        const trouble = (100 - avgLoy) / 100 + f.losses * 0.01 + (f.zonesLost || 0) * 0.2 + f.warWeariness * 0.01;
        const usurper = lts.sort((a, b) => b.skill - a.skill)[0];
        if (trouble < 0.45 || this.s.time - (f.lastCoup || -1e9) < DAY_LEN * 6) continue;
        opts.push({ f: f.id, n: usurper.id, w: trouble });
      }
      return opts.length ? this.rng.weighted(opts, (o) => o.w) : null;
    },
    weight(ctx) { return 0.1 + ctx.w * 0.6; },
    run(ctx) {
      const f = this.s.factions[ctx.f], heir = this.s.npcs[ctx.n];
      f.lastCoup = this.s.time;
      const oldLeader = this.s.npcs[f.leaderId];
      const old = this.leaderName(f);
      if (oldLeader) { oldLeader.role = 'lieutenant'; oldLeader.factionId = null; oldLeader.baseId = null; oldLeader.squadId = null; oldLeader.wage = 25; oldLeader.signing = 120; this.s.recruitPool.push(oldLeader.id); }
      heir.traits = null;
      this.crownLeader(f, heir);
      this.s.stats.coups++;
      for (const n of this.members(f.id)) n.loyalty = Math.min(100, n.loyalty + 15);
      this.chronicle('coup', { f, old, heir });
      if (this.s.group.factionId === f.id) this.emit('notice', `${heir.name} has seized control of the ${f.short}! ${old} fled to the Hub.`);
    },
  },
  {
    id: 'sundering', big: true, minDay: 7, cooldown: DAY_LEN * 5,
    prepare() {
      if (aliveFactions(this).length >= 11) return null;
      const opts = aliveFactions(this, (f) => !f.isPlayer && this.factionBases(f.id).length >= 3);
      if (!opts.length) return null;
      const f = this.rng.pick(opts);
      const lt = this.members(f.id).filter((n) => n.role === 'lieutenant').sort((a, b) => a.loyalty - b.loyalty)[0];
      return lt ? { f: f.id, n: lt.id } : null;
    },
    weight: 0.8,
    run(ctx) {
      const f = this.s.factions[ctx.f], rebel = this.s.npcs[ctx.n];
      const gen = genFaction(this.rng, new Set(Object.values(this.s.factions).map((x) => x.name)));
      const nf = this.createFaction({ ...gen, leader: { name: rebel.name, title: gen.leader.title, traits: gen.leader.traits }, strength: 3, lore: `Born when ${rebel.name} split from the ${f.name} on day ${this.day}, taking a base and every driver who was tired of ${this.leaderName(f)}.` }, { procedural: true, treasury: 200 });
      // the rebel leader record replaces the generated one
      const genLeader = this.s.npcs[nf.leaderId];
      if (genLeader) genLeader.alive = false;
      rebel.factionId = nf.id; rebel.role = 'leader'; rebel.squadId = null;
      this.crownLeader(nf, rebel);
      const base = this.factionBases(f.id).filter((b) => !b.capital).sort((a, b) => b.structs.length - a.structs.length)[0];
      if (base) {
        base.factionId = nf.id;
        rebel.baseId = base.id;
        for (const n of Object.values(this.s.npcs)) if (n.alive && n.baseId === base.id && n.factionId === f.id && n.loyalty < 75) { n.factionId = nf.id; n.squadId = null; }
      }
      this.setPact(nf.id, f.id, 'war', null, true);
      this.updateZoneOwnership();
      this.chronicle('event', { title: `The Sundering of the ${f.short}`, text: `${rebel.name} stood up at the ${f.short} war council, called ${this.leaderName(f)} a fool, and walked out with half the room. They call themselves the ${nf.name} now. "${nf.motto}"`, importance: 3, factions: [f.id, nf.id], tags: ['betrayal'] });
    },
  },

  // ===== defections =====
  {
    id: 'defection', minDay: 2, cooldown: DAY_LEN * 0.7,
    prepare() {
      const unhappy = Object.values(this.s.npcs).filter((n) => n.alive && n.factionId && n.role === 'driver' && n.loyalty < 45 && !this.s.factions[n.factionId]?.bandit && !this.s.factions[n.factionId]?.isPlayer);
      if (!unhappy.length) return null;
      const n = this.rng.pick(unhappy);
      return { n: n.id };
    },
    weight: 1.2,
    run(ctx) {
      const n = this.s.npcs[ctx.n];
      const from = this.s.factions[n.factionId];
      const g = this.s.group;
      const pf = this.s.factions[g.factionId];
      const buddies = this.members(from.id).filter((m) => m !== n && m.role === 'driver' && m.baseId === n.baseId && m.loyalty < 60 && !m.squadId).slice(0, 2);
      if (pf?.isPlayer && (g.rep[from.id] ?? 0) > -60) {
        this.offer({ from: from.id, title: 'Deserters at the Gate', text: `${n.name} and ${buddies.length} friends have deserted the ${from.short}. They want to ride with you. Taking them in will anger ${this.leaderName(from)}.`, choices: [{ label: 'Welcome aboard', action: [{ type: 'recruitNpc', npcId: n.id }, ...buddies.map((b) => ({ type: 'recruitNpc', npcId: b.id })), { type: 'rel', a: from.id, b: pf.id, n: -15 }, { type: 'rep', fid: from.id, n: -10 }] }, { label: 'Send them back' }] });
        for (const m of [n, ...buddies]) { m.factionId = null; m.baseId = null; }
        return;
      }
      const rivals = aliveFactions(this, (o) => o.id !== from.id && !o.isPlayer && this.rel(from.id, o.id) < 20);
      const to = rivals.length ? this.rng.pick(rivals) : null;
      for (const m of [n, ...buddies]) { m.factionId = to ? to.id : null; m.baseId = to ? this.capital(to.id)?.id : null; m.loyalty = 65; if (!to) this.s.recruitPool.push(m.id); }
      if (to) this.addRel(from.id, to.id, -10);
      this.chronicle('defection', { from, to, n, count: 1 + buddies.length });
    },
  },

  // ===== contracts & duels: the player as main character =====
  {
    id: 'assassination', minDay: 3, cooldown: DAY_LEN * 1.2,
    prepare() {
      const givers = aliveFactions(this, (f) => !f.isPlayer && f.traits.cunning > 0.4 && (this.s.group.rep[f.id] ?? 0) >= 0);
      const opts = [];
      for (const g of givers) for (const e of this.enemies(g.id)) { if (e.isPlayer || e.bandit) continue; const lt = this.members(e.id).find((n) => n.role === 'lieutenant' && !n.squadId); if (lt) opts.push({ g: g.id, e: e.id, n: lt.id }); }
      return opts.length ? this.rng.pick(opts) : null;
    },
    weight: 1.3,
    run(ctx) {
      const G = this.s.factions[ctx.g], E = this.s.factions[ctx.e], n = this.s.npcs[ctx.n];
      const home = this.s.bases[n.baseId] || this.capital(E.id);
      if (!home) return;
      const guards = this.availableFighters(E, home).filter((x) => x !== n).slice(0, 2);
      const sq = this.createSquad(E.id, [n.id, ...guards.map((x) => x.id)], { type: 'patrol', zoneId: home.zoneId, x: home.x + 150, z: home.z - 100, legs: 30 }, { name: `${n.name}'s patrol`, speed: 8 });
      const m = this.createMission({ giver: G.id, type: 'assassinate', title: `Contract: ${n.name}`, desc: `${this.leaderName(G)} wants ${E.short} lieutenant ${n.name} dead. They patrol near ${home.name}.`, obj: { kind: 'killNpc', npcId: n.id, x: sq.x, z: sq.z }, reward: { caps: 240, rep: { [G.id]: 15, [E.id]: -20 } } });
      this.offer({ from: G.id, title: 'A Quiet Word', text: `"${n.name} has been a thorn in our side. Make them disappear. Discreetly. Or loudly, I'm not fussy." — ${this.leaderName(G)}`, choices: [{ label: 'Consider it done', action: { type: 'accept', missionId: m.id } }, { label: 'Not my kind of job' }] });
    },
  },
  {
    id: 'duel', minDay: 3, cooldown: DAY_LEN * 1.5,
    prepare() {
      const opts = aliveFactions(this, (f) => !f.isPlayer && f.traits.aggression > 0.5 && (this.s.group.kills > 8 || this.s.group.epithets.length));
      if (!opts.length) return null;
      return { f: this.rng.pick(opts).id };
    },
    weight: 0.9,
    run(ctx) {
      const f = this.s.factions[ctx.f];
      const ace = this.createNpc(f.id, 'lieutenant', { design: this.styleDesign(f, false), skill: 0.8 });
      ace.epithet = this.rng.pick(['the Undefeated', 'Quickdraw', 'the Red Baron of the Dunes', 'Steel Jaw', 'the Last Gunslinger']);
      const zones = this.world.zones.filter((z) => z.biome !== 'hub' && z.ring === 1);
      const zd = this.rng.pick(zones);
      const sq = this.createSquad(f.id, [ace.id], { type: 'patrol', zoneId: zd.id, x: zd.cx, z: zd.cz, legs: 99 }, { x: zd.cx, z: zd.cz, speed: 5, name: `${ace.name} (duel)` });
      sq.duel = true;
      const m = this.createMission({ giver: f.id, type: 'duel', title: `Duel with ${ace.name}`, desc: `${ace.name}, "${ace.epithet}", challenges you to single combat in ${zd.name}. Winning earns the ${f.short}'s respect — even if you're enemies.`, obj: { kind: 'killNpc', npcId: ace.id, x: zd.cx, z: zd.cz }, reward: { caps: 150, rep: { [f.id]: 12 } } });
      this.offer({ from: f.id, title: 'A Challenge!', text: `"They say you're the best driver in the waste. I say prove it. ${zd.name}. Just you and me." — ${ace.name}`, choices: [{ label: 'Accept the duel', action: { type: 'accept', missionId: m.id } }, { label: 'Decline (lose face)', action: { type: 'rep', fid: f.id, n: -5 } }] });
    },
  },
  {
    id: 'hunters', minDay: 3, cooldown: DAY_LEN * 1.5,
    prepare() {
      const g = this.s.group;
      const angry = aliveFactions(this, (f) => !f.isPlayer && (g.rep[f.id] ?? 0) <= -50);
      if (!angry.length) return null;
      return { f: this.rng.pick(angry).id };
    },
    weight: 1.4,
    run(ctx) {
      const f = this.s.factions[ctx.f];
      const fs = this.availableFighters(f).slice(0, 2 + Math.min(3, Math.floor(this.day / 5)));
      if (!fs.length) return;
      const p = Object.values(this.s.players)[0];
      const pos = p?.pos || [0, 0];
      const sq = this.createSquad(f.id, fs.map((n) => n.id), { type: 'hunt', x: pos[0], z: pos[1] }, { name: `${f.short} bounty hunters` });
      sq.hunting = true;
      f.huntingPlayer = true;
      this.s.group.bounty = Math.max(this.s.group.bounty, 100);
      this.emit('warning', `The ${f.name} have put a price on your head. Hunters are coming.`, null);
      this.chronicle('event', { title: `A Price on the Stranger's Head`, text: `${this.leaderName(f)} nailed a wanted poster to the Hub gate. The face on it looks a lot like ${this.s.group.leaderName || 'you'}.`, importance: 1, tags: ['player'], factions: [f.id] });
    },
  },

  // ===== world events =====
  {
    id: 'oil_boom', minDay: 2, cooldown: DAY_LEN * 3,
    prepare() { const zs = this.world.zones.filter((z) => z.biome !== 'hub' && z.biome !== 'oilfield'); return { zoneId: this.rng.pick(zs).id, res: 'fuel' }; },
    weight: 0.8,
    run(ctx) { ARCS.goldrush.strike.call(this, ctx); },
  },
  {
    id: 'goldrush', proc: true, minDay: 2, cooldown: DAY_LEN * 1.5,
    prepare() { const zs = this.world.zones.filter((z) => z.biome !== 'hub'); return { zoneId: this.rng.pick(zs).id, res: this.rng.pick(['crystal', 'electronics', 'scrap', 'chems', 'water']) }; },
    weight: 1,
    run(ctx) { ARCS.goldrush.strike.call(this, ctx); },
  },
  {
    id: 'meteor', minDay: 3, cooldown: DAY_LEN * 2,
    prepare() { return this.tod > 0.8 || this.tod < 0.22 ? { zoneId: this.rng.pick(this.world.zones.filter((z) => z.biome !== 'hub')).id } : null; },
    weight: 1.2,
    run(ctx) {
      const zd = this.zoneDef(ctx.zoneId);
      this.s.story.bonusNodes = (this.s.story.bonusNodes || []).concat(Array.from({ length: 14 }, (_, i) => ({ id: `mt${this.s.time | 0}_${i}`, zoneId: zd.id, res: 'crystal', x: Math.round(zd.cx + this.rng.range(-200, 200)), z: Math.round(zd.cz + this.rng.range(-200, 200)), amount: 10, type: 'crystalNode' })));
      this.emit('bonusNodes');
      this.emit('meteor', zd);
      this.chronicle('event', { title: `Starfall over ${zd.name}`, text: `Streaks of purple fire crossed the night sky and came down hard in ${zd.name}. By morning the dunes glittered with fresh crystal.`, importance: 2 });
    },
  },
  {
    id: 'sandstorm', minDay: 1, cooldown: DAY_LEN * 1.2,
    prepare() { return {}; }, weight: 1,
    run() { this.emit('weather', 'sandstorm', 150); this.chronicle('event', { title: 'The Great Brown Wall', text: 'A sandstorm rolled across the waste, swallowing convoys whole. Visibility: an arm\'s length. Drivers report hearing engines that weren\'t there.', importance: 0 }); },
  },
  {
    id: 'drought', minDay: 3, cooldown: DAY_LEN * 3,
    prepare() { return this.s.story.fired.tallow_well ? {} : null; }, weight: 0.7,
    run() {
      this.s.story.marketMods = { demand: { water: 2.0, food: 1.4 } };
      this.s.story.marketModsUntil = this.s.time + DAY_LEN * 1.5;
      this.createMission({ giver: 'hub', board: true, type: 'deliver', title: 'Water for the Thirsty', desc: 'Heatwave. Bring 30 water to the Hub. Auntie Tallow pays double.', obj: { kind: 'deliver', res: 'water', amount: 30, baseId: null, x: 0, z: 0 }, reward: { caps: Math.round(30 * unitPrice(this.s.market, 'water') * 2), rep: Object.fromEntries(aliveFactions(this).map((f) => [f.id, 2])) } });
      this.chronicle('event', { title: 'The Long Heat', text: 'The sun sat on the waste like a fat cat. Water is worth more than petrol this week.', importance: 1 });
    },
  },
  {
    id: 'market_crash', minDay: 3, cooldown: DAY_LEN * 2,
    prepare() {
      const res = Object.entries(this.s.prodTotals || {}).sort((a, b) => b[1] - a[1])[0];
      return res ? { res: res[0] } : null;
    },
    weight: 0.8,
    run(ctx) {
      this.s.story.marketMods = { supply: { [ctx.res]: 2.6 } };
      this.s.story.marketModsUntil = this.s.time + DAY_LEN;
      this.s.market.stock[ctx.res] *= 1.6;
      const producers = aliveFactions(this, (f) => (f.prod?.[ctx.res] || 0) > 1.5);
      for (const a of producers) for (const b of producers) if (a !== b) this.addRel(a.id, b.id, -8);
      this.chronicle('event', { title: `The ${RES_INFO[ctx.res].name} Crash`, text: `Too many sellers, not enough buyers: ${RES_INFO[ctx.res].name.toLowerCase()} prices collapsed at the Hub Bazaar. ${producers.length > 1 ? `The ${producers.map((f) => f.short).join(' and the ')} are eyeing each other's mines.` : ''}`, importance: 1, factions: producers.map((f) => f.id) });
    },
  },
  {
    id: 'warlord_rises', proc: true, big: true, minDay: 5, cooldown: DAY_LEN * 3,
    prepare() {
      const wild = this.world.zones.filter((z) => z.biome !== 'hub' && this.s.zones[z.id].claimable && this.freeSite(z.id));
      const alive = aliveFactions(this).length;
      return wild.length && alive < 12 ? { zoneId: this.rng.pick(wild).id } : null;
    },
    weight() { return 0.6 + (8 - aliveFactions(this).length) * 0.3; },
    run(ctx) {
      const zd = this.zoneDef(ctx.zoneId);
      const gen = genFaction(this.rng, new Set(Object.values(this.s.factions).map((f) => f.name)));
      gen.lore = `${gen.leader.title} ${gen.leader.name} was a nobody scavver until day ${this.day}, when they beat three camp bosses in a demolition derby and took their crews. Now they call themselves ${gen.name}. Their creed: "${gen.motto}"`;
      const f = this.createFaction({ ...gen, strength: 3, home: zd.id }, { procedural: true, treasury: 220 });
      const site = this.freeSite(zd.id);
      this.createBase(f.id, site, 1, { auto: true, capital: true });
      for (let i = 0; i < 9; i++) this.createNpc(f.id, i < 1 ? 'lieutenant' : 'driver');
      this.redistributeGarrison(f.id);
      this.ensureBeds(f.id);
      for (const o of aliveFactions(this, (o) => o.id !== f.id)) this.setRel(f.id, o.id, this.rng.int(-35, 5));
      this.chronicle('event', { title: `The Rise of ${gen.name}`, text: gen.lore, importance: 3, factions: [f.id] });
    },
  },
  {
    id: 'rich_caravan', minDay: 2, cooldown: DAY_LEN,
    prepare() {
      if (Object.values(this.s.squads).filter((q) => q.task.type === 'trade').length >= 3) return null;
      const m = aliveFactions(this, (f) => !f.isPlayer && f.traits.greed > 0.5 && this.capital(f.id));
      return m.length ? { f: this.rng.pick(m).id } : null;
    },
    weight: 1.2,
    run(ctx) {
      const f = this.s.factions[ctx.f];
      const cap = this.capital(f.id);
      const crew = this.availableFighters(f, cap).slice(0, 3);
      if (crew.length < 2 && (!crew.length || this.members(f.id).length >= 4)) return; // a treasure truck never rides alone
      crew[0].design = { ...this.styleDesign(f, false), chassis: 'truck', engine: 'diesel', wheels: 'standard', armor: 'medium', weapons: [null, 'mg', null, null], utils: ['cargoRack', null, null, null, null] };
      const sq = this.createSquad(f.id, crew.map((n) => n.id), { type: 'trade' }, { from: cap, cargo: { crystal: 20, electronics: 25, fuel: 40 }, speed: 8, name: `${f.short} treasure caravan` });
      const rivals = this.enemies(f.id).filter((e) => !e.isPlayer);
      const giver = rivals.length ? this.rng.pick(rivals).id : 'hub';
      const m1 = this.createMission({ giver, type: 'raid', title: `Rob the ${f.short} Treasure Caravan`, desc: `A heavily loaded ${f.short} caravan is crawling toward the Hub. Its cargo is worth a fortune — and it falls out when the trucks blow up.`, obj: { kind: 'killSquad', squadId: sq.id, x: sq.x, z: sq.z }, reward: { caps: 120, rep: giver !== 'hub' ? { [giver]: 10, [f.id]: -25 } : { [f.id]: -25 } } });
      const m2 = this.createMission({ giver: f.id, type: 'escort', title: `Escort the Treasure Caravan`, desc: `Keep the ${f.short} treasure caravan alive until it reaches the Hub.`, obj: { kind: 'escortSquad', squadId: sq.id, x: sq.x, z: sq.z }, reward: { caps: 200, rep: { [f.id]: 15 } } });
      sq.missionId = m2.id;
      this.offer({ from: 'hub', title: 'Rumours of Treasure', text: `Everyone in the Leaky Radiator is talking about the ${f.short} treasure caravan headed for the Hub. Some want to rob it. ${this.leaderName(f)} is hiring guards.`, choices: [{ label: 'Rob it', action: { type: 'accept', missionId: m1.id } }, { label: 'Guard it', action: { type: 'accept', missionId: m2.id } }, { label: 'Ignore' }] });
    },
  },
  {
    id: 'plague', minDay: 4, cooldown: DAY_LEN * 3,
    prepare() { const f = this.rng.pick(aliveFactions(this, (f) => !f.isPlayer && this.capital(f.id))); return f ? { f: f.id } : null; },
    weight: 0.6,
    run(ctx) {
      const f = this.s.factions[ctx.f];
      const cap = this.capital(f.id);
      for (const n of this.members(f.id)) { n.hp = Math.max(0.3, n.hp - 0.35); n.loyalty -= 8; }
      const disease = this.rng.pick(['Rust Rot', 'Glow Fever', 'the Coughing Dust', 'Sump Lung']);
      const m = this.createMission({ giver: f.id, type: 'deliver', title: `Medicine for the ${f.short}`, desc: `${disease} is spreading through the ${f.short}. Deliver 20 chems to ${cap.name} to brew medicine.`, obj: { kind: 'deliver', res: 'chems', amount: 20, baseId: cap.id, x: cap.x, z: cap.z }, reward: { caps: 140, rep: { [f.id]: 25 } } });
      this.offer({ from: f.id, title: `${disease}!`, text: `The ${f.name} are sick with ${disease}. Half their drivers can barely hold a wheel. They're begging for chems.`, choices: [{ label: 'Help them', action: { type: 'accept', missionId: m.id } }, { label: 'Not my problem' }] });
      this.chronicle('event', { title: `${disease} Among the ${f.short}`, text: `A sickness called ${disease} swept through the ${f.name}. Their enemies have noticed how quiet the turrets are.`, importance: 1, factions: [f.id] });
    },
  },
  {
    id: 'tribute', minDay: 4, cooldown: DAY_LEN * 1.5,
    prepare() {
      const g = this.s.group;
      const pf = this.s.factions[g.factionId];
      const strong = aliveFactions(this, (f) => !f.isPlayer && f.traits.aggression + f.traits.greed > 1.1);
      if (pf?.isPlayer && strong.length && this.factionBases(pf.id).length) {
        const neigh = strong.filter((f) => this.borderZones(f.id).some((z) => this.s.zones[z].owner === pf.id) && !this.atWar(f.id, pf.id));
        if (neigh.length) return { f: this.rng.pick(neigh).id, player: true };
      }
      const pairs = [];
      for (const a of strong) for (const b of aliveFactions(this, (x) => !x.isPlayer && x !== a)) if ((a.powerCache || 1) > (b.powerCache || 1) * 1.8 && !this.atWar(a.id, b.id) && this.pact(a.id, b.id) !== 'alliance') pairs.push({ f: a.id, v: b.id });
      return pairs.length ? this.rng.pick(pairs) : null;
    },
    weight: 1,
    run(ctx) {
      const A = this.s.factions[ctx.f];
      if (ctx.player) {
        const pf = this.s.factions[this.s.group.factionId];
        const caps = 80 + this.day * 15;
        this.offer({ from: A.id, title: 'Protection Money', text: `"Nice little faction you've got. Shame if something happened to it. ${caps} caps and we stay friends." — ${this.leaderName(A)}`, choices: [{ label: `Pay ${caps} caps`, action: { type: 'payTribute', to: A.id, caps } }, { label: 'Tell them to get lost', action: [{ type: 'rel', a: A.id, b: pf.id, n: -40 }, { type: 'rep', fid: A.id, n: -15 }], result: `${A.short} will not forget this.` }], ttl: 240, onExpire: { type: 'rel', a: A.id, b: pf.id, n: -25 } });
        return;
      }
      const V = this.s.factions[ctx.v];
      const pays = V.traits.caution > 0.6 && V.treasury > 100;
      if (pays) { const amt = Math.round(V.treasury * 0.3); V.treasury -= amt; A.treasury += amt; this.addRel(A.id, V.id, 10); V.grudges[A.id] = (V.grudges[A.id] || 0) + 20; this.chronicle('event', { title: `The ${V.short} Pay Up`, text: `${this.leaderName(A)} demanded tribute from the ${V.name}. ${this.leaderName(V)} paid ${amt} caps through gritted teeth.`, importance: 1, factions: [A.id, V.id] }); }
      else { this.setPact(A.id, V.id, 'war'); this.chronicle('event', { title: `The ${V.short} Refuse to Kneel`, text: `"${q(V)}" — ${this.leaderName(V)}'s answer to the ${A.short}'s demand for tribute. It means war.`, importance: 2, factions: [A.id, V.id] }); }
    },
  },
  {
    id: 'peace_summit', minDay: 5, cooldown: DAY_LEN * 2,
    prepare() {
      const wars = Object.entries(this.s.pacts).filter(([, p]) => p.type === 'war').map(([k]) => k.split('|')).filter(([a, b]) => this.s.factions[a]?.alive && this.s.factions[b]?.alive && !this.s.factions[a].isPlayer && !this.s.factions[b].isPlayer && !this.s.factions[a].bandit && !this.s.factions[b].bandit);
      const tired = wars.filter(([a, b]) => this.s.factions[a].warWeariness + this.s.factions[b].warWeariness > 30);
      return tired.length ? { a: tired[0][0], b: tired[0][1] } : null;
    },
    weight: 1.2,
    run(ctx) {
      const A = this.s.factions[ctx.a], B = this.s.factions[ctx.b];
      const warmongers = aliveFactions(this, (f) => f !== A && f !== B && !f.isPlayer && f.traits.cunning > 0.5);
      if (warmongers.length && this.rng.chance(0.6)) {
        const W = this.rng.pick(warmongers);
        this.offer({ from: W.id, title: 'Spoil the Summit', text: `The ${A.short} and the ${B.short} are meeting at the Hub to make peace. ${this.leaderName(W)} would prefer they didn't. "A little incident on the road home, perhaps?"`, choices: [{ label: 'Sabotage the peace (+200 caps)', action: [{ type: 'caps', n: 200 }, { type: 'rep', fid: W.id, n: 15 }, { type: 'rep', fid: A.id, n: -10 }, { type: 'rel', a: A.id, b: B.id, n: -40 }, { type: 'chronicle', title: 'The Poisoned Summit', text: `The peace talks between the ${A.short} and the ${B.short} ended with a fuel line cut and accusations flying. Somebody profited. Nobody can prove who.`, importance: 2 }] }, { label: 'Let peace happen', action: [{ type: 'pact', a: A.id, b: B.id, pact: 'truce' }, { type: 'chronicle', title: `Peace at the Hub`, text: `${this.leaderName(A)} and ${this.leaderName(B)} shared a jug of water under Auntie Tallow's watchful eye. The war between the ${A.short} and the ${B.short} is over, for now.`, importance: 2 }] }] });
        return;
      }
      this.setPact(A.id, B.id, 'truce');
      A.warWeariness = 0; B.warWeariness = 0;
      this.chronicle('event', { title: 'Peace at the Hub', text: `${this.leaderName(A)} and ${this.leaderName(B)} met under the Accord and agreed to stop shooting each other. Their drivers celebrated by shooting at the sky.`, importance: 2, factions: [A.id, B.id] });
    },
  },
  {
    id: 'hub_raid', minDay: 3, cooldown: DAY_LEN * 2,
    prepare() { return {}; }, weight: 0.8,
    run() {
      this.ensureScavFaction();
      const ids = [];
      const n = 4 + Math.min(4, Math.floor(this.day / 2));
      for (let i = 0; i < n; i++) ids.push(this.createNpc('scavvers', 'driver', { design: this.rng.chance(0.3) ? { ...PRESET_DESIGNS.raider } : { ...PRESET_DESIGNS.scav }, skill: 0.35 }).id);
      const a = this.rng.range(0, Math.PI * 2);
      const x0 = Math.cos(a) * 700, z0 = Math.sin(a) * 700;
      const home = Object.values(this.s.bases).filter((b) => b.scav).sort((a1, b1) => Math.hypot(a1.x - x0, a1.z - z0) - Math.hypot(b1.x - x0, b1.z - z0))[0];
      const sq = this.createSquad('scavvers', ids, { type: 'hunt', x: Math.cos(a) * 240, z: Math.sin(a) * 240 }, { x: x0, z: z0, from: home, name: 'Scavver horde', speed: 12 });
      this.createMission({ giver: 'hub', type: 'defend', title: 'Defend the Hub', desc: 'A Scavver horde is circling the Hub walls. Break it before it strangles the trade roads.', obj: { kind: 'killSquad', squadId: sq.id, x: sq.x, z: sq.z }, reward: { caps: 180, rep: Object.fromEntries(aliveFactions(this).map((f) => [f.id, 5])) }, board: true });
      this.emit('warning', 'A Scavver horde is closing on the Hub!', null);
      this.chronicle('event', { title: 'The Horde at the Gates', text: `${n} Scavver cars howled around the Hub walls all afternoon, cutting off the trade roads.`, importance: 1 });
    },
  },
  {
    id: 'mercenaries', minDay: 3, cooldown: DAY_LEN * 2,
    prepare() { return {}; }, weight: 0.7,
    run() {
      const name = this.rng.pick(['Iron Jackals', 'Sunset Lancers', 'The Overdue Bills', 'Hubcap Legion']);
      for (let i = 0; i < 3; i++) {
        const n = this.createNpc(null, 'recruit', { design: { ...PRESET_DESIGNS.spikyHeavy, paint: '#264653', paint2: '#e9c46a' }, skill: this.rng.range(0.7, 0.9) });
        n.factionId = null; n.wage = 22; n.signing = 120; n.epithet = `of the ${name}`;
        this.s.recruitPool.push(n.id);
      }
      this.chronicle('event', { title: `The ${name} Ride In`, text: `A mercenary company called the ${name} parked outside the Leaky Radiator. They are expensive, well-armed and loyal to whoever pays on time.`, importance: 1, tags: ['hub'] });
    },
  },
  {
    id: 'bunker', minDay: 2, cooldown: DAY_LEN * 2,
    prepare() {
      const found = this.s.story.bunkers || 0;
      if (found >= 6) return null;
      const zs = this.world.zones.filter((z) => z.ring === (found < 2 ? 1 : 2));
      return { zoneId: this.rng.pick(zs).id, n: found };
    },
    weight() { return this.s.group.unlocked.tier < 3 ? 1.8 : 0.5; },
    run(ctx) {
      const zd = this.zoneDef(ctx.zoneId);
      this.s.story.bunkers = (this.s.story.bunkers || 0) + 1;
      // the hatch (and the scavvers squatting on it) sits out in the wilds, clear of the Hub roads
      const spot = this.zonePoint(zd.id, zd.cx, zd.cz, 60, 220, HUB_QUIET_R);
      const x = Math.round(spot.x), z = Math.round(spot.z);
      const tier = ctx.n < 2 ? 2 : 3;
      const parts = tier === 2 ? this.rng.pick([['cannon', 'rockets'], ['turbo', 'diesel'], ['solar', 'battery'], ['jumpjets', 'repair']]) : this.rng.pick([['laser', 'tesla'], ['hover', 'fusion'], ['shield', 'reactive'], ['rig']]);
      // guardians
      this.ensureScavFaction();
      const ids = [];
      for (let i = 0; i < 2 + ctx.n; i++) ids.push(this.createNpc('scavvers', 'driver', { design: { ...PRESET_DESIGNS[ctx.n > 2 ? 'raider' : 'scav'] }, skill: 0.4 + ctx.n * 0.05 }).id);
      const k = 1 + 40 / Math.max(1, Math.hypot(x, z)); // squat just outboard of the hatch
      this.createSquad('scavvers', ids, { type: 'patrol', zoneId: zd.id, x, z, legs: 60 }, { x: x * k, z: z * k, speed: 6, name: 'Bunker squatters' });
      const m = this.createMission({ giver: 'hub', type: 'explore', title: `The Bunker in ${zd.name}`, desc: `A sand slide uncovered an Old-World bunker door in ${zd.name}. Scavvers are already sniffing around. Get inside first.`, obj: { kind: 'reach', x, z, r: 14 }, reward: { caps: 80 + ctx.n * 40, unlock: parts, unlockTier: ctx.n >= 3 ? 3 : undefined }, board: true, expires: this.s.time + DAY_LEN * 3 });
      this.chronicle('event', { title: `A Door in the Sand`, text: `An Old-World bunker hatch has surfaced in ${zd.name}. Whatever is inside has been waiting 41 years.`, importance: 1 });
      this.emit('notice', `Rumour: an Old-World bunker surfaced in ${zd.name}. (${m.title})`);
    },
  },
  {
    id: 'refugees', minDay: 2, cooldown: DAY_LEN,
    prepare() { return this.s.stats.basesDestroyed > (this.s.story.lastRefugeeBases || 0) ? {} : null; }, weight: 1,
    run() {
      this.s.story.lastRefugeeBases = this.s.stats.basesDestroyed;
      for (let i = 0; i < 3; i++) { const n = this.createNpc(null, 'recruit'); n.factionId = null; n.wage = this.rng.int(3, 6); n.signing = 10; this.s.recruitPool.push(n.id); }
      this.chronicle('event', { title: 'Refugees at the Hub', text: 'Survivors of the latest sacking crawled into the Hub on flat tyres. They\'ll work for food.', importance: 0, tags: ['hub'] });
    },
  },
  {
    id: 'derby', minDay: 2, cooldown: DAY_LEN * 1.5,
    prepare() { return {}; }, weight: 0.9,
    run() {
      const pts = [];
      let a = this.rng.range(0, Math.PI * 2);
      for (let i = 0; i < 7; i++) { a += this.rng.range(0.5, 1.1); const r = this.rng.range(300, 900); pts.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); }
      pts.push([0, 215]);
      this.createMission({ giver: 'hub', board: true, type: 'race', title: 'The Grand Dustbowl Derby', desc: `The biggest race of the season. ${pts.length} checkpoints across three zones. Winner takes the pot.`, obj: { kind: 'race', checkpoints: pts, idx: 0, x: pts[0][0], z: pts[0][1], timeLimit: Math.round(pts.reduce((acc, p, i) => acc + Math.hypot(p[0] - (pts[i - 1]?.[0] ?? 0), p[1] - (pts[i - 1]?.[1] ?? 210)), 0) / 24 + 25) }, reward: { caps: 350, items: { fuel: 30 } }, onComplete: { type: 'deed', kind: 'racer' } });
      this.chronicle('event', { title: 'Derby Season', text: 'Auntie Tallow announced the Grand Dustbowl Derby. The cantina is taking bets. The smart money is on whoever doesn\'t explode.', importance: 0, tags: ['hub'] });
    },
  },
  {
    id: 'alliance_offer', minDay: 3, cooldown: DAY_LEN,
    prepare() {
      const pf = this.s.factions[this.s.group.factionId];
      if (!pf?.isPlayer) return null;
      const cands = aliveFactions(this, (f) => !f.isPlayer && this.pact(f.id, pf.id) !== 'alliance' && !this.atWar(f.id, pf.id) && (this.s.group.rep[f.id] ?? 0) > 15 && this.enemies(f.id).length);
      return cands.length ? { f: this.rng.pick(cands).id } : null;
    },
    weight: 1.3,
    run(ctx) {
      const f = this.s.factions[ctx.f], pf = this.s.factions[this.s.group.factionId];
      this.offer({ from: f.id, title: 'An Alliance Proposed', text: `"We have common enemies, you and I. Ride with us." — ${this.leaderName(f)} of the ${f.name}`, choices: [{ label: 'Shake on it', action: [{ type: 'pact', a: f.id, b: pf.id, pact: 'alliance' }, { type: 'rep', fid: f.id, n: 10 }] }, { label: 'Decline', action: { type: 'rep', fid: f.id, n: -5 } }] });
    },
  },
  {
    id: 'spy', minDay: 3, cooldown: DAY_LEN,
    prepare() {
      const pairs = [];
      for (const a of aliveFactions(this, (f) => !f.isPlayer)) for (const b of aliveFactions(this, (f) => f !== a && !f.isPlayer)) if (this.rel(a.id, b.id) < 10 && b.traits.cunning > 0.5) pairs.push({ a: a.id, b: b.id });
      return pairs.length ? this.rng.pick(pairs) : null;
    },
    weight: 0.9,
    run(ctx) {
      const A = this.s.factions[ctx.a], B = this.s.factions[ctx.b];
      this.addRel(A.id, B.id, -30);
      A.grudges[B.id] = (A.grudges[B.id] || 0) + 25;
      this.chronicle('event', { title: `A ${B.short} Spy in ${this.capital(A.id)?.name || A.short}`, text: `${this.leaderName(A)}'s people caught a ${B.short} spy counting turrets. The spy was "returned" to the ${B.short} in several boxes. ${this.leaderName(B)} denies everything.`, importance: 1, factions: [A.id, B.id] });
    },
  },
  {
    id: 'rivalry', proc: true, minDay: 2, cooldown: DAY_LEN * 0.8,
    prepare() {
      const fs = aliveFactions(this, (f) => !f.isPlayer);
      if (fs.length < 2) return null;
      const a = this.rng.pick(fs), b = this.rng.pick(fs.filter((x) => x !== a));
      return this.pact(a.id, b.id) === 'alliance' ? null : { a: a.id, b: b.id };
    },
    weight: 1,
    run(ctx) { ARCS.rivalry.insult.call(this, ctx); },
  },
  {
    id: 'lost_cargo', minDay: 1, cooldown: DAY_LEN * 0.8,
    prepare() { return { zoneId: this.rng.pick(this.world.zones.filter((z) => z.biome !== 'hub')).id }; }, weight: 1,
    run(ctx) {
      const zd = this.zoneDef(ctx.zoneId);
      const x = Math.round(zd.cx + this.rng.range(-150, 150)), z = Math.round(zd.cz + this.rng.range(-150, 150));
      this.s.story.lootDrops = (this.s.story.lootDrops || []).concat([{ x, z, loot: { [this.rng.pick(['electronics', 'crystal', 'fuel', 'ammo'])]: this.rng.int(15, 30), caps: this.rng.int(40, 120) } }]);
      this.emit('lootDrops');
      this.createMission({ giver: 'hub', board: true, type: 'reach', title: 'Wreck on the Road', desc: `A caravan truck rolled in ${zd.name}. Its cargo is still there, for whoever gets there first.`, obj: { kind: 'reach', x, z, r: 15 }, reward: { caps: 20 } });
    },
  },
];

export { CARDS, ARCS };
void genDriverName;
