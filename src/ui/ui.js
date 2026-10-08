// HUD, world labels, minimap, toasts, banners, dialogs and the modal menu system.
import * as THREE from 'three';
import { RES_INFO, RESOURCES, BIOMES } from '../world/biomes.js';
import { clockString, dayOf, STRUCTS, TILE, RANKS } from '../sim/defs.js';
import { HALF } from '../world/terrain.js';
import { portrait } from './portrait.js';
import { MENUS } from './menus.js';
import { formatNum, clamp } from '../core/math.js';

const _v = new THREE.Vector3();
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.root.innerHTML = `
      <div id="vignette"></div>
      <div id="labels"></div>
      <div id="hud" class="hidden">
        <div id="hud-tl" class="panel-lite">
          <div class="hud-clock"><span id="hud-day"></span> <span id="hud-time"></span></div>
          <div id="hud-zone"></div>
          <div id="hud-group"></div>
          <div class="hud-caps">🪙 <b id="hud-caps">0</b> caps</div>
        </div>
        <canvas id="minimap" width="210" height="210"></canvas>
        <div id="hud-mission"></div>
        <div id="hud-car" class="panel-lite">
          <div class="bar hp"><i></i><span>HULL</span></div>
          <div class="bar shield hidden"><i></i><span>SHIELD</span></div>
          <div class="bar fuel"><i></i><span>PETROL</span></div>
          <div class="bar energy"><i></i><span>ENERGY</span></div>
          <div class="bar nitro hidden"><i></i><span>NITRO</span></div>
          <div class="hud-row"><span id="hud-ammo"></span><span id="hud-cargo"></span></div>
        </div>
        <div id="speedo"><svg viewBox="0 0 120 70"><path d="M10 64 A50 50 0 0 1 110 64" class="speedo-bg"/><path id="speedo-arc" d="M10 64 A50 50 0 0 1 110 64" class="speedo-fg"/></svg><div id="speedo-num">0</div><div class="speedo-unit">km/h</div></div>
        <div id="crosshair"><i></i><b id="hitmark"></b></div>
        <div id="prompt"></div>
        <div id="hud-keys">M map · J journal · Tab faction · G garage · B base · E interact · Esc menu</div>
      </div>
      <div id="banner"></div>
      <div id="stunt"></div>
      <div id="toasts"></div>
      <div id="ticker"></div>
      <div id="modal" class="hidden"><div class="modal-card"><div class="modal-head"><h2 id="modal-title"></h2><div id="modal-tabs"></div><button class="x" data-close>✕</button></div><div id="modal-body"></div></div></div>
      <div id="dialog" class="hidden"></div>
      <div id="screen" class="hidden"></div>`;
    this.$ = (id) => document.getElementById(id);
    this.labelPool = [];
    this.toastKeys = new Map();
    this.modal = null;
    this.mini = this.$('minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.mapBg = null;
    this.stuntT = 0;
    this.bannerT = 0;
    this.tickerQueue = [];
    this.dialogQueue = [];
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('change', (e) => this.onChange(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
  }

  get game() { return this.app.game; }
  get sim() { return this.app.sim; }

  show(on) { this.$('hud').classList.toggle('hidden', !on); }

  // ---------- events from DOM ----------
  onClick(e) {
    const el = e.target.closest('[data-action],[data-close],[data-tab]');
    if (!el) return;
    this.app.audio?.play('click');
    if (el.hasAttribute('data-close')) { this.close(); return; }
    if (el.dataset.tab !== undefined && this.modal) { this.modal.tab = el.dataset.tab; this.renderModal(); return; }
    const action = el.dataset.action;
    const handler = this.modal?.def.actions?.[action] || GLOBAL_ACTIONS[action];
    if (handler) handler.call(this, el.dataset, el, e);
  }
  onChange(e) {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const handler = this.modal?.def.changes?.[el.dataset.change];
    if (handler) handler.call(this, el.value, el);
  }
  onInput(e) {
    const el = e.target.closest('[data-input]');
    if (!el) return;
    const handler = this.modal?.def.inputs?.[el.dataset.input];
    if (handler) handler.call(this, el.value, el);
  }

  // ---------- modal menus ----------
  open(name, args = {}) {
    const def = MENUS[name];
    if (!def) return;
    if (def.available && !def.available.call(this, args)) return;
    this.modal = { name, def, args, tab: args.tab || (def.tabs ? def.tabs.call(this, args)[0]?.[0] : null), state: {} };
    this.$('modal').classList.remove('hidden');
    this.$('modal').className = `wide-${def.wide ? 1 : 0}`;
    this.app.setMenuOpen(true);
    def.onOpen?.call(this, args);
    this.renderModal();
  }
  close() {
    if (!this.modal) return;
    this.modal.def.onClose?.call(this);
    this.modal = null;
    this.$('modal').classList.add('hidden');
    this.app.setMenuOpen(false);
  }
  toggle(name, args) { if (this.modal?.name === name) this.close(); else { if (this.modal) this.close(); this.open(name, args); } }
  renderModal() {
    const m = this.modal;
    if (!m) return;
    const def = m.def;
    this.$('modal-title').innerHTML = def.title.call(this, m.args);
    const tabs = def.tabs ? def.tabs.call(this, m.args) : [];
    this.$('modal-tabs').innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}" class="${id === m.tab ? 'on' : ''}">${label}</button>`).join('');
    const body = this.$('modal-body');
    const scroll = body.querySelector('.scroll')?.scrollTop;
    body.innerHTML = def.render.call(this, m.args, m.tab, m.state);
    if (scroll) { const sc = body.querySelector('.scroll'); if (sc) sc.scrollTop = scroll; }
    def.after?.call(this, body, m.args, m.tab, m.state);
  }
  refresh() { if (this.modal) this.renderModal(); }

  // ---------- notifications ----------
  toast(msg, type = 'info', key = null) {
    if (key) { const t = this.toastKeys.get(key); if (t && performance.now() - t < 4000) return; this.toastKeys.set(key, performance.now()); }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = msg;
    this.$('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
    while (this.$('toasts').children.length > 6) this.$('toasts').firstChild.remove();
  }
  banner(title, sub = '', color = '#ffd166') {
    const b = this.$('banner');
    b.innerHTML = `<h1 style="color:${color}">${title}</h1>${sub ? `<p>${sub}</p>` : ''}`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    this.bannerT = 4;
  }
  stunt(text, sub = '') {
    const s = this.$('stunt');
    s.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
    s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop');
  }
  news(entry) {
    const t = this.$('ticker');
    const el = document.createElement('div');
    el.className = `news imp${entry.importance}`;
    el.innerHTML = `📜 <b>${esc(entry.title)}</b> <span>${esc(entry.text.slice(0, 140))}${entry.text.length > 140 ? '…' : ''}</span>`;
    t.appendChild(el);
    setTimeout(() => el.classList.add('out'), 9000);
    setTimeout(() => el.remove(), 9800);
    while (t.children.length > 3) t.firstChild.remove();
  }
  hitMarker() { const h = this.$('hitmark'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); }
  damageFlash(a) { const v = this.$('vignette'); v.style.opacity = Math.min(0.85, 0.35 + a); clearTimeout(this._vt); this._vt = setTimeout(() => (v.style.opacity = 0), 160); }

  // choice dialog for storyteller offers
  offerDialog(off) {
    this.dialogQueue.push(off);
    if (this.dialogQueue.length === 1) this.showNextDialog();
  }
  showNextDialog() {
    const off = this.dialogQueue[0];
    const d = this.$('dialog');
    if (!off) { d.classList.add('hidden'); return; }
    const sim = this.sim;
    const f = sim.s.factions[off.from];
    const leader = f ? sim.s.npcs[f.leaderId] : null;
    const pic = portrait(leader?.portrait || (off.from === 'hub' ? 777 : 42), f?.color || '#ffd166', 120, { glow: off.from === 'glowkin' });
    d.innerHTML = `<div class="dlg-card"><img src="${pic}" class="pic"/><div class="dlg-body"><div class="dlg-from">${f ? esc(f.name) : 'The Hub'}</div><h3>${esc(off.title)}</h3><p>${esc(off.text)}</p>
      <div class="dlg-choices">${off.choices.map((c, i) => `<button data-action="offerChoice" data-id="${off.id}" data-i="${i}">${esc(c.label)}${c.cost ? ` <small>(${c.cost} caps)</small>` : ''}</button>`).join('')}</div>
      <button class="later" data-action="offerLater" data-id="${off.id}">Decide later (Journal)</button></div></div>`;
    d.classList.remove('hidden');
    this.app.setMenuOpen(true, 'dialog');
    this.app.audio?.play('offer');
  }

  // ---------- per-frame ----------
  update(dt) {
    const app = this.app, g = this.game, sim = this.sim;
    if (!g || !sim?.s) return;
    const car = g.player?.car;
    if (!car) return;
    const s = sim.s;
    // top-left
    this.$('hud-day').textContent = `Day ${dayOf(s.time)}`;
    this.$('hud-time').textContent = clockString(s.time);
    this.$('hud-caps').textContent = formatNum(s.group.wallet);
    const zone = g.terrain.zoneAt(car.body.pos.x, car.body.pos.z);
    const zs = s.zones[zone.id];
    const owner = zs?.owner ? s.factions[zs.owner] : null;
    const zoneKey = zone.id + '|' + (owner?.id || '');
    if (zoneKey !== this._zoneKey) {
      if (this._zoneKey) this.banner(zone.name, zone.biome === 'hub' ? 'Safe zone — the Hub Accord forbids violence' : owner ? `${owner.name} territory` : `${BIOMES[zone.biome].name} · unclaimed`, owner?.color || '#ffd166');
      this._zoneKey = zoneKey;
    }
    this.$('hud-zone').innerHTML = `<span class="chip" style="background:${owner?.color || '#555'}">${zone.biome === 'hub' ? '🕊️' : owner ? '⚑' : '○'}</span> ${esc(zone.name)}`;
    const gf = s.factions[s.group.factionId];
    this.$('hud-group').innerHTML = gf ? `<span class="chip" style="background:${gf.color}"></span>${esc(gf.short)} · ${gf.isPlayer ? 'Leader' : RANKS[s.group.rank]}` : '<span class="muted">No faction (drifter)</span>';
    // car bars
    const st = car.stats;
    const setBar = (cls, frac, txt) => { const el = this.root.querySelector(`#hud-car .bar.${cls}`); el.firstElementChild.style.width = `${clamp(frac, 0, 1) * 100}%`; if (txt) el.lastElementChild.textContent = txt; };
    setBar('hp', car.hp / st.hp, `HULL ${Math.ceil(car.hp)}/${st.hp}`);
    const sh = this.root.querySelector('#hud-car .bar.shield'); sh.classList.toggle('hidden', !st.flags.shield);
    if (st.flags.shield) setBar('shield', car.shield / (160 * st.flags.shield), 'SHIELD');
    setBar('fuel', st.usesFuel ? car.fuel / st.fuelCap : 1, st.usesFuel ? `PETROL ${Math.ceil(car.fuel)}L${car.fuel <= 0 ? ' — EMPTY!' : ''}` : 'NO PETROL NEEDED');
    setBar('energy', car.energy / st.energyCap, `ENERGY ${Math.round(car.energy)}`);
    const ni = this.root.querySelector('#hud-car .bar.nitro'); ni.classList.toggle('hidden', !st.flags.nitro);
    if (st.flags.nitro) setBar('nitro', car.nitro, 'NITRO (Shift)');
    this.$('hud-ammo').innerHTML = st.weapons.some((w) => w.ammo) ? `🔸 ${Math.floor(car.ammo)}/${st.ammoCap}` : '';
    this.$('hud-cargo').innerHTML = `📦 ${Math.round(car.cargoUsed())}/${st.cargo}`;
    this.root.querySelector('#hud-car .bar.fuel').classList.toggle('warn', st.usesFuel && car.fuel / st.fuelCap < 0.15);
    // speedo
    const kmh = car.speedKmh();
    this.$('speedo-num').textContent = Math.round(kmh);
    const frac = clamp(kmh / 220, 0, 1);
    const arc = this.$('speedo-arc');
    arc.style.strokeDasharray = `${frac * 157} 200`;
    arc.classList.toggle('boost', !!car.boostVisual);
    // crosshair visible only when armed and not in safe zone
    const safe = g.inSafeZone(car.body.pos.x, car.body.pos.z);
    this.$('crosshair').classList.toggle('locked', !!car.lockTarget);
    this.$('crosshair').classList.toggle('safe', safe);
    // banner fade
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.$('banner').classList.remove('show'); }
    this.updateMission();
    this.updateMinimap(car);
    this.updateLabels(car);
    this.updatePrompt(car);
  }

  updateMission() {
    const sim = this.sim;
    const tracked = sim.s.missions[this.app.trackedMission] || Object.values(sim.s.missions).find((m) => m.status === 'active');
    if (tracked && tracked.status === 'active') this.app.trackedMission = tracked.id;
    const el = this.$('hud-mission');
    if (!tracked || tracked.status !== 'active') { el.innerHTML = ''; return; }
    const o = tracked.obj;
    let obj = '';
    if (o.kind === 'race') obj = `Checkpoint ${o.idx + 1}/${o.checkpoints.length}`;
    else if (o.kind === 'deliver') obj = `Deliver ${o.amount} ${RES_INFO[o.res].icon} (${Math.floor(this.game.player.car.cargo[o.res] || 0)} in cargo)`;
    else if (o.kind === 'destroyStructs') obj = `Destroyed ${o.progress || 0}/${o.count}`;
    else if (o.kind === 'stunt' || o.kind === 'kills') obj = `${o.progress || 0}/${o.count}`;
    else if (o.kind === 'destroyBase') obj = 'Destroy the HQ';
    else if (o.kind === 'killSquad') obj = 'Wreck the convoy';
    else if (o.kind === 'killNpc') obj = 'Take them out';
    else if (o.kind === 'escortSquad') obj = 'Keep them alive';
    else if (o.kind === 'reach') obj = 'Get there';
    const left = tracked.deadline ? Math.max(0, Math.ceil(tracked.deadline - sim.s.time)) : null;
    const car = this.game.player.car;
    const d = o.x !== undefined ? Math.round(Math.hypot(o.x - car.body.pos.x, o.z - car.body.pos.z)) : null;
    el.innerHTML = `<div class="mtitle">🎯 ${esc(tracked.title)}</div><div class="mobj">${obj}${d !== null ? ` · ${d}m` : ''}${left !== null ? ` · <b class="${left < 15 ? 'warn' : ''}">${left}s</b>` : ''}</div>`;
  }

  // ---------- minimap ----------
  buildMapBg() {
    const T = this.game.terrain;
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const x = c.getContext('2d');
    const img = x.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = -HALF + (i + 0.5) * (HALF * 2 / N), wz = -HALF + (j + 0.5) * (HALF * 2 / N);
      const vi = Math.round((wz + HALF) / 4) * 769 + Math.round((wx + HALF) / 4);
      const k = (j * N + i) * 4;
      let r = Math.pow(T.colors[vi * 3], 1 / 2.2), g = Math.pow(T.colors[vi * 3 + 1], 1 / 2.2), b = Math.pow(T.colors[vi * 3 + 2], 1 / 2.2);
      const L = T.liquidAt(wx, wz);
      if (L) { const lc = new THREE.Color(L.color); r = lc.r; g = lc.g; b = lc.b; }
      const h = T.heights[vi];
      const shade = 0.85 + Math.min(0.3, h / 120);
      img.data[k] = r * 255 * shade; img.data[k + 1] = g * 255 * shade; img.data[k + 2] = b * 255 * shade; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this.mapBg = c;
  }

  worldToMap(x, z, size) { return [((x + HALF) / (HALF * 2)) * size, ((z + HALF) / (HALF * 2)) * size]; }

  updateMinimap(car) {
    if (!this.mapBg) this.buildMapBg();
    const ctx = this.miniCtx, W = this.mini.width;
    const g = this.game, sim = this.sim;
    const R = car.stats.flags.radar ? 650 : 420; // metres shown radius
    const scale = W / (R * 2);
    const px = car.body.pos.x, pz = car.body.pos.z;
    const heading = g.chase ? Math.atan2(g.camera.getWorldDirection(_v).x, _v.z) : car.body.heading();
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(Math.PI + heading);
    // background crop
    const mapScale = 256 / (HALF * 2);
    ctx.drawImage(this.mapBg, (px + HALF) * mapScale - R * mapScale, (pz + HALF) * mapScale - R * mapScale, R * 2 * mapScale, R * 2 * mapScale, -R * scale, -R * scale, R * 2 * scale, R * 2 * scale);
    const toMini = (x, z) => [(x - px) * scale, (z - pz) * scale];
    // zone borders: owner tint dots at bases
    for (const b of Object.values(sim.s.bases)) {
      const [x, z] = toMini(b.x, b.z);
      if (Math.abs(x) > W || Math.abs(z) > W) continue;
      const f = sim.s.factions[b.factionId];
      const hs = Math.max(4, (b.size * TILE * scale) / 2);
      ctx.fillStyle = f?.color || '#888'; ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 2;
      ctx.fillRect(x - hs, z - hs, hs * 2, hs * 2); ctx.strokeRect(x - hs, z - hs, hs * 2, hs * 2);
    }
    // pickups
    for (const n of g.pickups.nodes) {
      if (!n.active) continue;
      const [x, z] = toMini(n.x, n.z);
      if (x * x + z * z > (W / 2) * (W / 2)) continue;
      ctx.fillStyle = RES_INFO[n.res]?.color || '#fff';
      ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
    }
    // cars
    for (const c of g.cars) {
      if (c === car || !c.alive || c.traffic) continue;
      const [x, z] = toMini(c.body.pos.x, c.body.pos.z);
      if (x * x + z * z > (W / 2) * (W / 2)) continue;
      const hostile = g.hostile(car, c);
      ctx.fillStyle = c.isRemotePlayer ? '#00e5ff' : hostile ? '#ff3b3b' : c.factionColor || '#9aa3ad';
      ctx.beginPath(); ctx.arc(x, z, c.vip ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
    }
    // mission marker
    const m = sim.s.missions[this.app.trackedMission];
    if (m && m.status === 'active' && m.obj.x !== undefined) {
      let [x, z] = toMini(m.obj.x, m.obj.z);
      const d = Math.hypot(x, z), lim = W / 2 - 10;
      if (d > lim) { x *= lim / d; z *= lim / d; }
      ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, z - 7); ctx.lineTo(x + 6, z); ctx.lineTo(x, z + 7); ctx.lineTo(x - 6, z); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // hub
    { const [x, z] = toMini(0, 0); ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(x, z, 205 * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
    // player arrow (always up = camera forward)
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-(car.body.heading() - heading));
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // ring + N
    ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); ctx.stroke();
    const na = Math.PI + heading;
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 14px Lilita One, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', W / 2 + Math.sin(-na) * (W / 2 - 12) * -1, W / 2 - Math.cos(na) * (W / 2 - 12));
  }

  // ---------- floating labels ----------
  updateLabels(car) {
    const g = this.game, cam = g.camera, sim = this.sim;
    const W = innerWidth, H = innerHeight;
    const items = [];
    for (const c of g.cars) {
      if (c === car || !c.alive || c.traffic) continue;
      const d = c.body.pos.distanceTo(cam.position);
      if (d > 180) continue;
      const hostile = g.hostile(car, c);
      const f = sim.s.factions[c.team];
      _v.copy(c.body.pos); _v.y += c.stats.chassis.hei + 2.2;
      items.push({ pos: _v.clone(), html: `<span class="dot" style="background:${c.isRemotePlayer ? '#00e5ff' : f?.color || '#999'}"></span>${esc(c.title || c.name)}${c.hp < c.stats.hp ? `<i class="hpbar"><b style="width:${(c.hp / c.stats.hp) * 100}%"></b></i>` : ''}`, cls: `${hostile ? 'hostile' : 'friendly'} ${c.vip ? 'vip' : ''}`, d });
    }
    for (const b of Object.values(sim.s.bases)) {
      const d = Math.hypot(b.x - cam.position.x, b.z - cam.position.z);
      if (d > 600) continue;
      const f = sim.s.factions[b.factionId];
      items.push({ pos: new THREE.Vector3(b.x, b.y + 16, b.z), html: `<span class="dot" style="background:${f?.color}"></span>${esc(b.name)} <small>${esc(f?.short || '')}</small>`, cls: 'base', d });
    }
    const m = sim.s.missions[this.app.trackedMission];
    if (m && m.status === 'active' && m.obj.x !== undefined) {
      const y = g.terrain.heightAt(m.obj.x, m.obj.z) + 6;
      items.push({ pos: new THREE.Vector3(m.obj.x, y, m.obj.z), html: `◆ ${Math.round(Math.hypot(m.obj.x - car.body.pos.x, m.obj.z - car.body.pos.z))}m`, cls: 'waypoint', d: 0, edge: true });
    }
    let i = 0;
    for (const it of items) {
      _v.copy(it.pos).project(cam);
      let x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      const behind = _v.z > 1;
      if (behind || x < 0 || x > W || y < 0 || y > H) {
        if (!it.edge) continue;
        if (behind) { x = W - x; y = H - 20; }
        x = clamp(x, 40, W - 40); y = clamp(y, 60, H - 60);
      }
      let el = this.labelPool[i];
      if (!el) { el = document.createElement('div'); this.$('labels').appendChild(el); this.labelPool.push(el); }
      el.className = `lbl ${it.cls}`;
      if (el._html !== it.html) { el.innerHTML = it.html; el._html = it.html; }
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${it.edge ? 1 : clamp(1.2 - it.d / 250, 0.6, 1)})`;
      el.style.display = '';
      i++;
    }
    for (; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
    // floating combat text
    for (const t of g.fx.texts) {
      _v.set(t.x, t.y + t.age * 2.5, t.z).project(cam);
      if (_v.z > 1) continue;
      if (!t.el) { t.el = document.createElement('div'); t.el.className = 'ftext'; t.el.textContent = t.text; t.el.style.color = t.color; this.$('labels').appendChild(t.el); setTimeout(() => t.el.remove(), t.life * 1000); }
      t.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * W}px, ${(-_v.y * 0.5 + 0.5) * H}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.3 - t.age) * 2})`;
      t.el.style.opacity = 1 - t.age / t.life;
    }
  }

  updatePrompt(car) {
    const it = this.app.interaction();
    const el = this.$('prompt');
    const txt = it ? `<kbd>E</kbd> ${it.label}` : '';
    if (el._t !== txt) { el.innerHTML = txt; el._t = txt; el.classList.toggle('on', !!it); }
  }
}

const GLOBAL_ACTIONS = {
  async offerChoice(d) {
    this.dialogQueue.shift();
    this.showNextDialog();
    if (!this.dialogQueue.length) this.app.setMenuOpen(false, 'dialog');
    const r = await this.app.cmd('answerOffer', { id: d.id, choice: +d.i });
    if (r?.msg) this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    this.refresh();
  },
  offerLater() {
    this.dialogQueue.shift();
    this.showNextDialog();
    if (!this.dialogQueue.length) this.app.setMenuOpen(false, 'dialog');
  },
};

export { RESOURCES, STRUCTS, portrait };
