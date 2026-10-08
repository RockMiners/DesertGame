// Chunked terrain + liquid meshes built from the heightfield.
import * as THREE from 'three';
import { CELLS, CELL, VERTS, HALF, CHUNK, CHUNKS } from '../world/terrain.js';
import { BIOMES, LIQUIDS } from '../world/biomes.js';
import { gradientMap } from './toon.js';

export class TerrainRenderer {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() });
    this.chunks = [];
    const n = CHUNK + 1;
    const idx = [];
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // diagonal a-d matches Terrain.heightAt
      idx.push(a, c, d, a, d, b);
    }
    this.index = new THREE.BufferAttribute(new Uint32Array(idx), 1);
    for (let cj = 0; cj < CHUNKS; cj++) for (let ci = 0; ci < CHUNKS; ci++) this.chunks.push(this.buildChunk(ci, cj));
    this.buildLiquids();
    this.time = 0;
  }

  buildChunk(ci, cj, existing) {
    const n = CHUNK + 1;
    const T = this.terrain;
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = ci * CHUNK + i, gj = cj * CHUNK + j;
      const vi = gj * VERTS + gi;
      const k = (j * n + i) * 3;
      pos[k] = -HALF + gi * CELL; pos[k + 1] = T.heights[vi]; pos[k + 2] = -HALF + gj * CELL;
      const hl = T.heights[gj * VERTS + Math.max(0, gi - 1)], hr = T.heights[gj * VERTS + Math.min(VERTS - 1, gi + 1)];
      const hd = T.heights[Math.max(0, gj - 1) * VERTS + gi], hu = T.heights[Math.min(VERTS - 1, gj + 1) * VERTS + gi];
      let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
      const l = Math.hypot(nx, ny, nz);
      nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
      col[k] = T.colors[vi * 3]; col[k + 1] = T.colors[vi * 3 + 1]; col[k + 2] = T.colors[vi * 3 + 2];
    }
    if (existing) {
      const g = existing.geometry;
      g.getAttribute('position').array.set(pos); g.getAttribute('position').needsUpdate = true;
      g.getAttribute('normal').array.set(nor); g.getAttribute('normal').needsUpdate = true;
      g.getAttribute('color').array.set(col); g.getAttribute('color').needsUpdate = true;
      g.computeBoundingSphere();
      return existing;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.ci = ci; mesh.userData.cj = cj;
    this.group.add(mesh);
    return mesh;
  }

  refreshDirty() {
    const T = this.terrain;
    if (!T.dirtyChunks.size) return;
    for (const id of T.dirtyChunks) {
      const ci = id % CHUNKS, cj = Math.floor(id / CHUNKS);
      this.buildChunk(ci, cj, this.chunks[id]);
    }
    T.dirtyChunks.clear();
  }

  buildLiquids() {
    const T = this.terrain;
    const byType = {};
    const step = 2; // liquid quads every 2 cells (8m) – generous overlap under the terrain
    for (let j = 0; j < CELLS; j += step) for (let i = 0; i < CELLS; i += step) {
      const vi = j * VERTS + i;
      const zone = T.zones[T.zoneIdx[vi]];
      const liq = BIOMES[zone.biome].liquid;
      if (!liq) continue;
      let mn = Infinity;
      for (let a = 0; a <= step; a++) for (let b = 0; b <= step; b++) mn = Math.min(mn, T.heights[Math.min(VERTS - 1, j + b) * VERTS + Math.min(VERTS - 1, i + a)]);
      if (mn >= liq.level) continue;
      const arr = byType[liq.type] || (byType[liq.type] = { level: liq.level, quads: [] });
      arr.quads.push(-HALF + i * CELL, -HALF + j * CELL);
    }
    this.liquidMeshes = [];
    for (const [type, { level, quads }] of Object.entries(byType)) {
      const info = LIQUIDS[type];
      const s = step * CELL;
      const nq = quads.length / 2;
      const pos = new Float32Array(nq * 4 * 3);
      const idx = new Uint32Array(nq * 6);
      for (let q = 0; q < nq; q++) {
        const x = quads[q * 2], z = quads[q * 2 + 1];
        const o = q * 12;
        pos.set([x, level, z, x + s, level, z, x, level, z + s, x + s, level, z + s], o);
        idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mat = new THREE.MeshToonMaterial({
        color: info.color, gradientMap: gradientMap(), transparent: info.opacity < 1, opacity: info.opacity,
        emissive: info.emissive, emissiveIntensity: type === 'lava' ? 0.9 : 0.6,
      });
      const uni = { time: { value: 0 } };
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.time = uni.time;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float time;\nvarying vec2 vWPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(position.x*0.12+time*1.3)*0.12 + cos(position.z*0.1+time)*0.12;\nvWPos = position.xz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float time;\nvarying vec2 vWPos;')
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            float w = sin(vWPos.x*0.21 + time*1.7) * sin(vWPos.y*0.17 - time*1.3);
            float sparkle = smoothstep(0.82, 0.95, w);
            gl_FragColor.rgb += sparkle * ${type === 'tar' ? '0.12' : '0.35'};`);
      };
      mat.customProgramCacheKey = () => 'liquid-' + type;
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = type !== 'lava';
      mesh.userData.uni = uni;
      this.group.add(mesh);
      this.liquidMeshes.push(mesh);
    }
  }

  update(dt) {
    this.time += dt;
    for (const m of this.liquidMeshes) m.userData.uni.time.value = this.time;
    this.refreshDirty();
  }
}
