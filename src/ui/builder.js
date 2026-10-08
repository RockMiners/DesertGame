// Top-down base planner: place buildings on a tile grid shaped by the terrain.
import { STRUCTS, BUILD_ORDER, TILE } from '../sim/defs.js';
import { RES_INFO } from '../world/biomes.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const costTxt = (cost) => Object.entries(cost).map(([k, v]) => `${v}${RES_INFO[k]?.icon || k}`).join(' ');
const COLORS = { hq: '#e76f51', shack: '#c08552', bunkhouse: '#a9b4bd', mine: '#ffd166', pump: '#f4a261', well: '#56c2f0', farm: '#8ac926', extractor: '#9be15d', solar: '#1d3557', generator: '#ff8c42', ammo: '#6b7a3a', garage: '#8d99ae', turret: '#d62828', cannonT: '#9d0208', laserT: '#b04dff', wall: '#7f5539', depot: '#2a9d8f', radio: '#e0e0e0', market: '#ff8fab', autorig: '#fcbf49' };

export const BUILDER = {
  render(args, st) {
    const sim = this.sim, s = sim.s, b = s.bases[args.baseId];
    if (!b) return '';
    st.sel = st.sel || 'shack';
    const g = s.group;
    const residents = Object.values(s.npcs).filter((n) => n.alive && n.baseId === b.id).length;
    const beds = sim.baseBeds(b);
    const pal = BUILD_ORDER.filter((t) => t !== 'hq').map((t) => {
      const d = STRUCTS[t];
      const locked = d.tier && d.tier > g.unlocked.tier && !g.unlocked.extra.includes(t);
      return `<button class="pal ${st.sel === t ? 'on' : ''}" data-action="pick" data-t="${t}" ${locked ? 'disabled' : ''} title="${esc(d.desc)}"><span class="ico">${d.icon}</span><span><b>${d.name}</b> <small>${d.w}×${d.d}</small><br/><small>${t === 'bulldozed' ? 'scrap × earth moved' : costTxt(d.cost)}${d.beds ? ` · 🛏️${d.beds}` : ''}${d.workers ? ` · 👷${d.workers}` : ''}${d.power ? ` · ⚡${d.power > 0 ? '+' : ''}${d.power}` : ''}${locked ? ' · 🔒' : ''}</small></span></button>`;
    }).join('');
    const prod = Object.entries(b.lastProd || {}).map(([k, v]) => `${RES_INFO[k].icon}${v.toFixed(1)}/h`).join(' ') || '—';
    const stor = Object.entries(b.storage).filter(([, v]) => v >= 1).map(([k, v]) => `${RES_INFO[k].icon}${Math.floor(v)}`).join(' ') || 'empty';
    const sel = STRUCTS[st.sel];
    return `<div class="builder"><div class="b-pal scroll">${pal}<button class="pal ${st.sel === 'demolish' ? 'on' : ''}" data-action="pick" data-t="demolish"><span class="ico">💣</span><span><b>Demolish</b><br/><small>refunds half</small></span></button></div>
      <div class="b-grid"><canvas id="bgrid" width="520" height="520"></canvas><div class="b-hint" id="b-hint">${st.sel === 'demolish' ? 'Click a building to demolish it.' : `${sel?.icon || ''} ${esc(sel?.name || '')}: ${esc(sel?.desc || '')}`}</div></div>
      <div class="b-info"><div class="card"><b>${esc(b.name)}</b><div>Size ${b.size}×${b.size} (level ${b.level})</div><div>🛏️ ${residents}/${beds} beds ${residents > beds ? '<b class="warn">overcrowded!</b>' : ''}</div><div>⚡ power ${b.power ? `${b.power.gen} / ${b.power.use}` : 'n/a'}</div><div>📦 ${stor}</div><div>⛏️ ${prod}</div><div class="small muted">Hatched tiles are too rough or wet — bulldoze them first. Production buildings need workers (crew living here) or an adjacent Auto-Rig with power.</div></div>
        <button data-action="upgrade" ${b.level >= 3 ? 'disabled' : ''}>⬆ Expand base (${costTxt({ scrap: 120 * b.level, electronics: 10 * b.level })})</button>
        <div class="row"><input id="bp-name" placeholder="Blueprint name" value="${esc(b.name)} layout"/><button data-action="saveBp">💾 Save layout</button></div>
        ${g.baseBlueprints.length ? `<div class="row"><select id="bp-sel">${g.baseBlueprints.map((bp, i) => `<option value="${i}">${esc(bp.name)} (${bp.items.length})</option>`).join('')}</select><button data-action="applyBp">👷 Crew builds it</button></div>` : ''}
        <div class="row"><input id="b-rename" value="${esc(b.name)}"/><button data-action="rename">Rename</button></div>
        <button class="ghost danger" data-action="abandon">Abandon base</button></div></div>`;
  },

  after(body, args, st) {
    const c = body.querySelector('#bgrid');
    if (!c) return;
    const ui = this;
    const draw = (hover) => {
      const sim = ui.sim, b = sim.s.bases[args.baseId];
      if (!b) return;
      const ctx = c.getContext('2d');
      const N = b.size, S = c.width / N;
      ctx.fillStyle = '#e9d5a1'; ctx.fillRect(0, 0, c.width, c.height);
      const blocked = new Set(b.blocked);
      for (let tz = 0; tz < N; tz++) for (let tx = 0; tx < N; tx++) {
        const p = sim.tileWorld(b, tx, tz);
        const h = ui.game.terrain.heightAt(p.x, p.z) - b.y;
        ctx.fillStyle = blocked.has(tz * N + tx) ? '#8d7b68' : `rgb(${233 - h * 6},${213 - h * 6},${161 - h * 4})`;
        ctx.fillRect(tx * S, tz * S, S, S);
        if (blocked.has(tz * N + tx)) { ctx.strokeStyle = '#5c4d3c'; ctx.lineWidth = 2; ctx.beginPath(); for (let k = -S; k < S; k += 8) { ctx.moveTo(tx * S + k, tz * S); ctx.lineTo(tx * S + k + S, tz * S + S); } ctx.stroke(); }
        ctx.strokeStyle = 'rgba(43,29,20,0.15)'; ctx.lineWidth = 1; ctx.strokeRect(tx * S, tz * S, S, S);
      }
      for (const s2 of b.structs) {
        const d = STRUCTS[s2.type];
        ctx.fillStyle = COLORS[s2.type] || '#999';
        ctx.fillRect(s2.tx * S + 2, s2.tz * S + 2, d.w * S - 4, d.d * S - 4);
        ctx.strokeStyle = '#2b1d14'; ctx.lineWidth = 3; ctx.strokeRect(s2.tx * S + 2, s2.tz * S + 2, d.w * S - 4, d.d * S - 4);
        ctx.font = `${Math.min(S * 0.7, 30)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d.icon, (s2.tx + d.w / 2) * S, (s2.tz + d.d / 2) * S);
        if (s2.hp < d.hp) { ctx.fillStyle = '#ff4d4d'; ctx.fillRect(s2.tx * S + 4, (s2.tz + d.d) * S - 8, (d.w * S - 8) * (s2.hp / d.hp), 4); }
      }
      if (hover) {
        const t = st.sel;
        if (t === 'demolish') { const hit = b.structs.find((x) => hover.tx >= x.tx && hover.tx < x.tx + STRUCTS[x.type].w && hover.tz >= x.tz && hover.tz < x.tz + STRUCTS[x.type].d); if (hit) { ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 4; ctx.strokeRect(hit.tx * S, hit.tz * S, STRUCTS[hit.type].w * S, STRUCTS[hit.type].d * S); } }
        else {
          const d = STRUCTS[t];
          const valid = t === 'bulldozed' ? blocked.has(hover.tz * N + hover.tx) : sim.canPlace(b, t, hover.tx, hover.tz);
          ctx.fillStyle = valid ? 'rgba(6,214,160,0.45)' : 'rgba(255,59,59,0.45)';
          ctx.fillRect(hover.tx * S, hover.tz * S, d.w * S, d.d * S);
        }
      }
      // compass: north up
      ctx.fillStyle = '#2b1d14'; ctx.font = '14px Lilita One, sans-serif'; ctx.fillText('N ↑', 22, 14);
    };
    const tileAt = (e) => { const r = c.getBoundingClientRect(); const b = ui.sim.s.bases[args.baseId]; const S = r.width / b.size; return { tx: Math.floor((e.clientX - r.left) / S), tz: Math.floor((e.clientY - r.top) / S) }; };
    c.onmousemove = (e) => draw(tileAt(e));
    c.onmouseleave = () => draw(null);
    c.onclick = async (e) => {
      const { tx, tz } = tileAt(e);
      const b = ui.sim.s.bases[args.baseId];
      let r;
      if (st.sel === 'demolish') {
        const hit = b.structs.find((x) => tx >= x.tx && tx < x.tx + STRUCTS[x.type].w && tz >= x.tz && tz < x.tz + STRUCTS[x.type].d);
        if (!hit) return;
        r = await ui.app.cmd('demolish', { baseId: b.id, structId: hit.id });
      } else if (st.sel === 'bulldozed') r = await ui.app.cmd('bulldoze', { baseId: b.id, tx, tz });
      else r = await ui.app.cmd('build', { baseId: b.id, type: st.sel, tx, tz });
      ui.toast(esc(r.msg), r.ok ? 'good' : 'warn');
      if (r.ok) ui.app.audio?.play(st.sel === 'demolish' ? 'smash' : 'build');
      ui.refresh();
    };
    draw(null);
  },

  actions: {
    pick(d) { this.modal.state.sel = d.t; this.refresh(); },
    async upgrade() { const r = await this.app.cmd('upgradeBase', { baseId: this.modal.args.baseId }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
    async saveBp() { const r = await this.app.cmd('saveBlueprint', { baseId: this.modal.args.baseId, name: document.getElementById('bp-name').value }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
    async applyBp() { const r = await this.app.cmd('applyBlueprint', { baseId: this.modal.args.baseId, index: +document.getElementById('bp-sel').value }); this.toast(esc(r.msg), r.ok ? 'good' : 'warn'); this.refresh(); },
    async rename() { await this.app.cmd('renameBase', { baseId: this.modal.args.baseId, name: document.getElementById('b-rename').value }); this.refresh(); },
    async abandon() { if (!(await this.ask('Abandon this base? Everything here is lost.', 'Abandon'))) return; const r = await this.app.cmd('abandonBase', { baseId: this.modal.args.baseId }); this.toast(esc(r.msg), 'warn'); this.close(); },
  },
  changes: {},
  inputs: {},
};
export { TILE };
