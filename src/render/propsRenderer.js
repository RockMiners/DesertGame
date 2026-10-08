// Instanced static props, grouped by region for culling.
import * as THREE from 'three';
import { propGeometry, vcMat } from './models.js';
import { outlineGeometry, outlineMat } from './toon.js';

const REGION = 384;
const SMALL = new Set(['flower', 'crystalSmall', 'saltcrystal', 'bones', 'tire', 'bush', 'barrel', 'sign', 'rock']);

export class PropsRenderer {
  constructor(scene, props) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.regions = new Map();
    const buckets = new Map();
    for (const p of props) {
      const rk = `${Math.floor(p.x / REGION)},${Math.floor(p.z / REGION)}`;
      const key = `${rk}|${p.type}`;
      if (!buckets.has(key)) buckets.set(key, { rk, type: p.type, list: [] });
      buckets.get(key).list.push(p);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const { rk, type, list } of buckets.values()) {
      const geo = propGeometry(type);
      const mesh = new THREE.InstancedMesh(geo, vcMat(), list.length);
      const ol = new THREE.InstancedMesh(outlineGeometry(geo), outlineMat(SMALL.has(type) ? 0.04 : 0.08), list.length);
      mesh.castShadow = !SMALL.has(type);
      mesh.receiveShadow = true;
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        s.setScalar(p.scale);
        v.set(p.x, p.y - 0.2, p.z);
        m.compose(v, q, s);
        mesh.setMatrixAt(i, m);
        ol.setMatrixAt(i, m);
        p._mesh = mesh; p._ol = ol; p._i = i;
      });
      mesh.computeBoundingSphere();
      ol.computeBoundingSphere();
      if (!this.regions.has(rk)) {
        const [rx, rz] = rk.split(',').map(Number);
        this.regions.set(rk, { cx: (rx + 0.5) * REGION, cz: (rz + 0.5) * REGION, meshes: [] });
      }
      this.regions.get(rk).meshes.push({ mesh, ol, small: SMALL.has(type) });
      this.group.add(mesh, ol);
    }
  }

  hide(p) {
    if (!p._mesh) return;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    p._mesh.setMatrixAt(p._i, m); p._mesh.instanceMatrix.needsUpdate = true;
    p._ol.setMatrixAt(p._i, m); p._ol.instanceMatrix.needsUpdate = true;
  }

  update(camPos, viewDist) {
    for (const r of this.regions.values()) {
      const d = Math.hypot(r.cx - camPos.x, r.cz - camPos.z) - REGION * 0.71;
      for (const e of r.meshes) {
        const lim = e.small ? 260 : viewDist + 60;
        const vis = d < lim;
        e.mesh.visible = vis;
        e.ol.visible = vis && d < (e.small ? 160 : 450);
      }
    }
  }
}
