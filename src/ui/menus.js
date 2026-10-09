// All modal menus: map, journal/chronicle, crew & faction, hub, bases, market, cantina, pause, help.
import { RES_INFO, RESOURCES, BIOMES } from '../world/biomes.js';
import { STRUCTS, RANKS, RANK_REP, TILE, BUILD_ORDER, DAY_LEN, dayOf } from '../sim/defs.js';
import { buyPrice, sellPrice, unitPrice, localPrice, priceTrend } from '../sim/economy.js';
import { designStats, PART_TABLES } from '../vehicle/parts.js';
import { portrait } from './portrait.js';
import { HALF } from '../world/terrain.js';
import { GARAGE } from './garage.js';
import { BUILDER } from './builder.js';
import { HUB_SPOTS } from '../world/structures.js';
import { DIFFICULTY } from '../director.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
const bar = (v, color = '#ffd166', label = '') => `<div class="mbar" title="${label}"><i style="width:${pct(v)};background:${color}"></i>${label ? `<span>${label}</span>` : ''}</div>`;
const costTxt = (cost) => Object.entries(cost).map(([k, v]) => `${v}${RES_INFO[k]?.icon || k}`).join(' ') || 'free';
const relWord = (r) => (r >= 60 ? 'Beloved' : r >= 30 ? 'Friendly' : r >= 10 ? 'Warm' : r > -10 ? 'Neutral' : r > -35 ? 'Wary' : r > -60 ? 'Hostile' : 'Blood feud');
const relColor = (r) => (r >= 30 ? '#06d6a0' : r > -10 ? '#ffd166' : r > -35 ? '#ff9f43' : '#ff4d4d');

function sparkline(hist, w = 70, h = 18) {
  if (!hist || hist.length < 2) return '';
  const mn = Math.min(...hist), mx = Math.max(...hist);
  const pts = hist.map((v, i) => `${(i / (hist.length - 1)) * w},${h - ((v - mn) / Math.max(0.01, mx - mn)) * (h - 2) - 1}`).join(' ');
  const up = hist[hist.length - 1] >= hist[0];
  return `<svg width="${w}" height="${h}" class="spark"><polyline points="${pts}" fill="none" stroke="${up ? '#06d6a0' : '#ff6b6b'}" stroke-width="2"/></svg>`;
}

function leaderPic(sim, f, size = 72) {
  const n = sim.s.npcs[f.leaderId];
  return portrait(n?.portrait || 1, f.color, size, { glow: f.id === 'glowkin' });
}

// ---------------- Market (shared) ----------------
function marketHTML(ui, at) {
  const sim = ui.sim, s = sim.s, car = ui.game.player.car;
  const b = at && at !== 'hub' ? s.bases[at] : null;
  const f = b ? s.factions[b.factionId] : null;
  const own = b && f?.isPlayer;
  const stock = f ? sim.factionStock(f.id) : null;
  const rows = RESOURCES.map((r) => {
    const info = RES_INFO[r];
    const have = Math.floor(car.cargo[r] || 0);
    let buy, sell, avail;
    if (!b) { buy = buyPrice(s.market, r); sell = sellPrice(s.market, r); avail = Math.floor(s.market.stock[r]); }
    else if (own) { buy = 0; sell = null; avail = Math.floor(b.storage[r] || 0); }
    else { buy = localPrice(s.market, r, f, stock, false); sell = localPrice(s.market, r, f, stock, true); avail = Math.floor(b.storage[r] || 0); }
    const trend = priceTrend(s.market, r);
    return `<tr><td>${info.icon} ${info.name}</td><td>${!b ? sparkline(s.market.hist[r]) : ''} <span class="${trend > 0.05 ? 'up' : trend < -0.05 ? 'down' : ''}">${trend > 0.05 ? '▲' : trend < -0.05 ? '▼' : '•'}</span></td>
      <td class="num">${avail}</td><td class="num">${own ? '—' : `${buy}🪙`}</td><td class="num">${sell === null ? '—' : `${sell}🪙`}</td><td class="num">${have}</td>
      <td class="btns">${own ? `<button data-action="withdraw" data-res="${r}" data-n="10">Take 10</button><button data-action="withdraw" data-res="${r}" data-n="9999">Take all</button><button data-action="stash" data-res="${r}" data-n="9999" ${have ? '' : 'disabled'}>Stash all</button>` :
        `<button data-action="buy" data-res="${r}" data-n="1" data-at="${at || 'hub'}">+1</button><button data-action="buy" data-res="${r}" data-n="10" data-at="${at || 'hub'}">+10</button><button data-action="sell" data-res="${r}" data-n="10" data-at="${at || 'hub'}" ${have ? '' : 'disabled'}>-10</button><button data-action="sell" data-res="${r}" data-n="9999" data-at="${at || 'hub'}" ${have ? '' : 'disabled'}>Sell all</button>`}</td></tr>`;
  }).join('');
  const caps = s.group.wallet;
  return `<div class="market">${handInButton(ui, at || 'hub')}<div class="mk-head"><span>🪙 <b>${caps}</b> caps</span><span>📦 ${Math.round(car.cargoUsed())}/${car.stats.cargo} cargo</span>${b ? `<span>${esc(b.name)} — ${own ? 'your storage' : `${esc(f.short)} trade post (cheap where they're rich)`}</span>` : '<span>Hub Bazaar: prices follow supply & demand across the whole waste</span>'}</div>
    <div class="scroll"><table class="tbl"><tr><th>Goods</th><th>Trend</th><th>Stock</th><th>Buy</th><th>Sell</th><th>Cargo</th><th></th></tr>${rows}</table></div>
    ${!own ? `<div class="services"><b>Services:</b> <button data-action="service" data-kind="fuel" data-at="${at || 'hub'}">⛽ Refuel</button><button data-action="service" data-kind="ammo" data-at="${at || 'hub'}">🔸 Rearm</button><button data-action="service" data-kind="repair" data-at="${at || 'hub'}">🔧 Repair</button></div>` : `<div class="services"><button data-action="stashAll">📥 Stash all cargo</button><button data-action="service" data-kind="fuel" data-at="${at}">⛽ Refuel from stores</button><button data-action="service" data-kind="ammo" data-at="${at}">🔸 Rearm</button><button data-action="service" data-kind="repair" data-at="${at}">🔧 Repair</button></div>`}</div>`;
}

function handInButton(ui, at) {
  const s = ui.sim.s, car = ui.game.player.car;
  const due = Object.values(s.missions).filter((m) => m.status === 'active' && m.obj.kind === 'deliver' && (m.obj.baseId ? m.obj.baseId === at : at === 'hub'));
  if (!due.length) return '';
  return `<div class="card handin">${due.map((m) => `<div>📦 <b>${esc(m.title)}</b>: ${m.obj.amount} ${RES_INFO[m.obj.res].icon} (you carry ${Math.floor(car.cargo[m.obj.res] || 0)})</div>`).join('')}<button data-action="handIn" data-at="${at}">Hand over mission cargo</button></div>`;
}

const MARKET_ACTIONS = {
  async handIn(d) {
    const car = this.game.player.car;
    const cargo = {};
    for (const [k, v] of Object.entries(car.cargo)) cargo[k] = Math.floor(v);
    const r = await this.app.cmd('handIn', { cargo, at: d.at });
    if (r.ok) for (const [k, v] of Object.entries(r.used || {})) car.takeCargo(k, v);
    this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    this.refresh();
  },
  async sell(d) {
    const car = this.game.player.car;
    const n = Math.min(+d.n, Math.floor(car.cargo[d.res] || 0));
    if (n <= 0) return;
    car.takeCargo(d.res, n);
    const r = await this.app.cmd('sell', { res: d.res, n, at: d.at });
    if (!r.ok) car.addCargo(d.res, n);
    this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    if (r.ok) this.app.audio?.play('cash');
    this.refresh();
  },
  async buy(d) {
    const car = this.game.player.car;
    const n = Math.min(+d.n, Math.floor(car.cargoFree()));
    if (n <= 0) { this.toast('Cargo full!', 'warn'); return; }
    const r = await this.app.cmd('buy', { res: d.res, n, at: d.at });
    if (r.ok) { car.addCargo(d.res, r.got); this.app.audio?.play('cash'); }
    this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    this.refresh();
  },
  async stash(d) {
    const car = this.game.player.car;
    const b = this.modal.args.baseId;
    const n = Math.min(+d.n, Math.floor(car.cargo[d.res] || 0));
    if (!n) return;
    car.takeCargo(d.res, n);
    const r = await this.app.cmd('deposit', { baseId: b, cargo: { [d.res]: n } });
    const moved = r.moved?.[d.res] || 0;
    if (moved < n) car.addCargo(d.res, n - moved);
    this.toast(esc(r.msg) + (r.delivered ? ' — delivery complete!' : ''), r.ok ? 'good' : 'warn');
    this.refresh();
  },
  async stashAll() {
    const car = this.game.player.car;
    const cargo = { ...car.cargo };
    for (const k in cargo) cargo[k] = Math.floor(cargo[k]);
    for (const [k, v] of Object.entries(cargo)) car.takeCargo(k, v);
    const r = await this.app.cmd('deposit', { baseId: this.modal.args.baseId, cargo });
    for (const [k, v] of Object.entries(cargo)) { const back = v - (r.moved?.[k] || 0); if (back > 0) car.addCargo(k, back); }
    this.toast(esc(r.msg) + (r.delivered ? ' — delivery complete!' : ''), r.ok ? 'good' : 'warn');
    this.refresh();
  },
  async withdraw(d) {
    const car = this.game.player.car;
    const n = Math.min(+d.n, Math.floor(car.cargoFree()));
    if (n <= 0) { this.toast('Cargo full!', 'warn'); return; }
    const r = await this.app.cmd('withdraw', { baseId: this.modal.args.baseId, res: d.res, n });
    if (r.ok && r.got) car.addCargo(d.res, r.got);
    this.refresh();
  },
  async service(d) {
    const car = this.game.player.car;
    const st = car.stats;
    let amount = 0;
    if (d.kind === 'fuel') amount = Math.max(0, st.fuelCap - car.fuel);
    if (d.kind === 'ammo') amount = Math.max(0, (st.ammoCap - car.ammo) / 10);
    if (d.kind === 'repair') amount = Math.max(0, st.hp - car.hp);
    if (amount < 0.5) { this.toast('Already topped up', 'info'); return; }
    const r = await this.app.cmd('service', { kind: d.kind, amount, at: d.at });
    if (r.ok) {
      if (d.kind === 'fuel') car.fuel = st.fuelCap;
      if (d.kind === 'ammo') car.ammo = st.ammoCap;
      if (d.kind === 'repair') car.hp = st.hp;
      this.app.audio?.play('repair');
    }
    this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    this.refresh();
  },
};

// ---------------- Missions ----------------
function missionCard(ui, m, offered) {
  const sim = ui.sim;
  const f = sim.s.factions[m.giver];
  const rep = Object.entries(m.reward.rep || {}).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${esc(sim.s.factions[k]?.short || k)}`).join(', ');
  const unlock = m.reward.unlock ? ` · 🔓 ${[].concat(m.reward.unlock).join(', ')}` : m.reward.unlockTier ? ` · 🔓 tier ${m.reward.unlockTier}` : '';
  const tracked = ui.app.trackedMission === m.id;
  return `<div class="card mission ${m.status}"><div class="mc-head"><span class="chip" style="background:${f?.color || '#ffd166'}"></span><b>${esc(m.title)}</b><small>${f ? esc(f.short) : 'Hub'}</small></div>
    <p>${esc(m.desc)}</p><div class="mc-foot"><span>🪙 ${m.reward.caps || 0}${rep ? ` · ⭐ ${rep}` : ''}${unlock}${m.reward.items ? ` · 🎁 ${Object.entries(m.reward.items).map(([k, v]) => `${v}${RES_INFO[k]?.icon}`).join(' ')}` : ''}</span>
    ${offered ? `<button data-action="acceptMission" data-id="${m.id}">Accept</button>` : `<button data-action="trackMission" data-id="${m.id}" class="${tracked ? 'on' : ''}">${tracked ? 'Tracking' : 'Track'}</button><button data-action="abandonMission" data-id="${m.id}" class="ghost">Abandon</button>`}</div></div>`;
}

function availableMissions(ui, giverFilter = null) {
  const sim = ui.sim, s = sim.s;
  return Object.values(s.missions).filter((m) => m.status === 'offered' && (!giverFilter || giverFilter.includes(m.giver)) && ((s.group.rep[m.giver] ?? 0) > -20 || m.giver === 'hub'));
}

const MISSION_ACTIONS = {
  async acceptMission(d) {
    const r = await this.app.cmd('acceptMission', { id: d.id });
    this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    if (r.ok) { this.app.trackedMission = d.id; this.app.audio?.play('accept'); }
    this.refresh();
  },
  trackMission(d) { this.app.trackedMission = d.id; this.refresh(); },
  async abandonMission(d) { const r = await this.app.cmd('abandonMission', { id: d.id }); this.toast(esc(r.msg || 'Abandoned'), 'warn'); this.refresh(); },
};

// ---------------- Chronicle ----------------
function chronicleHTML(ui, filter) {
  const s = ui.sim.s;
  const list = s.chronicle.filter((c) => filter === 'all' || (filter === 'major' && c.importance >= 2) || (filter === 'you' && c.tags?.includes('player')));
  const history = list.filter((c) => c.tags?.includes('history'));
  const live = list.filter((c) => !c.tags?.includes('history'));
  const byDay = {};
  for (const c of live) (byDay[c.day] ||= []).push(c);
  const days = Object.keys(byDay).map(Number).sort((a, b) => b - a);
  return `<div class="chron-filters">${['all', 'major', 'you'].map((f) => `<button data-action="chronFilter" data-f="${f}" class="${f === filter ? 'on' : ''}">${f === 'all' ? 'Everything' : f === 'major' ? 'Great events' : 'Your legend'}</button>`).join('')}</div>
  <div class="scroll book">${days.map((d) => `<h3 class="day">Year ${s.year} A.B. — Day ${d}</h3>${byDay[d].slice().reverse().map((c) => `<div class="entry imp${c.importance}"><h4>${c.importance >= 3 ? '★ ' : ''}${esc(c.title)}</h4><p>${esc(c.text)}</p></div>`).join('')}`).join('')}
  ${history.length ? `<h3 class="day">Before the Stranger</h3>${history.map((c) => `<div class="entry imp2"><h4>Year ${c.year} — ${esc(c.title)}</h4><p>${esc(c.text)}</p></div>`).join('')}` : ''}</div>`;
}

// ---------------- Factions overview ----------------
function factionsHTML(ui) {
  const sim = ui.sim, s = sim.s;
  const fs = Object.values(s.factions).filter((f) => !f.bandit).sort((a, b) => (b.alive - a.alive) || (b.powerCache || 0) - (a.powerCache || 0));
  const myF = s.factions[s.group.factionId];
  return `<div class="scroll grid2">${fs.map((f) => {
    const rep = s.group.rep[f.id] ?? 0;
    const zones = Object.values(s.zones).filter((z) => z.owner === f.id).map((z) => ui.app.world.zones.find((q) => q.id === z.id)?.name);
    const pacts = Object.values(s.factions).filter((o) => o.alive && o !== f && !o.bandit && sim.pact(f.id, o.id)).map((o) => `<span class="pact ${sim.pact(f.id, o.id)}">${sim.pact(f.id, o.id) === 'war' ? '⚔️' : sim.pact(f.id, o.id) === 'alliance' ? '🤝' : '🏳️'} ${esc(o.short)}</span>`).join(' ');
    const T = f.traits;
    const canJoin = f.alive && !f.isPlayer && s.group.factionId !== f.id && !myF?.isPlayer;
    return `<div class="card faction ${f.alive ? '' : 'dead'}"><div class="fc-head"><img src="${f.isPlayer ? portrait(4242, f.color, 72) : leaderPic(sim, f)}"/><div><h3 style="color:${f.color}">${esc(f.name)}</h3><div class="muted">${f.isPlayer ? 'Led by you' : esc(sim.leaderName(f))} · ${esc(f.archetype || '')}</div><i>"${esc(f.motto)}"</i></div></div>
      ${f.alive ? `<div class="fc-stats"><span>👥 ${sim.isReplica ? f.memberCount ?? 0 : sim.members(f.id).length}</span><span>🏰 ${sim.factionBases(f.id).length}</span><span>🗺️ ${zones.length}</span><span>💪 ${Math.round(f.powerCache || sim.factionPower(f.id))}</span></div>
      ${!f.isPlayer ? `<div class="traits">${['aggression', 'honor', 'greed', 'cunning', 'ambition', 'caution'].map((k) => `<div><small>${k}</small>${bar(T[k] ?? 0.5, k === 'honor' ? '#06d6a0' : k === 'aggression' ? '#ff6b6b' : '#ffd166')}</div>`).join('')}</div>` : ''}
      <div>Your standing: <b style="color:${relColor(rep)}">${relWord(rep)} (${rep})</b>${s.group.factionId === f.id && !f.isPlayer ? ` · <b>${RANKS[s.group.rank]}</b>` : ''}</div>
      <div class="pacts">${pacts || '<span class="muted">No pacts</span>'}</div>
      <div class="muted small">Holds: ${zones.map(esc).join(', ') || 'nothing'}</div>
      <details><summary>Lore</summary><p>${esc(f.lore)}</p></details>
      ${canJoin ? `<button data-action="joinFaction" data-fid="${f.id}" ${rep >= 10 ? '' : 'disabled'}>${rep >= 10 ? `Join the ${esc(f.short)}` : 'Need reputation 10 to join'}</button>` : ''}` : `<p class="muted">This faction is no more.</p><details><summary>Lore</summary><p>${esc(f.lore)}</p></details>`}</div>`;
  }).join('')}</div>`;
}

// ---------------- Crew / own faction ----------------
function crewHTML(ui, st) {
  const sim = ui.sim, s = sim.s;
  const f = s.factions[s.group.factionId];
  const mem = sim.members(f.id).sort((a, b) => (a.squadId ? 1 : 0) - (b.squadId ? 1 : 0));
  const bases = sim.factionBases(f.id);
  const designs = s.group.designs;
  const beds = bases.reduce((t, b) => t + sim.baseBeds(b), 0);
  const wages = mem.reduce((t, n) => t + n.wage, 0);
  st.sel = st.sel || {};
  const selCount = Object.values(st.sel).filter(Boolean).length;
  const zones = ui.app.world.zones.filter((z) => z.biome !== 'hub');
  const targets = Object.values(s.bases).filter((b) => b.factionId !== f.id && sim.hostileTeams(f.id, b.factionId));
  return `<div class="crew-head"><span>👥 ${mem.length} crew</span><span>🛏️ ${beds} beds ${mem.length > beds ? '<b class="warn">— not enough beds!</b>' : ''}</span><span>💸 ${wages} caps/day wages</span><span>🪙 ${s.group.wallet}</span></div>
  ${mem.length ? '' : '<p class="muted">No crew yet. Hire drivers at the Leaky Radiator cantina in the Hub.</p>'}
  <div class="quest-bar ${selCount ? '' : 'dim'}"><b>${selCount} selected →</b>
    <select data-change="qtype"><option value="scavenge">Scavenge zone</option><option value="patrol">Patrol zone</option><option value="attack">Raid base</option><option value="defend">Guard base</option><option value="trade">Trade run to Hub</option><option value="follow">Escort me</option></select>
    <select data-change="qtarget">${st.qtype === 'attack' ? targets.map((b) => `<option value="${b.id}">${esc(b.name)} (${esc(s.factions[b.factionId]?.short)})</option>`).join('') : st.qtype === 'defend' || st.qtype === 'trade' ? bases.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('') : st.qtype === 'follow' ? '<option>—</option>' : zones.map((z) => `<option value="${z.id}">${esc(z.name)} (${BIOMES[z.biome].name})</option>`).join('')}</select>
    <button data-action="sendQuest" ${selCount ? '' : 'disabled'}>Send</button></div>
  <div class="scroll crew-list">${mem.map((n) => {
    const b = s.bases[n.baseId];
    const sq = s.squads[n.squadId];
    const queued = bases.some((x) => x.carQueue.some((j) => j.npcId === n.id));
    return `<div class="card crew ${n.loyalty < 30 ? 'unhappy' : ''}"><label class="sel"><input type="checkbox" data-action="selCrew" data-id="${n.id}" ${st.sel[n.id] ? 'checked' : ''} ${sq ? 'disabled' : ''}/></label>
      <img src="${portrait(n.portrait, f.color, 64)}"/><div class="crew-info"><b>${esc(n.name)}</b> <small>${n.role}${n.epithet ? ` ${esc(n.epithet)}` : ''}</small>
      <div class="crew-bars"><small>Skill</small>${bar(n.skill, '#7fd1ff')}<small>Nerve</small>${bar(n.courage, '#ff9f43')}<small>Loyalty</small>${bar(n.loyalty / 100, n.loyalty < 30 ? '#ff4d4d' : '#06d6a0')}</div>
      <div class="small">🚗 ${esc(n.design?.name || n.design?.chassis)} ${queued ? '<i>(new car in garage)</i>' : ''} · ${sq ? `🧭 ${esc(sq.name || sq.task.type)} <button class="mini" data-action="recall" data-sq="${sq.id}">Recall</button>` : `📍 ${esc(b?.name || 'nowhere')}`} ${n.unpaid ? `<b class="warn">unpaid ${n.unpaid}d</b>` : ''} ${n.hp < 0.6 ? '🩹' : ''}</div></div>
      <div class="crew-actions"><div>💸 <button class="mini" data-action="wage" data-id="${n.id}" data-d="-1">−</button> ${n.wage}/day <button class="mini" data-action="wage" data-id="${n.id}" data-d="1">+</button></div>
        <select data-change="assign" data-id="${n.id}" ${sq ? 'disabled' : ''}>${bases.map((x) => `<option value="${x.id}" ${x.id === n.baseId ? 'selected' : ''}>🏠 ${esc(x.name)}</option>`).join('')}</select>
        <select data-change="giveDesign" data-id="${n.id}" ${sq ? 'disabled' : ''}><option value="">🔧 Give a car design…</option>${designs.map((d, i) => `<option value="${i}">${esc(d.name)}</option>`).join('')}</select>
        <button class="mini" data-action="bonus" data-id="${n.id}">+25🪙 bonus</button><button class="mini ghost" data-action="dismiss" data-id="${n.id}">Dismiss</button></div></div>`;
  }).join('')}</div>`;
}

function basesHTML(ui) {
  const sim = ui.sim, s = sim.s;
  const f = s.factions[s.group.factionId];
  const bases = sim.factionBases(f.id);
  const routes = s.group.routes || [];
  return `<div class="scroll">${bases.map((b) => {
    const res = Object.values(s.npcs).filter((n) => n.alive && n.baseId === b.id).length;
    const prod = Object.entries(b.lastProd || {}).map(([k, v]) => `${RES_INFO[k].icon}${v.toFixed(1)}/h`).join(' ');
    const stor = Object.entries(b.storage).filter(([, v]) => v >= 1).map(([k, v]) => `${RES_INFO[k].icon}${Math.floor(v)}`).join(' ');
    return `<div class="card"><b>🏰 ${esc(b.name)}</b> <small>${esc(ui.app.world.zones.find((z) => z.id === b.zoneId)?.name)} · ${b.size}×${b.size} · ${b.structs.length} buildings</small>
      <div class="small">🛏️ ${res}/${sim.baseBeds(b)} beds · ⚡ ${b.power ? `${b.power.gen}/${b.power.use}` : '?'} · 🛡️ turrets ${b.structs.filter((x) => STRUCTS[x.type].weapon).length}${b.alarm > 0 ? ' · <b class="warn">UNDER ATTACK</b>' : ''}</div>
      <div class="small">Producing: ${prod || '—'}</div><div class="small">Storage: ${stor || 'empty'} (${Math.round(Object.values(b.storage).reduce((t, v) => t + v, 0))}/${sim.baseStorageCap(b)})</div>
      <button class="mini" data-action="waypoint" data-x="${b.x}" data-z="${b.z}">Set waypoint</button></div>`;
  }).join('')}
  <h3>🚚 Transport routes</h3><p class="muted small">Convoys haul goods between your bases automatically. The source base needs a Depot and at least one crew member living there.</p>
  ${routes.map((r) => `<div class="card row"><span>${esc(s.bases[r.from]?.name || '?')} → ${esc(s.bases[r.to]?.name || '?')} (${r.res === 'all' ? 'everything' : RES_INFO[r.res]?.name})</span><button class="mini ghost" data-action="removeRoute" data-id="${r.id}">Remove</button></div>`).join('') || '<p class="muted">No routes.</p>'}
  ${bases.length >= 2 ? `<div class="row"><select id="rt-from">${bases.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select> → <select id="rt-to">${bases.map((b, i) => `<option value="${b.id}" ${i === 1 ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <select id="rt-res"><option value="all">Everything</option>${RESOURCES.map((r) => `<option value="${r}">${RES_INFO[r].name}</option>`).join('')}</select><button data-action="addRoute">Add route</button></div>` : '<p class="muted">Found a second base to set up convoys.</p>'}
  <h3>📐 Base blueprints</h3>${s.group.baseBlueprints.map((bp, i) => `<div class="card row"><span>${esc(bp.name)} (${bp.items.length} buildings)</span></div>`).join('') || '<p class="muted">Save a layout from a base\'s Build tab, then have your crew build it elsewhere.</p>'}</div>`;
}

function diplomacyHTML(ui) {
  const sim = ui.sim, s = sim.s;
  const me = s.factions[s.group.factionId];
  const fs = Object.values(s.factions).filter((f) => f.alive && !f.bandit && f !== me);
  return `<div class="scroll">${fs.map((o) => {
    const r = sim.rel(me.id, o.id), pact = sim.pact(me.id, o.id);
    return `<div class="card diplo"><img src="${leaderPic(sim, o, 56)}"/><div><b style="color:${o.color}">${esc(o.name)}</b> <small>${esc(sim.leaderName(o))} · ${esc(o.archetype)}</small>
      <div>Relations <b style="color:${relColor(r)}">${r}</b> · ${pact ? `<span class="pact ${pact}">${pact}</span>` : 'no pact'} · honour ${Math.round((o.traits.honor ?? 0.5) * 100)}%</div></div>
      <div class="dip-btns">${pact === 'alliance' ? `<button class="danger" data-action="dip" data-fid="${o.id}" data-a="betray" title="Break the alliance with a surprise attack: their turrets are weakened, but everyone will remember">🗡️ Betray</button>` : ''}
      ${pact === 'war' ? `<button data-action="dip" data-fid="${o.id}" data-a="peace">🏳️ Sue for peace</button>` : ''}
      ${pact !== 'alliance' && pact !== 'war' ? `<button data-action="dip" data-fid="${o.id}" data-a="alliance">🤝 Propose alliance</button><button class="danger" data-action="dip" data-fid="${o.id}" data-a="war">⚔️ Declare war</button>` : ''}
      <button data-action="dip" data-fid="${o.id}" data-a="gift">🎁 Gift 100</button></div></div>`;
  }).join('')}</div>`;
}

const CREW_ACTIONS = {
  selCrew(d, el) { this.modal.state.sel[d.id] = el.checked; this.refresh(); },
  async sendQuest() {
    const st = this.modal.state;
    const ids = Object.entries(st.sel).filter(([, v]) => v).map(([k]) => k);
    const type = st.qtype || 'scavenge';
    const sel = this.root.querySelector('[data-change="qtarget"]');
    const target = sel?.value;
    const task = { type };
    if (type === 'scavenge' || type === 'patrol') task.zoneId = target;
    if (type === 'attack' || type === 'defend') task.baseId = target;
    if (type === 'trade') task.baseId = target;
    const r = await this.app.cmd('quest', { npcIds: ids, task });
    if (r.follow) this.app.startEscort(r.follow);
    this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    st.sel = {};
    this.refresh();
  },
  async recall(d) { const r = await this.app.cmd('recall', { squadId: d.sq }); this.toast(esc(r.msg), 'info'); this.refresh(); },
  async wage(d) { const n = this.sim.s.npcs[d.id]; const r = await this.app.cmd('setWage', { npcId: d.id, wage: n.wage + +d.d }); this.refresh(); void r; },
  async bonus(d) { const r = await this.app.cmd('bonus', { npcId: d.id, caps: 25 }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
  async dismiss(d) { const r = await this.app.cmd('dismiss', { npcId: d.id }); this.toast(esc(r.msg), 'info'); this.refresh(); },
  async addRoute() { const r = await this.app.cmd('addRoute', { fromId: document.getElementById('rt-from').value, toId: document.getElementById('rt-to').value, res: document.getElementById('rt-res').value }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
  async removeRoute(d) { await this.app.cmd('removeRoute', { id: d.id }); this.refresh(); },
  async dip(d) {
    if (d.a === 'betray' && !(await this.ask('Betray your ally? Their defences will be caught off guard, but the whole waste will remember this for a long, long time.', '🗡️ Betray them'))) return;
    const r = await this.app.cmd('diplomacy', { fid: d.fid, action: d.a });
    this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    this.refresh();
  },
  waypoint(d) { this.app.setWaypoint(+d.x, +d.z); this.toast('Waypoint set', 'info'); },
  async joinFaction(d) { const r = await this.app.cmd('join', { fid: d.fid }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
  async leaveFaction() { if (!(await this.ask('Leave your faction? They will not be pleased.', 'Leave'))) return; const r = await this.app.cmd('leave', {}); this.toast(esc(r.msg), r.ok ? 'info' : 'warn'); this.refresh(); },
  async coup() { if (!(await this.ask('Attempt to seize control of the faction? If it fails, they will hunt you.', '👑 Make my move'))) return; const r = await this.app.cmd('coup', {}); this.toast(esc(r.msg), r.ok ? 'good' : 'bad'); this.refresh(); },
  chronFilter(d) { this.modal.state.chron = d.f; this.refresh(); },
};
const CREW_CHANGES = {
  qtype(v) { this.modal.state.qtype = v; this.refresh(); },
  qtarget() {},
  async assign(v, el) { const r = await this.app.cmd('assign', { npcId: el.dataset.id, baseId: v }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
  async giveDesign(v, el) { if (v === '') return; const r = await this.app.cmd('giveDesign', { npcId: el.dataset.id, index: +v }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
};

// ---------------- Map ----------------
function mapRender(ui) {
  return `<div class="map-wrap"><canvas id="bigmap" width="720" height="720"></canvas><div class="map-side" id="map-side">${mapSide(ui)}</div></div>`;
}
function mapSide(ui) {
  const sim = ui.sim, s = sim.s;
  const zid = ui.modal?.state.zone;
  if (!zid) return `<h3>The Wasteland</h3><p class="muted">Click a zone for details. Outer zones are richer — and held by the strongest factions.</p>
    <div class="legend">${Object.values(s.factions).filter((f) => f.alive && !f.bandit).map((f) => `<div><span class="chip" style="background:${f.color}"></span>${esc(f.name)}</div>`).join('')}<div><span class="chip" style="background:#777"></span>Unclaimed / wild</div><div>◆ mission · ● you · ▲ warbands & convoys</div></div>`;
  const zd = ui.app.world.zones.find((z) => z.id === zid);
  const z = s.zones[zid];
  const f = s.factions[z.owner];
  const bases = Object.values(s.bases).filter((b) => b.zoneId === zid);
  return `<h3>${esc(zd.name)}</h3><div class="muted">${BIOMES[zd.biome].name} · ${zd.ring === 2 ? 'Outer ring' : zd.ring === 1 ? 'Inner ring' : 'Centre'}</div><p>${esc(BIOMES[zd.biome].desc)}</p>
    <div><b>Owner:</b> ${f ? `<span style="color:${f.color}">${esc(f.name)}</span>` : zd.biome === 'hub' ? 'The Hub Accord' : '<b class="good">Nobody — claimable!</b>'}</div>
    <div><b>Resources:</b> ${Object.entries(zd.richness).filter(([, v]) => v > 0).map(([k, v]) => `${RES_INFO[k].icon} ${RES_INFO[k].name} ${'★'.repeat(Math.max(1, Math.round(v)))}`).join(', ') || '—'}</div>
    <div><b>Bases:</b> ${bases.map((b) => `${esc(b.name)} (${esc(s.factions[b.factionId]?.short)})`).join(', ') || 'none'}</div>
    <button data-action="waypoint" data-x="${Math.round(zd.cx)}" data-z="${Math.round(zd.cz)}">📍 Set waypoint</button>
    ${z.claimable && zd.biome !== 'hub' ? '<p class="small">Drive there and press <kbd>B</kbd> to found a base.</p>' : ''}`;
}
function drawBigMap(ui) {
  const c = document.getElementById('bigmap');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width;
  const sim = ui.sim, s = sim.s, g = ui.game, T = g.terrain;
  if (!ui.mapBg) ui.buildMapBg();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(ui.mapBg, 0, 0, W, W);
  // owner tint
  const N = 120;
  const cell = W / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * (HALF * 2 / N), z = -HALF + (j + 0.5) * (HALF * 2 / N);
    const zone = T.zoneAt(x, z);
    const own = s.zones[zone.id]?.owner;
    const f = s.factions[own];
    if (f) { ctx.fillStyle = f.color + '55'; ctx.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5); }
    if (ui.modal?.state.zone === zone.id) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5); }
    // borders
    const zr = T.zoneAt(x + HALF * 2 / N, z), zd = T.zoneAt(x, z + HALF * 2 / N);
    ctx.fillStyle = 'rgba(43,29,20,0.55)';
    if (zr.id !== zone.id) ctx.fillRect((i + 1) * cell - 1, j * cell, 2, cell + 0.5);
    if (zd.id !== zone.id) ctx.fillRect(i * cell, (j + 1) * cell - 1, cell + 0.5, 2);
  }
  const toMap = (x, z) => [((x + HALF) / (HALF * 2)) * W, ((z + HALF) / (HALF * 2)) * W];
  ctx.font = '13px Lilita One, sans-serif'; ctx.textAlign = 'center';
  for (const zd of ui.app.world.zones) {
    const [x, y] = toMap(zd.cx, zd.cz);
    ctx.fillStyle = '#2b1d14'; ctx.fillText(zd.name, x + 1, y + 1); ctx.fillStyle = '#fff'; ctx.fillText(zd.name, x, y);
  }
  for (const b of Object.values(s.bases)) {
    const [x, y] = toMap(b.x, b.z);
    const f = s.factions[b.factionId];
    ctx.fillStyle = f?.color || '#888'; ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 2;
    const r = b.capital ? 7 : b.scav ? 4 : 5;
    ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    if (b.alarm > 0) { ctx.strokeStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke(); }
  }
  for (const sq of Object.values(s.squads)) {
    if (sq.factionId === 'scavvers') continue;
    const [x, y] = toMap(sq.x, sq.z);
    const f = s.factions[sq.factionId];
    const a = Math.atan2(sq.tz - sq.z, sq.tx - sq.x);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = f?.color || '#888'; ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 5); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (sq.task.type === 'attack' && s.bases[sq.task.targetBaseId]) { const [tx, ty] = toMap(sq.tx, sq.tz); ctx.strokeStyle = (f?.color || '#888') + 'aa'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]); }
  }
  for (const m of Object.values(s.missions)) {
    if (m.status !== 'active' || m.obj.x === undefined) continue;
    const [x, y] = toMap(m.obj.x, m.obj.z);
    ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (ui.app.waypoint) { const [x, y] = toMap(ui.app.waypoint.x, ui.app.waypoint.z); ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke(); }
  for (const c of g.cars) {
    if (!(c.isPlayer || c.isRemotePlayer)) continue;
    const [x, y] = toMap(c.body.pos.x, c.body.pos.z);
    ctx.fillStyle = c.isPlayer ? '#fff' : '#00e5ff'; ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  c.onclick = (e) => {
    const r = c.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W, my = ((e.clientY - r.top) / r.height) * W;
    const wx = (mx / W) * HALF * 2 - HALF, wz = (my / W) * HALF * 2 - HALF;
    ui.modal.state.zone = T.zoneAt(wx, wz).id;
    if (e.shiftKey) ui.app.setWaypoint(wx, wz);
    document.getElementById('map-side').innerHTML = mapSide(ui);
    drawBigMap(ui);
  };
}

// ---------------- Cantina (recruits + rumours) ----------------
function cantinaHTML(ui) {
  const sim = ui.sim, s = sim.s;
  const pool = s.recruitPool.map((id) => s.npcs[id]).filter((n) => n && n.alive && !n.factionId);
  const pf = s.factions[s.group.factionId];
  const can = pf?.isPlayer;
  const rumours = s.chronicle.filter((c) => !c.tags?.includes('history')).slice(-4).reverse();
  return `<div class="cantina"><p class="muted">The Leaky Radiator smells of engine grease and bean stew. Sully Two-Mugs polishes a glass with a sock.</p>
  ${can ? '' : '<p class="warn">You need your own faction to hire crew. Claim an unowned zone (press B out there) to found one.</p>'}
  <div class="grid3">${pool.map((n) => `<div class="card recruit"><img src="${portrait(n.portrait, '#e9c46a', 72)}"/><b>${esc(n.name)}</b><small>${n.epithet ? esc(n.epithet) : n.role === 'lieutenant' ? 'veteran officer' : 'driver'}</small>
    <div class="crew-bars"><small>Skill</small>${bar(n.skill, '#7fd1ff')}<small>Nerve</small>${bar(n.courage, '#ff9f43')}<small>Loyal</small>${bar(n.loyaltyTrait, '#06d6a0')}<small>Greed</small>${bar(n.greed, '#ffd166')}</div>
    <div>💸 ${n.wage}/day · ✍️ ${n.signing || 20} signing</div><div class="small">🚗 ${esc(n.design?.name || 'Rat Rod')}</div>
    <button data-action="hire" data-id="${n.id}" ${can ? '' : 'disabled'}>Hire</button></div>`).join('') || '<p class="muted">Nobody looking for work today. Check back tomorrow.</p>'}</div>
  <h3>🗣️ Gossip</h3>${rumours.map((c) => `<div class="entry"><h4>${esc(c.title)}</h4><p>${esc(c.text)}</p></div>`).join('')}</div>`;
}

// ---------------- Menus ----------------
export const MENUS = {
  map: {
    wide: true,
    title() { return '🗺️ Map of the Waste'; },
    render() { return mapRender(this); },
    after() { drawBigMap(this); },
    actions: { waypoint: CREW_ACTIONS.waypoint },
  },

  journal: {
    wide: true,
    title() { return '📖 Journal'; },
    tabs() { return [['missions', '🎯 Missions'], ['offers', `✉️ Offers (${this.sim.s.group.offers.length})`], ['chronicle', '📜 Chronicle'], ['factions', '⚑ Factions'], ['legend', '⭐ Your Legend']]; },
    render(args, tab, st) {
      const s = this.sim.s;
      if (tab === 'missions') {
        const active = Object.values(s.missions).filter((m) => m.status === 'active');
        const offered = availableMissions(this).slice(0, 14);
        const done = Object.values(s.missions).filter((m) => m.status === 'done' || m.status === 'failed').slice(-6).reverse();
        return `<div class="scroll"><h3>Active</h3>${active.map((m) => missionCard(this, m, false)).join('') || '<p class="muted">No active missions. Check the job board below, or visit faction bases.</p>'}
          <h3>Available jobs</h3>${offered.map((m) => missionCard(this, m, true)).join('') || '<p class="muted">Nothing on offer right now.</p>'}
          ${done.length ? `<h3>Recently finished</h3>${done.map((m) => `<div class="small ${m.status}">${m.status === 'done' ? '✅' : '❌'} ${esc(m.title)}</div>`).join('')}` : ''}</div>`;
      }
      if (tab === 'offers') {
        return `<div class="scroll">${s.group.offers.map((o) => `<div class="card"><b>${esc(o.title)}</b><p>${esc(o.text)}</p><div class="dlg-choices">${o.choices.map((c, i) => `<button data-action="offerChoice2" data-id="${o.id}" data-i="${i}">${esc(c.label)}</button>`).join('')}</div></div>`).join('') || '<p class="muted">No pending offers.</p>'}</div>`;
      }
      if (tab === 'chronicle') return chronicleHTML(this, st.chron || 'all');
      if (tab === 'factions') return factionsHTML(this);
      if (tab === 'legend') {
        const g = s.group;
        return `<div class="scroll legend-page"><h2>${esc(this.sim.playerTitle())}</h2><p>Leader of <b>${esc(s.factions[g.factionId]?.name || 'nothing yet')}</b></p>
          <div class="grid3"><div class="card"><b>${g.kills}</b><br/>cars wrecked</div><div class="card"><b>${g.missionsDone}</b><br/>jobs done</div><div class="card"><b>${g.deeds.betrayer || 0}</b><br/>betrayals</div><div class="card"><b>${g.deeds.conqueror || 0}</b><br/>flags planted</div><div class="card"><b>${Math.round(g.deeds.trader || 0)}</b><br/>caps traded</div><div class="card"><b>${g.deeds.racer || 0}</b><br/>races won</div></div>
          <h3>Titles</h3>${g.epithets.map((e) => `<div>🏅 "${esc(e.name)}" — earned day ${e.day}</div>`).join('') || '<p class="muted">Nobody has given you a nickname yet.</p>'}
          <h3>Parts unlocked</h3><p>Tier ${g.unlocked.tier}${g.unlocked.extra.length ? ` + ${g.unlocked.extra.join(', ')}` : ''}</p>
          <h3>Your story so far</h3>${s.chronicle.filter((c) => c.tags?.includes('player')).map((c) => `<div class="entry"><h4>Day ${c.day}: ${esc(c.title)}</h4><p>${esc(c.text)}</p></div>`).join('') || '<p class="muted">Your legend is yet to be written.</p>'}</div>`;
      }
      return '';
    },
    actions: { ...MISSION_ACTIONS, ...CREW_ACTIONS, async offerChoice2(d) { const r = await this.app.cmd('answerOffer', { id: d.id, choice: +d.i }); this.dialogQueue = this.dialogQueue.filter((o) => o.id !== d.id); if (r?.msg) this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); } },
  },

  crew: {
    wide: true,
    title() { const f = this.sim.s.factions[this.sim.s.group.factionId]; return f ? `<span style="color:${f.color}">⚑ ${esc(f.name)}</span>` : '⚑ Faction'; },
    tabs() {
      const f = this.sim.s.factions[this.sim.s.group.factionId];
      if (!f) return [['none', 'No faction']];
      if (!f.isPlayer) return [['member', 'Your Faction'], ['factions', 'All Factions']];
      return [['crew', '👥 Crew'], ['bases', '🏰 Bases & Convoys'], ['diplomacy', '🤝 Diplomacy'], ['factions', '⚑ Factions']];
    },
    render(args, tab, st) {
      const s = this.sim.s, sim = this.sim;
      const f = s.factions[s.group.factionId];
      if (tab === 'none') return `<div class="center-msg"><h3>You ride alone.</h3><p>Join a faction (do a job for them first) — or found your own by claiming an unowned zone: drive there and press <kbd>B</kbd>.</p>${factionsHTML(this)}</div>`;
      if (tab === 'factions') return factionsHTML(this);
      if (tab === 'member') {
        const rep = s.group.rep[f.id] ?? 0;
        const next = RANK_REP[s.group.rank + 1];
        return `<div class="scroll"><div class="fc-head"><img src="${leaderPic(sim, f, 96)}"/><div><h2 style="color:${f.color}">${esc(f.name)}</h2><div>${esc(sim.leaderName(f))} — ${esc(f.archetype)}</div><i>"${esc(f.motto)}"</i></div></div>
          <p>Rank: <b>${RANKS[s.group.rank]}</b> · Reputation ${rep}${next !== undefined ? ` (next rank at ${next})` : ''}</p>${bar((rep + 100) / 200, f.color)}
          <p class="small">Rank perks: Road Captain unlocks tier-2 parts. Right Hand lets you attempt a coup and take the faction for yourself.</p>
          <p>${esc(f.lore)}</p><h3>Wars & pacts</h3><div class="pacts">${Object.values(s.factions).filter((o) => o.alive && o !== f && sim.pact(f.id, o.id)).map((o) => `<span class="pact ${sim.pact(f.id, o.id)}">${sim.pact(f.id, o.id)} · ${esc(o.short)}</span>`).join(' ') || 'None'}</div>
          <div class="row">${s.group.rank >= 4 ? '<button class="danger" data-action="coup">👑 Seize control (coup)</button>' : ''}<button class="ghost" data-action="leaveFaction">Leave faction</button></div></div>`;
      }
      if (tab === 'crew') return crewHTML(this, st);
      if (tab === 'bases') return basesHTML(this);
      if (tab === 'diplomacy') return diplomacyHTML(this);
      return '';
    },
    actions: CREW_ACTIONS,
    changes: CREW_CHANGES,
  },

  hub: {
    wide: true,
    title() { return '🕊️ The Hub'; },
    tabs() { return [['bazaar', '🏪 Bazaar'], ['garage', '🔧 Garage'], ['cantina', '🍺 Cantina'], ['jobs', '📋 Job Board'], ['inn', '🛏️ Inn'], ['mayor', '📜 Auntie Tallow']]; },
    render(args, tab, st) {
      const s = this.sim.s;
      if (tab === 'bazaar') return marketHTML(this, 'hub');
      if (tab === 'garage') return GARAGE.render.call(this, { at: 'hub' }, st);
      if (tab === 'cantina') return cantinaHTML(this);
      if (tab === 'jobs') { const list = availableMissions(this); return `<div class="scroll">${handInButton(this, 'hub')}${list.map((m) => missionCard(this, m, true)).join('') || '<p class="muted">No jobs right now.</p>'}</div>`; }
      if (tab === 'inn') return `<div class="center-msg"><h3>Snooze Cruise Inn</h3><p>A bed, a bucket of water and a door that mostly locks. 15 caps.</p><p>Sleeping skips to morning and sets your respawn point here.</p><button data-action="sleep" data-base="hub">Sleep (15 caps)</button></div>`;
      if (tab === 'mayor') {
        const g = s.group;
        return `<div class="scroll mayor"><div class="fc-head"><img src="${portrait(777, '#5fb3d9', 96)}"/><div><h3>Auntie Tallow, Mayor of the Hub</h3><i>"No blood inside these walls, sugar. Outside? Well. That's your business."</i></div></div>
          <h3>How the waste works</h3><ul>
          <li><b>Factions</b> hold zones with bases. The outer ring is rich and held by the strongest. Raze every base in a zone and it becomes <b>claimable</b>.</li>
          <li><b>Join</b> a faction by doing jobs for them (reputation 10+), rise through the ranks — or <b>found your own</b>: drive to an unclaimed zone and press <kbd>B</kbd>.</li>
          <li>Your crew needs <b>beds</b>, food, water and <b>wages</b> every morning. Unpaid crews get ideas.</li>
          <li><b>Mines and pumps</b> need workers or Auto-Rigs. <b>Depots</b> let convoys move goods between bases.</li>
          <li>Prices follow <b>supply and demand</b>. Factions fight over the markets they share.</li>
          <li>Design cars in the garage, save them, and <b>give designs to your crew</b> — their garage will build them.</li>
          <li>Sleep at a base to set where you respawn. With no bases, you wake up here.</li></ul>
          <h3>Schematics</h3><p>Wrench Wendy sells part schematics. Or find Old-World bunkers.</p>
          <button data-action="buyTier" data-t="2" ${g.unlocked.tier >= 2 ? 'disabled' : ''}>Tier 2 parts — 600 caps</button> <button data-action="buyTier" data-t="3" ${g.unlocked.tier >= 3 || g.unlocked.tier < 2 ? 'disabled' : ''}>Tier 3 parts — 1800 caps</button></div>`;
      }
      return '';
    },
    after(body, args, tab) { if (tab === 'garage') GARAGE.after.call(this, body, { at: 'hub' }, this.modal.state); },
    onClose() { GARAGE.dispose?.call(this); },
    actions: {
      ...MARKET_ACTIONS, ...MISSION_ACTIONS, ...GARAGE.actions, ...CREW_ACTIONS,
      async hire(d) { const r = await this.app.cmd('hire', { npcId: d.id }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
      async sleep(d) {
        if (d.base === 'hub') { if (this.sim.s.group.wallet < 15) { this.toast('Not enough caps', 'warn'); return; } }
        const r = await this.app.sleep(d.base);
        if (r?.ok) this.close();
      },
      async buyTier(d) { const r = await this.app.cmd('buyBlueprint', { tier: +d.t }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
    },
    changes: { ...GARAGE.changes },
    inputs: { ...GARAGE.inputs },
  },

  base: {
    wide: true,
    title(args) { const b = this.sim.s.bases[args.baseId]; const f = this.sim.s.factions[b?.factionId]; return b ? `🏰 ${esc(b.name)} <small style="color:${f?.color}">${esc(f?.name || '')}</small>` : 'Base'; },
    tabs(args) {
      const s = this.sim.s, b = s.bases[args.baseId];
      if (!b) return [];
      const own = b.factionId === s.group.factionId && s.factions[b.factionId]?.isPlayer;
      const member = b.factionId === s.group.factionId;
      const allied = this.sim.pact(b.factionId, s.group.factionId) === 'alliance';
      const t = [];
      if (own) t.push(['build', '🔨 Build'], ['storage', '📦 Storage']);
      if (b.structs.some((st) => st.type === 'garage') && (own || member || allied)) t.push(['garage', '🔧 Garage']);
      if (!own && b.structs.some((st) => st.type === 'market')) t.push(['trade', '🏪 Trade']);
      if (!own) t.push(['jobs', '📋 Jobs']);
      if (own || member || allied) t.push(['sleep', '🛏️ Sleep']);
      t.push(['info', 'ℹ️ Info']);
      return t;
    },
    render(args, tab, st) {
      const s = this.sim.s, sim = this.sim, b = s.bases[args.baseId];
      if (!b) return '<p>This base is gone.</p>';
      if (tab === 'build') return BUILDER.render.call(this, args, st);
      if (tab === 'storage') return marketHTML(this, b.id);
      if (tab === 'trade') return marketHTML(this, b.id);
      if (tab === 'garage') return GARAGE.render.call(this, { at: b.id }, st);
      if (tab === 'jobs') { const list = availableMissions(this, [b.factionId]); return `<div class="scroll">${handInButton(this, b.id)}${list.map((m) => missionCard(this, m, true)).join('') || '<p class="muted">No jobs from them right now.</p>'}</div>`; }
      if (tab === 'sleep') return `<div class="center-msg"><h3>Bunk down at ${esc(b.name)}</h3><p>Sleep until morning and respawn here if you get wrecked.</p><button data-action="sleep" data-base="${b.id}">Sleep</button></div>`;
      if (tab === 'info') {
        const f = s.factions[b.factionId];
        return `<div class="scroll"><p>${esc(f?.name)} base in ${esc(this.app.world.zones.find((z) => z.id === b.zoneId)?.name)}. Level ${b.level} (${b.size}×${b.size} tiles).</p>
          <div class="grid3">${Object.entries(b.structs.reduce((m, x) => ((m[x.type] = (m[x.type] || 0) + 1), m), {})).map(([k, v]) => `<div class="card">${STRUCTS[k].icon} ${STRUCTS[k].name} ×${v}</div>`).join('')}</div>
          <p class="small">Defence rating ×${sim.siteDefenseMod(b).toFixed(2)} from terrain (canyons, mesas and high ground help).</p></div>`;
      }
      return '';
    },
    after(body, args, tab) { if (tab === 'build') BUILDER.after.call(this, body, args, this.modal.state); if (tab === 'garage') GARAGE.after.call(this, body, { at: args.baseId }, this.modal.state); },
    onClose() { GARAGE.dispose?.call(this); },
    actions: {
      ...MARKET_ACTIONS, ...MISSION_ACTIONS, ...BUILDER.actions, ...GARAGE.actions,
      async sleep(d) { const r = await this.app.sleep(d.base); if (r?.ok) this.close(); },
    },
    changes: { ...BUILDER.changes, ...GARAGE.changes },
    inputs: { ...BUILDER.inputs, ...GARAGE.inputs },
  },

  garage: {
    wide: true,
    title() { return '🔧 Garage'; },
    render(args, tab, st) { return GARAGE.render.call(this, args, st); },
    after(body, args) { GARAGE.after.call(this, body, args, this.modal.state); },
    onClose() { GARAGE.dispose?.call(this); },
    actions: GARAGE.actions, changes: GARAGE.changes, inputs: GARAGE.inputs,
  },

  found: {
    title() { return '⚑ Found a Faction'; },
    render(args, tab, st) {
      const s = this.sim.s;
      st.color = st.color || '#ff7f50';
      st.accent = st.accent || '#ffd166';
      const zone = this.app.world.zones.find((z) => z.id === args.zoneId);
      return `<div class="form"><p>Plant your flag in <b>${esc(zone?.name)}</b>. Founding costs <b>150 caps</b> and 80 scrap for the HQ (bought for you if you're short). ${s.group.factionId && !s.factions[s.group.factionId]?.isPlayer ? `<b class="warn">You will leave the ${esc(s.factions[s.group.factionId].short)}.</b>` : ''}</p>
        <label>Name <input data-input="fname" value="${esc(st.name || `${s.group.leaderName?.split(' ')[0] || 'Dust'}'s Riders`)}" maxlength="28"/></label>
        <label>Motto <input data-input="fmotto" value="${esc(st.motto || 'We go where we please.')}" maxlength="60"/></label>
        <label>Colours <input type="color" data-input="fcolor" value="${st.color}"/> <input type="color" data-input="faccent" value="${st.accent}"/></label>
        <button data-action="doFound">⚑ Found faction here</button></div>`;
    },
    inputs: { fname(v) { this.modal.state.name = v; }, fmotto(v) { this.modal.state.motto = v; }, fcolor(v) { this.modal.state.color = v; }, faccent(v) { this.modal.state.accent = v; } },
    actions: {
      async doFound() {
        const st = this.modal.state, a = this.modal.args;
        const r = await this.app.cmd('found', { name: st.name || `${this.sim.s.group.leaderName?.split(' ')[0] || 'Dust'}'s Riders`, motto: st.motto, color: st.color, accent: st.accent, x: a.x, z: a.z });
        this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
        if (r.ok) { this.close(); this.banner('A NEW FACTION RISES', esc(st.name || ''), st.color); this.app.audio?.play('fanfare'); this.app.onTeamChanged(); setTimeout(() => this.open('base', { baseId: r.baseId, tab: 'build' }), 600); }
      },
    },
  },

  pause: {
    title() { return '⏸ Paused'; },
    tabs() { return [['main', 'Menu'], ['settings', 'Settings'], ['controls', 'Controls'], ['coop', 'Co-op']]; },
    render(args, tab) {
      const app = this.app, set = app.settings;
      if (tab === 'main') return `<div class="center-msg"><button data-action="resume">▶ Resume</button><button data-action="save">💾 Save game</button><button data-action="load">📂 Load last save</button><button class="ghost" data-action="quit">🏠 Quit to title</button><p class="muted small">The game autosaves when you sleep and every few minutes.</p></div>`;
      if (tab === 'settings') return `<div class="form"><label>Graphics <select data-change="quality">${[['0.3', 'Potato'], ['0.6', 'Medium'], ['1', 'High']].map(([v, l]) => `<option value="${v}" ${+v === set.quality ? 'selected' : ''}>${l}</option>`).join('')}</select> <small>(reload to fully apply)</small></label>
        <label>Difficulty <select data-change="difficulty">${Object.entries(DIFFICULTY).map(([k, d]) => `<option value="${k}" ${k === set.difficulty ? 'selected' : ''}>${d.name}</option>`).join('')}</select></label>
        <label>Volume <input type="range" min="0" max="1" step="0.05" value="${set.volume}" data-input="volume"/></label>
        <label>Music <input type="range" min="0" max="1" step="0.05" value="${set.music}" data-input="music"/></label>
        <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.1" value="${set.sens}" data-input="sens"/></label>
        <label><input type="checkbox" data-change="invertY" ${set.invertY ? 'checked' : ''}/> Invert mouse Y</label>
        <label><input type="checkbox" data-change="showStats" ${set.showStats ? 'checked' : ''}/> Show performance stats (F3)</label></div>`;
      if (tab === 'controls') return HELP_HTML;
      if (tab === 'coop') {
        if (app.net) return app.net.statusHTML();
        const artifact = import.meta.env?.MODE === 'artifact';
        const blurb = artifact
          ? 'Friends who can open this artifact join your world from its title screen (<b>Join a Friend</b>). No codes to type, nothing to install.'
          : 'Your browser hosts the world. You get a link: friends open it and they\'re in.';
        const btn = app.canHost === false
          ? '<p class="warn">Only the owner or editors of this artifact can host here. Ask them to host, then pick their game under <b>Join a Friend</b>.</p>'
          : '<button data-action="hostNow">🌐 Open this game to friends</button>';
        return `<div class="center-msg"><h3>Play with friends</h3><p>${blurb}</p>${btn}<p class="muted small">Friends share your crew, wallet and faction. Keep this tab open while they play.</p></div>`;
      }
      return '';
    },
    actions: {
      resume() { this.close(); },
      save() { this.app.save(); this.toast('Game saved', 'good'); },
      load() { this.close(); this.app.loadSaved(); },
      quit() { this.close(); this.app.quitToTitle(); },
      async hostNow() { await this.app.startHosting(); this.refresh(); },
      copyCode() { copyText(this.app.net?.code || '', this); },
      copyInvite() { copyText(this.app.net?.inviteLink() || '', this); },
    },
    changes: {
      quality(v) { this.app.settings.quality = +v; this.app.saveSettings(); this.app.applySettings(); },
      difficulty(v) { this.app.settings.difficulty = v; this.app.saveSettings(); this.app.applySettings(); },
      invertY(v, el) { this.app.settings.invertY = el.checked; this.app.saveSettings(); },
      showStats(v, el) { this.app.stats.setVisible(el.checked); this.app.settings.showStats = el.checked; this.app.saveSettings(); },
    },
    inputs: {
      volume(v) { this.app.settings.volume = +v; this.app.saveSettings(); this.app.applySettings(); },
      music(v) { this.app.settings.music = +v; this.app.saveSettings(); this.app.applySettings(); },
      sens(v) { this.app.settings.sens = +v; this.app.saveSettings(); },
    },
  },
};

export const HELP_HTML = `<div class="scroll help"><div class="grid2"><div><h3>Driving</h3><ul><li><kbd>W</kbd><kbd>S</kbd> throttle / brake & reverse</li><li><kbd>A</kbd><kbd>D</kbd> steer (in the air: spin)</li><li><kbd>Space</kbd> handbrake — drift!</li><li><kbd>Shift</kbd> nitro (needs Nitro Bottles)</li><li><kbd>Q</kbd> jump jets (if fitted) · <kbd>E</kbd> roll in the air</li><li><kbd>R</kbd> flip upright · <kbd>H</kbd> honk · <kbd>C</kbd> camera</li><li>In the air, <kbd>W</kbd>/<kbd>S</kbd> pitch for flips. Land 1.5s+ jumps for stunt bonuses.</li></ul></div>
<div><h3>Fighting</h3><ul><li><b>Mouse</b> aim (click the game to capture the mouse) · wheel zooms</li><li><b>Left click</b> fire guns · <b>Right click</b>/<kbd>F</kbd> rear weapons (mines, oil)</li><li>Guns use ammo, lasers & tesla use energy, flamers burn petrol.</li><li>Ram with heavy cars and ram plates. Mass matters!</li><li>The Hub is a no-fighting zone.</li></ul></div>
<div><h3>Menus</h3><ul><li><kbd>E</kbd> interact (Hub, bases)</li><li><kbd>M</kbd> map · <kbd>J</kbd> journal & chronicle</li><li><kbd>F</kbd> hold for rear weapons · <kbd>Tab</kbd> crew & faction</li><li><kbd>G</kbd> garage (at the Hub or a base with a garage)</li><li><kbd>B</kbd> found a base / build at your base</li><li><kbd>Esc</kbd> pause, save, co-op</li></ul></div>
<div><h3>Tips</h3><ul><li>Drive over glowing piles to scavenge. Sell at the Bazaar or stash at your base.</li><li>Petrol matters — out of fuel you crawl on fumes.</li><li>Big rigs are tough and carry a lot, but sink in dunes and drink petrol.</li><li>Factions remember. Betrayals echo for days.</li></ul></div></div></div>`;

export { MARKET_ACTIONS, marketHTML, dayOf, DAY_LEN, PART_TABLES, designStats, unitPrice, TILE, BUILD_ORDER, HUB_SPOTS };

// clipboard access can be blocked (sandboxed frames): fall back to selecting the text for a manual copy
function copyText(text, ui) {
  const done = () => ui.toast('Copied!', 'good');
  const manual = () => { const el = document.querySelector('.invite input'); if (el) { el.focus(); el.select(); } ui.toast('Press Ctrl+C to copy', 'info'); };
  try { navigator.clipboard.writeText(text).then(done, manual); } catch { manual(); }
}
