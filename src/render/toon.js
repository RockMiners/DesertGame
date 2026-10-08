// Cartoon rendering helpers: banded toon materials and inverted-hull outlines.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let _gradient = null;
export function gradientMap() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([90, 90, 90, 255, 165, 165, 165, 255, 225, 225, 225, 255, 255, 255, 255, 255]);
  _gradient = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  _gradient.minFilter = THREE.NearestFilter;
  _gradient.magFilter = THREE.NearestFilter;
  _gradient.generateMipmaps = false;
  _gradient.needsUpdate = true;
  return _gradient;
}

const matCache = new Map();
export function toonMat(color, opts = {}) {
  const key = `${color}|${opts.vertexColors ? 1 : 0}|${opts.emissive || 0}|${opts.transparent ? opts.opacity : 1}`;
  if (!opts.noCache && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({
    color: opts.vertexColors ? 0xffffff : color,
    gradientMap: gradientMap(),
    vertexColors: !!opts.vertexColors,
    emissive: opts.emissive || 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
  if (!opts.noCache) matCache.set(key, m);
  return m;
}

const outlineMats = new Map();
export function outlineMat(thickness = 0.06, color = 0x2b1d14) {
  const key = `${thickness}|${color}`;
  if (outlineMats.has(key)) return outlineMats.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineT = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outlineT;');
  };
  m.customProgramCacheKey = () => 'outline' + thickness;
  outlineMats.set(key, m);
  return m;
}

const outlineGeoCache = new WeakMap();
export function outlineGeometry(geo) {
  if (outlineGeoCache.has(geo)) return outlineGeoCache.get(geo);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  outlineGeoCache.set(geo, merged);
  return merged;
}

export function outlined(geo, mat, thickness = 0.06, shadows = true) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = shadows; mesh.receiveShadow = shadows;
  const ol = new THREE.Mesh(outlineGeometry(geo), outlineMat(thickness));
  group.add(mesh, ol);
  group.userData.mesh = mesh;
  return group;
}

// Merge a list of {geo, color, matrix} into one vertex-coloured geometry
export function mergeColored(parts) {
  let vCount = 0, iCount = 0;
  const prepared = parts.map((p) => {
    let g = p.geo.index ? p.geo : p.geo; // keep index
    g = g.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    vCount += g.getAttribute('position').count;
    iCount += g.index ? g.index.count : g.getAttribute('position').count;
    return { g, color: new THREE.Color(p.color) };
  });
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const { g, color } of prepared) {
    const P = g.getAttribute('position'), Nn = g.getAttribute('normal');
    for (let i = 0; i < P.count; i++) {
      pos[(vo + i) * 3] = P.getX(i); pos[(vo + i) * 3 + 1] = P.getY(i); pos[(vo + i) * 3 + 2] = P.getZ(i);
      nor[(vo + i) * 3] = Nn.getX(i); nor[(vo + i) * 3 + 1] = Nn.getY(i); nor[(vo + i) * 3 + 2] = Nn.getZ(i);
      col[(vo + i) * 3] = color.r; col[(vo + i) * 3 + 1] = color.g; col[(vo + i) * 3 + 2] = color.b;
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < P.count; i++) idx[io + i] = vo + i; io += P.count; }
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Small geometry builders
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
void _m;
