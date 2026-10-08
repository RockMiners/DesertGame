// Car designer: pick parts, see the tradeoffs, preview in 3D, save designs, build & equip.
import * as THREE from 'three';
import { CHASSIS, ENGINES, WHEELS, ARMOR, WEAPONS, UTILS, designStats } from '../vehicle/parts.js';
import { RES_INFO } from '../world/biomes.js';
import { carGeometry, weaponGeometry, wheelGeometry, vcMat } from '../render/models.js';
import { outlineGeometry, outlineMat } from '../render/toon.js';
import { unitPrice } from '../sim/economy.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const costTxt = (cost) => Object.entries(cost).filter(([, v]) => v > 0).map(([k, v]) => `${v}${RES_INFO[k]?.icon || k}`).join(' ') || 'free';

function unlocked(ui, table, id) {
  const g = ui.sim.s.group;
  const p = table[id];
  return !p || (p.tier || 1) <= g.unlocked.tier || g.unlocked.extra.includes(id);
}

function statBars(st, ref) {
  const rows = [
    ['Top speed', st.topSpeed * 3.6, 230, `${Math.round(st.topSpeed * 3.6)} km/h`],
    ['Acceleration', st.powerToWeight, 260, `${Math.round(st.powerToWeight)} W/kg`],
    ['Handling', 1 / (Math.sqrt(st.size) * Math.sqrt(st.mass / 900)), 1.1, st.size > 2 ? 'sluggish' : st.size > 1.4 ? 'heavy' : 'nimble'],
    ['Armour', st.hp, 4500, `${st.hp} HP`],
    ['Firepower', st.dps, 400, `${Math.round(st.dps)} DPS`],
    ['Cargo', st.cargo, 1600, `${st.cargo}`],
    ['Off-road', 1 / (0.4 + st.groundPressure * (st.wheel.soft || 0.1)), 2.5, st.wheel.soft < 0.4 ? 'excellent' : st.groundPressure > 1.2 ? 'bogs down in sand' : 'fair'],
    ['Thirst', st.fuelPerSec * 1000, 160, st.usesFuel ? `${(st.fuelPerSec * 60).toFixed(1)} L/min` : 'electric'],
  ];
  return rows.map(([n, v, max, txt]) => {
    const r = ref ? rows.find((x) => x[0] === n) : null;
    return `<div class="stat"><span>${n}</span><div class="mbar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><b>${txt}</b></div>`;
  }).join('');
}

function tradeoffs(st) {
  const t = [];
  if (st.size >= 3) t.push('Massive: huge HP, cargo and guns — but slow, thirsty, struggles on steep canyon ramps and sinks in dunes. Has bunks: sleep aboard to respawn on it.');
  else if (st.size >= 2) t.push('Big: strong and roomy, but heavy on fuel and turns like a boat.');
  if (st.groundPressure > 1.4 && st.wheel.soft > 0.5) t.push('High ground pressure: will dig into soft sand. Try knobblies or tracks.');
  if (st.wheel.soft > 1.2) t.push('Slicks fly on salt flats and ruins but are miserable in sand and mud.');
  if (st.wheel.speed < 0.8) t.push('Tracks: unstoppable on any terrain, but slow.');
  if (st.chassis === CHASSIS.buggy) t.push('Buggy: catches huge air on dunes, folds in a crash.');
  if (st.usesEnergy && !st.flags.solar) t.push('Electric engine with no solar panels: you will need to recharge often.');
  if (st.weapons.some((w) => w.energy) && st.energyCap < 150) t.push('Energy weapons with a small battery: add a Battery Bank.');
  if (st.weapons.some((w) => w.fuel)) t.push('Flamer burns your petrol.');
  if (!st.weapons.length) t.push('No weapons fitted. Peaceful, but defenceless.');
  return t.map((x) => `<li>${x}</li>`).join('');
}

// net cost of swapping current car for a new design (60% trade-in on the old one)
export function swapCost(oldD, newD) {
  const a = designStats(newD).cost, b = designStats(oldD).cost;
  const out = {};
  for (const [k, v] of Object.entries(a)) { const n = Math.max(0, Math.ceil(v - (b[k] || 0) * 0.6)); if (n > 0) out[k] = n; }
  return out;
}

export const GARAGE = {
  render(args, st) {
    const ui = this;
    const car = ui.game.player.car;
    if (!st.design) st.design = JSON.parse(JSON.stringify(car.design));
    const d = st.design;
    const stats = designStats(d);
    const ch = CHASSIS[d.chassis];
    const opt = (table, cat, cur) => Object.entries(table).map(([id, p]) => {
      const ok = unlocked(ui, table, id);
      return `<button class="part ${id === cur ? 'on' : ''} ${ok ? '' : 'locked'}" data-action="part" data-cat="${cat}" data-id="${id}" ${ok ? '' : 'disabled'} title="${esc(p.desc || '')}">${esc(p.name)}${ok ? '' : ` 🔒T${p.tier}`}</button>`;
    }).join('');
    const weaponSel = ch.mounts.map((m, i) => {
      const opts = Object.entries(WEAPONS).filter(([, w]) => w.kinds.includes(m.kind));
      return `<label>${m.kind === 'turret' ? '🎯 Turret' : m.kind === 'fixed' ? '➡️ Forward' : '⬅️ Rear'} ${i + 1}<select data-change="weapon" data-i="${i}"><option value="">— empty —</option>${opts.map(([id, w]) => `<option value="${id}" ${d.weapons[i] === id ? 'selected' : ''} ${unlocked(ui, WEAPONS, id) ? '' : 'disabled'}>${w.name}${unlocked(ui, WEAPONS, id) ? '' : ' 🔒'}</option>`).join('')}</select></label>`;
    }).join('');
    const utilSel = Array.from({ length: ch.utils }, (_, i) => `<select data-change="util" data-i="${i}"><option value="">— empty slot —</option>${Object.entries(UTILS).map(([id, u]) => `<option value="${id}" ${d.utils[i] === id ? 'selected' : ''} ${unlocked(ui, UTILS, id) ? '' : 'disabled'}>${u.name}${unlocked(ui, UTILS, id) ? '' : ' 🔒'}</option>`).join('')}</select>`).join('');
    const net = swapCost(car.design, d);
    const at = args.at;
    const own = at && at !== 'hub' && ui.sim.s.bases[at]?.factionId === ui.sim.s.group.factionId;
    const capsEst = Object.entries(net).reduce((t, [k, v]) => t + Math.ceil(v * unitPrice(ui.sim.s.market, k) * 1.25), 0);
    const designs = ui.sim.s.group.designs;
    return `<div class="garage"><div class="g-left scroll">
      <h4>Chassis</h4><div class="parts">${opt(CHASSIS, 'chassis', d.chassis)}</div>
      <h4>Engine</h4><div class="parts">${opt(ENGINES, 'engine', d.engine)}</div>
      <h4>Wheels</h4><div class="parts">${opt(WHEELS, 'wheels', d.wheels)}</div>
      <h4>Armour</h4><div class="parts">${opt(ARMOR, 'armor', d.armor)}</div>
      <h4>Weapons</h4><div class="slots">${weaponSel}</div>
      <h4>Utilities (${ch.utils} slots)</h4><div class="slots">${utilSel}</div>
      <h4>Paint</h4><div class="row"><input type="color" data-input="paint" value="${d.paint || '#ff7f50'}"/><input type="color" data-input="paint2" value="${d.paint2 || '#ffd166'}"/><input data-input="dname" value="${esc(d.name || 'My Car')}" maxlength="24"/></div>
    </div><div class="g-mid"><canvas id="garage-preview" width="460" height="260"></canvas>
      <div class="g-desc"><b>${esc(ch.name)}</b> — ${esc(ch.desc)}</div>
      <div class="stats">${statBars(stats)}</div><div class="small muted">Mass ${stats.mass} kg · Fuel tank ${stats.fuelCap} L · Ammo ${stats.ammoCap} · Energy ${stats.energyCap}</div>
      <ul class="tradeoffs">${tradeoffs(stats)}</ul></div>
    <div class="g-right"><div class="card"><b>Full build cost</b><div>${costTxt(stats.cost)}</div><b>After trading in your car</b><div>${costTxt(net)}</div><div class="small muted">${own ? 'Paid from base storage first, then caps.' : `≈ ${capsEst} caps at Hub prices.`}</div>
      <button data-action="equip" data-at="${at || 'hub'}">🔧 Build & equip</button><button data-action="saveDesign">💾 Save design</button><button class="ghost" data-action="resetDesign">↺ Reset</button></div>
      <h4>Saved designs</h4><div class="scroll designs">${designs.map((x, i) => `<div class="card row"><span>${esc(x.name)} <small>${esc(CHASSIS[x.chassis]?.name)}</small></span><button class="mini" data-action="loadDesign" data-i="${i}">Load</button><button class="mini ghost" data-action="delDesign" data-i="${i}">✕</button></div>`).join('')}</div>
      <p class="small muted">Saved designs can be given to your crew (faction menu): their base garage builds the car.</p></div></div>`;
  },

  after(body, args, st) {
    const canvas = body.querySelector('#garage-preview');
    if (!canvas) return;
    const ui = this;
    if (!ui._gp || ui._gp.canvas !== canvas) {
      GARAGE.dispose.call(ui);
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(2, devicePixelRatio));
      r.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd9a066, 1.4));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(5, 8, 6); scene.add(sun);
      const cam = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.1, 200);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 32).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: 0xe9c46a }));
      floor.position.y = -1.2;
      scene.add(floor);
      ui._gp = { canvas, r, scene, cam, group: null, angle: 0.6, raf: 0 };
      const loop = () => {
        const gp = ui._gp;
        if (!gp || !document.body.contains(gp.canvas)) { GARAGE.dispose.call(ui); return; }
        gp.angle += 0.008;
        if (gp.group) gp.group.rotation.y = gp.angle;
        gp.r.render(gp.scene, gp.cam);
        gp.raf = requestAnimationFrame(loop);
      };
      ui._gp.raf = requestAnimationFrame(loop);
    }
    const gp = ui._gp;
    if (gp.group) gp.scene.remove(gp.group);
    const d = st.design;
    const stats = designStats(d);
    const g = new THREE.Group();
    const body2 = new THREE.Mesh(carGeometry(d, stats), vcMat());
    g.add(body2, new THREE.Mesh(outlineGeometry(body2.geometry), outlineMat(0.04 * Math.sqrt(stats.size))));
    const sc = Math.min(2.2, 0.85 + stats.size * 0.25);
    for (const w of stats.weapons) {
      const m = stats.mounts[w.mount];
      const wm = new THREE.Mesh(weaponGeometry(w.id, sc), vcMat());
      wm.position.set(...m.pos);
      if (m.kind === 'rear') wm.rotation.y = Math.PI;
      g.add(wm);
    }
    if (d.wheels !== 'tracks' && d.wheels !== 'hover') {
      const ch = stats.chassis;
      const rest = 0.45 + ch.wheelR * 0.55;
      const wb = ch.len * 0.72;
      for (let a = 0; a < ch.axles; a++) for (const side of [-1, 1]) {
        const wm = new THREE.Mesh(wheelGeometry(), vcMat());
        wm.scale.set(ch.wheelW, ch.wheelR, ch.wheelR);
        wm.position.set(side * (ch.wid / 2 + ch.wheelW * 0.1), 0.15 - rest * 0.62, wb / 2 - (wb * a) / Math.max(1, ch.axles - 1));
        g.add(wm);
      }
    }
    gp.group = g;
    gp.scene.add(g);
    const size = Math.max(stats.chassis.len, 3.5);
    gp.cam.position.set(size * 1.3, size * 0.7, size * 1.3);
    gp.cam.lookAt(0, stats.chassis.hei * 0.4, 0);
  },

  dispose() {
    if (this._gp) { cancelAnimationFrame(this._gp.raf); this._gp.r.dispose(); this._gp = null; }
  },

  actions: {
    part(dd) {
      const st = this.modal.state;
      const d = st.design;
      const key = dd.cat;
      d[key] = dd.id;
      if (key === 'chassis') {
        const ch = CHASSIS[dd.id];
        d.weapons = ch.mounts.map((m, i) => (d.weapons[i] && WEAPONS[d.weapons[i]]?.kinds.includes(m.kind) ? d.weapons[i] : null));
        d.utils = Array.from({ length: ch.utils }, (_, i) => d.utils[i] || null);
      }
      this.refresh();
    },
    async equip(dd) {
      const st = this.modal.state;
      const car = this.game.player.car;
      const r = await this.app.cmd('buyCar', { design: st.design, old: car.design, at: dd.at });
      this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
      if (r.ok) { car.setDesign(st.design); car.hp = car.stats.hp; car.fuel = Math.max(car.fuel, car.stats.fuelCap * 0.5); this.app.audio?.play('repair'); this.app.onDesignChanged(); this.refresh(); }
    },
    async saveDesign() {
      const st = this.modal.state;
      const designs = this.sim.s.group.designs;
      const idx = designs.findIndex((x) => x.name === st.design.name);
      const r = await this.app.cmd('saveDesign', { design: st.design, index: idx >= 0 ? idx : undefined });
      this.toast(esc(r.msg), r.ok ? 'good' : 'warn');
      this.refresh();
    },
    resetDesign() { this.modal.state.design = JSON.parse(JSON.stringify(this.game.player.car.design)); this.refresh(); },
    loadDesign(dd) { this.modal.state.design = JSON.parse(JSON.stringify(this.sim.s.group.designs[+dd.i])); this.refresh(); },
    async delDesign(dd) { const r = await this.app.cmd('deleteDesign', { index: +dd.i }); this.toast(esc(r.msg), r.ok ? 'info' : 'warn'); this.refresh(); },
  },
  changes: {
    weapon(v, el) { this.modal.state.design.weapons[+el.dataset.i] = v || null; this.refresh(); },
    util(v, el) { this.modal.state.design.utils[+el.dataset.i] = v || null; this.refresh(); },
  },
  inputs: {
    paint(v) { this.modal.state.design.paint = v; GARAGE.after.call(this, this.$('modal-body'), this.modal.args, this.modal.state); },
    paint2(v) { this.modal.state.design.paint2 = v; GARAGE.after.call(this, this.$('modal-body'), this.modal.args, this.modal.state); },
    dname(v) { this.modal.state.design.name = v; },
  },
};
