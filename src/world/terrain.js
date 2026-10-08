// Heightfield terrain: generation from zones/biomes, sampling for physics, editing for bases.
import { RNG, Noise2D, clamp, smoothstep, lerp } from '../core/math.js';
import { HEIGHT, COLOR, BIOMES, CLIFF_COLOR, LIQUIDS, mix3, hex } from './biomes.js';

export const WORLD_SIZE = 3072;
export const HALF = WORLD_SIZE / 2;
export const CELLS = 768;
export const CELL = WORLD_SIZE / CELLS; // 4m
export const VERTS = CELLS + 1;
export const EDGE = 110; // mountain rim width
export const PLAY_LIMIT = HALF - 40;

export class Terrain {
  constructor(seed, zones) {
    this.seed = seed;
    this.zones = zones; // [{id, biome, x, z, weight}]
    this.N = { a: new Noise2D(seed * 3 + 1), b: new Noise2D(seed * 7 + 2), c: new Noise2D(seed * 11 + 3) };
    this.heights = new Float32Array(VERTS * VERTS);
    this.colors = new Float32Array(VERTS * VERTS * 3);
    this.zoneIdx = new Uint8Array(VERTS * VERTS);
    this.dirtyChunks = new Set();
    this.listeners = [];
  }

  warp(x, z) {
    const N = this.N;
    return [x + 70 * N.c.noise(x / 420, z / 420), z + 70 * N.c.noise(x / 420 + 100, z / 420 - 50)];
  }

  // returns list of [zoneIndex, weight] (weights normalised)
  zoneWeights(x, z, out) {
    const [wx, wz] = this.warp(x, z);
    const zs = this.zones;
    let d1 = Infinity;
    const ds = this._ds || (this._ds = new Float32Array(zs.length));
    for (let i = 0; i < zs.length; i++) {
      const d = Math.hypot(wx - zs[i].x, wz - zs[i].z) * zs[i].weight;
      ds[i] = d;
      if (d < d1) d1 = d;
    }
    out.length = 0;
    let sum = 0;
    for (let i = 0; i < zs.length; i++) {
      const dd = ds[i] - d1;
      if (dd < 130) {
        const w = Math.exp(-dd / 26);
        out.push(i, w);
        sum += w;
      }
    }
    for (let k = 1; k < out.length; k += 2) out[k] /= sum;
    return out;
  }

  edgeHeight(x, z) {
    const e = HALF - Math.max(Math.abs(x), Math.abs(z));
    if (e > EDGE) return 0;
    const t = 1 - e / EDGE;
    return t * t * 95 + t * 30 * this.N.a.ridged(x / 140, z / 140, 3);
  }

  rawHeight(x, z, wbuf) {
    const w = this.zoneWeights(x, z, wbuf);
    let h = 0;
    let best = -1, bestW = -1;
    for (let k = 0; k < w.length; k += 2) {
      const zi = w[k];
      const fn = HEIGHT[this.zones[zi].biome];
      h += fn(x, z, this.N) * w[k + 1];
      if (w[k + 1] > bestW) { bestW = w[k + 1]; best = zi; }
    }
    return [h + this.edgeHeight(x, z), best];
  }

  generate() {
    const wbuf = [];
    const H = this.heights;
    for (let j = 0; j < VERTS; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < VERTS; i++) {
        const x = -HALF + i * CELL;
        const [h, zi] = this.rawHeight(x, z, wbuf);
        H[j * VERTS + i] = h;
        this.zoneIdx[j * VERTS + i] = zi;
      }
    }
    this.recolor(0, 0, VERTS - 1, VERTS - 1);
  }

  recolor(i0, j0, i1, j1) {
    const wbuf = [];
    const H = this.heights, C = this.colors;
    for (let j = Math.max(0, j0); j <= Math.min(VERTS - 1, j1); j++) {
      const z = -HALF + j * CELL;
      for (let i = Math.max(0, i0); i <= Math.min(VERTS - 1, i1); i++) {
        const x = -HALF + i * CELL;
        const idx = j * VERTS + i;
        const h = H[idx];
        const hx = H[j * VERTS + Math.min(VERTS - 1, i + 1)] - H[j * VERTS + Math.max(0, i - 1)];
        const hz = H[Math.min(VERTS - 1, j + 1) * VERTS + i] - H[Math.max(0, j - 1) * VERTS + i];
        const slope = Math.hypot(hx, hz) / (2 * CELL);
        const w = this.zoneWeights(x, z, wbuf);
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < w.length; k += 2) {
          const zone = this.zones[w[k]];
          const c = COLOR[zone.biome](h, slope, x, z, this.N);
          r += c[0] * w[k + 1]; g += c[1] * w[k + 1]; b += c[2] * w[k + 1];
        }
        let col = [r, g, b];
        const zb = this.zones[this.zoneIdx[idx]].biome;
        if (slope > 0.85 && zb !== 'glass' && zb !== 'crystal' && zb !== 'canyon') col = mix3(col, CLIFF_COLOR, smoothstep(0.85, 1.4, slope) * 0.7);
        const e = HALF - Math.max(Math.abs(x), Math.abs(z));
        if (e < EDGE) col = mix3(col, hex(0xa86f50), smoothstep(EDGE, EDGE * 0.4, e));
        // tiny speckle for a hand-painted feel
        const sp = 0.03 * this.N.a.noise(x * 0.37, z * 0.37);
        // palette is authored in sRGB; vertex colours are linear
        C[idx * 3] = Math.pow(clamp(col[0] + sp, 0, 1), 2.2);
        C[idx * 3 + 1] = Math.pow(clamp(col[1] + sp, 0, 1), 2.2);
        C[idx * 3 + 2] = Math.pow(clamp(col[2] + sp, 0, 1), 2.2);
      }
    }
  }

  // --- Sampling ---
  // Height interpolated over the same triangulation as the render mesh (diagonal i,j -> i+1,j+1)
  heightAt(x, z) {
    const fx = clamp((x + HALF) / CELL, 0, CELLS - 0.0001);
    const fz = clamp((z + HALF) / CELL, 0, CELLS - 0.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const H = this.heights;
    const h00 = H[j * VERTS + i], h10 = H[j * VERTS + i + 1];
    const h01 = H[(j + 1) * VERTS + i], h11 = H[(j + 1) * VERTS + i + 1];
    if (u > v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
    return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }

  normalAt(x, z, out) {
    const e = 1.5;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    let nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out = out || { x: 0, y: 0, z: 0 };
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  zoneIndexAt(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, VERTS - 1);
    const j = clamp(Math.round((z + HALF) / CELL), 0, VERTS - 1);
    return this.zoneIdx[j * VERTS + i];
  }
  zoneAt(x, z) { return this.zones[this.zoneIndexAt(x, z)]; }
  biomeAt(x, z) { return BIOMES[this.zoneAt(x, z).biome]; }

  liquidAt(x, z) {
    const b = this.biomeAt(x, z);
    if (!b.liquid) return null;
    const h = this.heightAt(x, z);
    if (h < b.liquid.level) return { type: b.liquid.type, level: b.liquid.level, depth: b.liquid.level - h, ...LIQUIDS[b.liquid.type] };
    return null;
  }

  slopeAt(x, z) {
    const n = this.normalAt(x, z);
    return Math.sqrt(1 - n.y * n.y) / Math.max(0.05, n.y);
  }

  inBounds(x, z) { return Math.abs(x) < PLAY_LIMIT && Math.abs(z) < PLAY_LIMIT; }

  // --- Editing ---
  // Flatten rectangle (world coords) toward target height with a soft skirt.
  flatten(cx, cz, halfW, halfD, target, skirt = 10) {
    const i0 = Math.floor((cx - halfW - skirt + HALF) / CELL), i1 = Math.ceil((cx + halfW + skirt + HALF) / CELL);
    const j0 = Math.floor((cz - halfD - skirt + HALF) / CELL), j1 = Math.ceil((cz + halfD + skirt + HALF) / CELL);
    let moved = 0;
    for (let j = Math.max(0, j0); j <= Math.min(VERTS - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(VERTS - 1, i1); i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        const dx = Math.max(0, Math.abs(x - cx) - halfW), dz = Math.max(0, Math.abs(z - cz) - halfD);
        const d = Math.hypot(dx, dz);
        const t = 1 - smoothstep(0, skirt, d);
        if (t <= 0) continue;
        const idx = j * VERTS + i;
        const nh = lerp(this.heights[idx], target, t);
        moved += Math.abs(nh - this.heights[idx]);
        this.heights[idx] = nh;
      }
    }
    this.recolor(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
    this.markDirty(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
    return moved;
  }

  // estimate of how much earth needs moving to flatten (used for build costs)
  flattenCost(cx, cz, halfW, halfD, target) {
    let sum = 0;
    for (let x = cx - halfW; x <= cx + halfW; x += CELL) for (let z = cz - halfD; z <= cz + halfD; z += CELL) sum += Math.abs(this.heightAt(x, z) - target);
    return sum;
  }

  markDirty(i0, j0, i1, j1) {
    const cs = CHUNK;
    for (let cj = Math.floor(Math.max(0, j0) / cs); cj <= Math.floor(Math.min(CELLS - 1, j1) / cs); cj++)
      for (let ci = Math.floor(Math.max(0, i0) / cs); ci <= Math.floor(Math.min(CELLS - 1, i1) / cs); ci++)
        this.dirtyChunks.add(cj * CHUNKS + ci);
    for (const l of this.listeners) l();
  }

  serializeEdits() {
    // Edits are stored by the sim layer as flatten ops; nothing extra here.
    return null;
  }
}

export const CHUNK = 48; // cells per chunk side
export const CHUNKS = CELLS / CHUNK; // 16
