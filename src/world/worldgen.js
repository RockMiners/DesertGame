// Deterministic world generation: zones on rings, terrain, props, base sites, resource spawns.
import { RNG, clamp } from '../core/math.js';
import { Terrain, HALF, CELL, EDGE } from './terrain.js';
import { ZONE_DEFS } from '../sim/lore.js';
import { BIOMES } from './biomes.js';

const RING_R = [0, 640, 1180];

export function layoutZones(seed) {
  const rng = new RNG(seed * 13 + 7);
  const rot = rng.range(0, Math.PI * 2);
  return ZONE_DEFS.map((d) => {
    let x = 0, z = 0;
    if (d.ring > 0) {
      const n = d.ring === 1 ? 6 : 12;
      const off = d.ring === 1 ? 0 : 0;
      const a = rot + ((d.slot + off) / n) * Math.PI * 2 + rng.range(-0.07, 0.07);
      const r = RING_R[d.ring] + rng.range(-50, 50);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    return { ...d, x, z, weight: d.ring === 0 ? 1.75 : 1.0 };
  });
}

// Static colliders: spatial hash of circles
export class ColliderGrid {
  constructor(cell = 32) { this.cell = cell; this.map = new Map(); this.all = []; }
  key(i, j) { return i * 100003 + j; }
  add(c) {
    this.all.push(c);
    const s = this.cell;
    const i0 = Math.floor((c.x - c.r) / s), i1 = Math.floor((c.x + c.r) / s);
    const j0 = Math.floor((c.z - c.r) / s), j1 = Math.floor((c.z + c.r) / s);
    c._keys = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let arr = this.map.get(k);
      if (!arr) this.map.set(k, (arr = []));
      arr.push(c);
      c._keys.push(k);
    }
    return c;
  }
  remove(c) {
    if (!c._keys) return;
    for (const k of c._keys) {
      const arr = this.map.get(k);
      if (arr) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); }
    }
    const i = this.all.indexOf(c);
    if (i >= 0) this.all.splice(i, 1);
    c._keys = null;
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const s = this.cell;
    const i0 = Math.floor((x - r) / s), i1 = Math.floor((x + r) / s);
    const j0 = Math.floor((z - r) / s), j1 = Math.floor((z + r) / s);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = this.map.get(this.key(i, j));
      if (!arr) continue;
      for (const c of arr) if (!out.includes(c)) out.push(c);
    }
    return out;
  }
}

// prop type -> collider radius factor (0 = no collision), height
export const PROP_INFO = {
  cactus: { r: 0.8, h: 5 }, rock: { r: 1.0, h: 2 }, boulder: { r: 2.6, h: 4 }, wreck: { r: 2.2, h: 2 },
  bones: { r: 0, h: 1 }, skull: { r: 1.5, h: 3 }, palm: { r: 0.7, h: 9 }, bush: { r: 0, h: 1.5 },
  pillar: { r: 4.5, h: 18 }, deadtree: { r: 0.6, h: 6 }, barrel: { r: 0.6, h: 1.2 }, pumpjack: { r: 3, h: 6 },
  derrick: { r: 3.5, h: 16 }, mushroom: { r: 1.6, h: 6 }, tower: { r: 9, h: 30 }, building: { r: 8, h: 14 },
  lamp: { r: 0.3, h: 6 }, billboard: { r: 1.2, h: 8 }, spike: { r: 1.6, h: 7 }, vent: { r: 1.2, h: 2 },
  crystalBig: { r: 2.2, h: 10 }, crystalSmall: { r: 0, h: 2 }, shard: { r: 1.2, h: 4 }, sign: { r: 0.3, h: 3 },
  saltcrystal: { r: 0, h: 1.5 }, tire: { r: 0, h: 1 }, flower: { r: 0, h: 0.6 }, pipe: { r: 1.2, h: 2 },
};

const BIOME_PROPS = {
  dunes: [['cactus', 0.5], ['rock', 0.5], ['wreck', 0.25], ['bones', 0.3], ['skull', 0.05], ['tire', 0.2], ['sign', 0.05]],
  saltflats: [['saltcrystal', 1.2], ['wreck', 0.2], ['sign', 0.12], ['rock', 0.2], ['bones', 0.15]],
  canyon: [['pillar', 0.35], ['boulder', 0.6], ['deadtree', 0.3], ['rock', 0.8], ['cactus', 0.3]],
  oilfield: [['pumpjack', 0.18], ['derrick', 0.06], ['barrel', 0.8], ['pipe', 0.3], ['wreck', 0.15], ['rock', 0.2]],
  toxic: [['mushroom', 0.7], ['barrel', 0.5], ['deadtree', 0.5], ['bush', 0.4]],
  ruins: [['lamp', 0.3], ['wreck', 0.6], ['billboard', 0.12], ['barrel', 0.3], ['tire', 0.3]],
  oasis: [['palm', 1.0], ['bush', 1.0], ['flower', 1.4], ['rock', 0.3]],
  ashlands: [['spike', 0.5], ['vent', 0.25], ['deadtree', 0.5], ['boulder', 0.4], ['rock', 0.6]],
  crystal: [['crystalBig', 0.45], ['crystalSmall', 1.2], ['rock', 0.4], ['boulder', 0.2]],
  glass: [['shard', 0.5], ['wreck', 0.2], ['sign', 0.08], ['crystalSmall', 0.3]],
  hub: [],
};

const NODE_TYPES = {
  scrap: 'scrapPile', fuel: 'oilBarrels', ammo: 'ammoCrate', water: 'waterTank', food: 'foodCrate',
  chems: 'chemDrum', electronics: 'circuitBox', crystal: 'crystalNode',
};

export function generateWorld(seed) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const zones = layoutZones(seed);
  const terrain = new Terrain(seed, zones);
  terrain.generate();
  const rng = new RNG(seed * 31 + 5);

  // --- zone metrics: area, neighbours, centroid ---
  const area = new Array(zones.length).fill(0);
  const cx = new Array(zones.length).fill(0), cz = new Array(zones.length).fill(0);
  const adj = zones.map(() => new Set());
  const step = 8; // vertex stride for sampling
  const V = Math.round(HALF * 2 / CELL) + 1;
  for (let j = 0; j < V; j += step) for (let i = 0; i < V; i += step) {
    const zi = terrain.zoneIdx[j * V + i];
    area[zi]++; cx[zi] += -HALF + i * CELL; cz[zi] += -HALF + j * CELL;
    if (i + step < V) { const zr = terrain.zoneIdx[j * V + i + step]; if (zr !== zi) { adj[zi].add(zr); adj[zr].add(zi); } }
    if (j + step < V) { const zd = terrain.zoneIdx[(j + step) * V + i]; if (zd !== zi) { adj[zi].add(zd); adj[zd].add(zi); } }
  }
  zones.forEach((z, i) => {
    z.index = i;
    z.area = area[i] * (step * CELL) ** 2;
    z.cx = cx[i] / Math.max(1, area[i]);
    z.cz = cz[i] / Math.max(1, area[i]);
    z.neighbors = [...adj[i]].map((k) => zones[k].id);
    z.richness = { ...BIOMES[z.biome].resources };
    // outer ring is richer
    const mult = z.ring === 2 ? 1.6 : z.ring === 1 ? 1.0 : 0;
    for (const k in z.richness) z.richness[k] = +(z.richness[k] * mult * rng.range(0.85, 1.2)).toFixed(2);
  });

  // --- base sites: flat spots well inside each zone ---
  const sites = [];
  for (const z of zones) {
    if (z.biome === 'hub') continue;
    const cands = [];
    for (let k = 0; k < 220; k++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 360;
      const x = z.cx + Math.cos(a) * r, zz = z.cz + Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(zz)) > HALF - EDGE - 60) continue;
      if (terrain.zoneIndexAt(x, zz) !== z.index) continue;
      // must be away from other zones
      let ok = true;
      for (let q = 0; q < 8 && ok; q++) {
        const qa = (q / 8) * Math.PI * 2;
        if (terrain.zoneIndexAt(x + Math.cos(qa) * 70, zz + Math.sin(qa) * 70) !== z.index) ok = false;
      }
      if (!ok) continue;
      const h0 = terrain.heightAt(x, zz);
      let dev = 0, wet = 0;
      for (let ox = -24; ox <= 24; ox += 8) for (let oz = -24; oz <= 24; oz += 8) {
        const h = terrain.heightAt(x + ox, zz + oz);
        dev += Math.abs(h - h0);
        if (terrain.liquidAt(x + ox, zz + oz)) wet++;
      }
      if (wet > 2) continue;
      cands.push({ x, z: zz, h: h0, score: dev + rng.range(0, 10) });
    }
    cands.sort((a, b) => a.score - b.score);
    const chosen = [];
    for (const c of cands) {
      if (chosen.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 150)) chosen.push(c);
      if (chosen.length >= 4) break;
    }
    chosen.forEach((c, i) => sites.push({ id: `${z.id}_s${i}`, zoneId: z.id, x: Math.round(c.x), z: Math.round(c.z), h: c.h, rough: +c.score.toFixed(1) }));
  }

  // --- props ---
  const colliders = new ColliderGrid(32);
  const props = [];
  const nearSite = (x, z, r) => sites.some((s) => Math.hypot(s.x - x, s.z - z) < r);
  const addProp = (type, x, z, rot, scale, zoneId) => {
    const y = terrain.heightAt(x, z);
    const p = { type, x, z, y, rot, scale, zoneId };
    props.push(p);
    const info = PROP_INFO[type];
    if (info && info.r > 0) colliders.add({ x, z, r: info.r * scale, h: info.h * scale, y, kind: 'prop', prop: p });
    return p;
  };
  for (const z of zones) {
    const list = BIOME_PROPS[z.biome];
    if (!list || !list.length) continue;
    const density = z.area / 1600; // per 40x40m
    for (const [type, perArea] of list) {
      const count = Math.round(density * perArea * 0.55);
      for (let k = 0; k < count; k++) {
        // rejection-sample around the zone centroid
        const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * Math.sqrt(z.area / Math.PI) * 1.25;
        const px = z.cx + Math.cos(a) * r, pz = z.cz + Math.sin(a) * r;
        if (terrain.zoneIndexAt(px, pz) !== z.index) continue;
        if (Math.max(Math.abs(px), Math.abs(pz)) > HALF - EDGE * 0.7) continue;
        if (nearSite(px, pz, 55)) continue;
        if (terrain.liquidAt(px, pz) && type !== 'deadtree' && type !== 'mushroom') continue;
        const scale = rng.range(0.75, 1.35) * (type === 'pillar' ? rng.range(0.8, 1.5) : 1);
        addProp(type, px, pz, rng.range(0, Math.PI * 2), scale, z.id);
      }
    }
    // Ruins: city blocks of broken towers on the street grid
    if (z.biome === 'ruins') {
      const R = Math.sqrt(z.area / Math.PI);
      for (let gx = Math.floor((z.cx - R) / 64); gx <= Math.ceil((z.cx + R) / 64); gx++) {
        for (let gz = Math.floor((z.cz - R) / 64); gz <= Math.ceil((z.cz + R) / 64); gz++) {
          const px = gx * 64 + 32 + 6, pz = gz * 64 + 32 + 6;
          if (terrain.zoneIndexAt(px, pz) !== z.index || nearSite(px, pz, 60)) continue;
          if (!rng.chance(0.55)) continue;
          const tall = rng.chance(0.3);
          addProp(tall ? 'tower' : 'building', px + rng.range(-6, 6), pz + rng.range(-6, 6), Math.floor(rng.range(0, 4)) * Math.PI / 2, rng.range(0.8, 1.2), z.id);
        }
      }
    }
  }
  // Hub: wall ring with 4 gates, decorative props are built in the scene
  const hubWall = [];
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const gate = [0, 18, 36, 54].some((g) => Math.abs(k - g) <= 1 || Math.abs(k - g - 72) <= 1);
    if (gate) continue;
    const x = Math.cos(a) * 192, zz = Math.sin(a) * 192;
    hubWall.push({ x, z: zz, a });
    colliders.add({ x, z: zz, r: 9, h: 7, y: terrain.heightAt(x, zz), kind: 'wall' });
  }

  // --- resource node spawn points (dynamic pickups) ---
  const nodeSpawns = [];
  for (const z of zones) {
    if (z.biome === 'hub') continue;
    const res = Object.entries(z.richness);
    const total = res.reduce((s, [, v]) => s + v, 0);
    const n = Math.round((z.area / 9000) * (0.8 + total * 0.3));
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * Math.sqrt(z.area / Math.PI);
      const px = z.cx + Math.cos(a) * r, pz = z.cz + Math.sin(a) * r;
      if (terrain.zoneIndexAt(px, pz) !== z.index || terrain.liquidAt(px, pz)) continue;
      if (Math.max(Math.abs(px), Math.abs(pz)) > HALF - EDGE) continue;
      const pick = rng.weighted(res, ([, v]) => v);
      if (!pick) continue;
      nodeSpawns.push({ id: `n${nodeSpawns.length}`, zoneId: z.id, res: pick[0], type: NODE_TYPES[pick[0]], x: Math.round(px), z: Math.round(pz), amount: Math.round(rng.range(6, 14) * (z.ring === 2 ? 1.5 : 1)) });
    }
  }

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { seed, zones, terrain, sites, props, colliders, hubWall, nodeSpawns, genMs: ms };
}

export function zoneById(world, id) { return world.zones.find((z) => z.id === id); }
export { NODE_TYPES };
export const clampToWorld = (v) => clamp(v, -HALF + EDGE, HALF - EDGE);
