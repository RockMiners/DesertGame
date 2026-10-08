// Procedural cartoon buildings for bases and the Hub.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeColored, M } from './toon.js';
import { C } from './models.js';
import { TILE } from '../sim/defs.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rbox = (w, h, d, r = 0.2) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const tor = (r, t) => new THREE.TorusGeometry(r, t, 6, 12);
const P = (geo, color, ...m) => ({ geo, color, matrix: M(...m) });

const WOOD = 0x9c6b3e, TIN = 0xa9b4bd, RUST = 0xb5651d, DARK = 0x3a3a44, ROOF = 0x7d8a96, CONCRETE = 0xc9bfae;

function flag(parts, x, y, z, col, h = 5) {
  parts.push(P(cyl(0.08, 0.08, h, 6), DARK, x, y + h / 2, z));
  parts.push(P(box(1.6, 1.0, 0.06), col, x + 0.8, y + h - 0.6, z));
}

// returns parts list for a structure of type, footprint w x d tiles, centred at origin
export function structureParts(type, w, d, col, acc) {
  const W = w * TILE, D = d * TILE;
  const parts = [];
  switch (type) {
    case 'hq':
      parts.push(P(box(W * 0.95, 0.5, D * 0.95), CONCRETE, 0, 0.25, 0));
      parts.push(P(rbox(W * 0.7, 5, D * 0.7, 0.4), CONCRETE, 0, 2.9, 0));
      parts.push(P(box(W * 0.72, 0.8, D * 0.72), col, 0, 4.6, 0));
      parts.push(P(rbox(W * 0.4, 3, D * 0.4, 0.3), TIN, 0, 6.5, 0));
      parts.push(P(cone(W * 0.32, 2.2, 4), col, 0, 9.1, 0, 0, Math.PI / 4, 0));
      for (let i = -1; i <= 1; i++) parts.push(P(box(1.2, 1.0, 0.1), 0xfff3b0, i * 2.5, 3.2, D * 0.35 + 0.02));
      parts.push(P(box(2.4, 3.2, 0.2), DARK, 0, 1.8, D * 0.35 + 0.05));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(P(cyl(0.6, 0.8, 6, 8), TIN, sx * W * 0.36, 3, sz * D * 0.36));
      flag(parts, 0, 10, 0, acc, 4);
      break;
    case 'shack':
      parts.push(P(box(W * 0.75, 2.6, D * 0.75), WOOD, 0, 1.3, 0));
      parts.push(P(box(W * 0.9, 0.2, D * 0.9), RUST, 0, 2.8, 0, 0.15, 0, 0));
      parts.push(P(box(1.0, 1.8, 0.1), DARK, 0, 0.9, D * 0.375 + 0.02));
      parts.push(P(box(0.9, 0.7, 0.1), 0xfff3b0, 1.4, 1.6, D * 0.375 + 0.02));
      parts.push(P(cyl(0.2, 0.2, 1.4, 6), TIN, -1.2, 3.4, -0.8));
      parts.push(P(box(W * 0.76, 0.3, 0.12), col, 0, 2.3, D * 0.375 + 0.03));
      break;
    case 'bunkhouse':
      parts.push(P(rbox(W * 0.9, 3.2, D * 0.8, 0.6), TIN, 0, 1.6, 0));
      for (let i = 0; i < 4; i++) parts.push(P(box(0.9, 0.7, 0.1), 0xfff3b0, -W * 0.33 + i * W * 0.22, 2.0, D * 0.4 + 0.02));
      parts.push(P(box(W * 0.92, 0.4, D * 0.82), col, 0, 3.3, 0));
      parts.push(P(box(1.0, 1.9, 0.1), DARK, W * 0.4, 0.95, D * 0.4 + 0.03));
      break;
    case 'mine':
      parts.push(P(box(W * 0.9, 0.6, D * 0.9), 0x8d7b68, 0, 0.3, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(P(cyl(0.18, 0.18, 8, 6), C.yellow, sx * 2.2, 4, sz * 2.2, sz * 0.2, 0, -sx * 0.2));
      parts.push(P(box(2.0, 1.2, 2.0), C.yellow, 0, 8, 0));
      parts.push(P(cyl(0.5, 0.5, 6, 8), TIN, 0, 4, 0));
      parts.push(P(cone(1.2, 2, 8), DARK, 0, 1.2, 0, Math.PI, 0, 0));
      parts.push(P(box(3, 1.6, 2), col, -W * 0.3, 0.8, D * 0.3));
      parts.push(P(box(1.8, 1.2, 1.2), C.rust, W * 0.3, 0.9, -D * 0.25));
      break;
    case 'pump':
      parts.push(P(box(W * 0.8, 0.4, D * 0.85), DARK, 0, 0.2, 0));
      parts.push(P(cyl(0.15, 0.15, 4.2, 6), col, 0.6, 2.2, 0, 0, 0, 0.18));
      parts.push(P(cyl(0.15, 0.15, 4.2, 6), col, -0.6, 2.2, 0, 0, 0, -0.18));
      parts.push(P(box(0.5, 0.5, D * 0.8), col, 0, 4.4, 0, 0.12, 0, 0));
      parts.push(P(rbox(0.7, 1.6, 1.0, 0.2), acc, 0, 4.0, D * 0.38, 0.12, 0, 0));
      parts.push(P(box(1.0, 1.0, 1.0), DARK, 0, 1.0, -D * 0.3));
      parts.push(P(cyl(0.4, 0.4, 1.2, 8), C.orange, 1.6, 0.6, D * 0.3));
      break;
    case 'well':
      parts.push(P(cyl(1.6, 1.8, 1.2, 12), CONCRETE, 0, 0.6, 0));
      parts.push(P(cyl(1.3, 1.3, 0.1, 12), 0x4fc3e8, 0, 1.15, 0));
      for (const sx of [-1, 1]) parts.push(P(box(0.25, 3.2, 0.25), WOOD, sx * 1.5, 1.6, 0));
      parts.push(P(cone(2.0, 1.4, 4), col, 0, 3.8, 0, 0, Math.PI / 4, 0));
      parts.push(P(cyl(0.3, 0.3, 0.5, 8), TIN, 0, 2.2, 0));
      break;
    case 'farm':
      parts.push(P(box(W * 0.9, 0.4, D * 0.9), 0x6b4f3a, 0, 0.2, 0));
      parts.push(P(new THREE.SphereGeometry(W * 0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xbfe9ff, 0, 0.4, 0));
      for (let i = 0; i < 6; i++) parts.push(P(sph(0.7, 6, 5), i % 2 ? 0x7bc950 : 0x5aa83c, Math.cos(i) * 2.2, 0.9, Math.sin(i * 1.7) * 2.2));
      parts.push(P(sph(0.4, 6, 5), C.red, 1.2, 1.4, 0.3));
      parts.push(P(box(W * 0.2, 0.25, 0.25), col, 0, 0.5, D * 0.45));
      break;
    case 'extractor':
      parts.push(P(cyl(1.6, 2.0, 3.5, 10), 0x9be15d, 0, 1.75, 0));
      parts.push(P(cyl(1.7, 1.7, 0.3, 10), DARK, 0, 3.5, 0));
      parts.push(P(cyl(0.3, 0.3, 2.5, 6), TIN, 1.2, 4.5, 0));
      parts.push(P(sph(0.6, 8, 6), 0x7cff4f, 0, 4.0, 0));
      parts.push(P(box(0.3, 1.0, 3.6), col, -1.9, 1.5, 0));
      break;
    case 'solar':
      for (let i = 0; i < 3; i++) {
        const x = -W * 0.3 + i * W * 0.3;
        parts.push(P(cyl(0.12, 0.12, 1.4, 6), DARK, x, 0.7, 0));
        parts.push(P(box(W * 0.27, 0.12, D * 0.7), 0x1d3557, x, 1.6, 0, 0.45, 0, 0));
        parts.push(P(box(W * 0.27, 0.13, 0.08), 0xe9eef2, x, 1.62, 0, 0.45, 0, 0));
      }
      parts.push(P(box(0.6, 0.6, 0.6), col, W * 0.42, 0.3, D * 0.3));
      break;
    case 'generator':
      parts.push(P(rbox(W * 0.7, 2.2, D * 0.6, 0.3), C.orange, 0, 1.1, 0));
      parts.push(P(cyl(0.3, 0.3, 2.5, 8), DARK, 1.2, 2.6, -0.5));
      parts.push(P(box(W * 0.5, 0.5, 0.1), C.yellow, 0, 1.5, D * 0.3 + 0.02));
      parts.push(P(sph(0.35, 8, 6), 0xfff3b0, -1.0, 2.5, 0));
      break;
    case 'ammo':
      parts.push(P(box(W * 0.85, 4, D * 0.7), 0x6b7a3a, 0, 2, -0.5));
      parts.push(P(box(W * 0.86, 0.6, D * 0.72), col, 0, 4.2, -0.5));
      parts.push(P(cyl(0.6, 0.8, 5, 8), RUST, W * 0.3, 5, -D * 0.25));
      for (let i = 0; i < 5; i++) parts.push(P(box(1.0, 0.7, 0.8), C.olive, -W * 0.3 + i * 1.3, 0.35, D * 0.35));
      break;
    case 'garage':
      parts.push(P(box(W * 0.9, 4.5, D * 0.85), TIN, 0, 2.25, 0));
      parts.push(P(new THREE.CylinderGeometry(W * 0.46, W * 0.46, D * 0.86, 12, 1, false, 0, Math.PI), ROOF, 0, 4.5, 0, Math.PI / 2, Math.PI / 2, 0));
      parts.push(P(box(W * 0.6, 3.6, 0.15), DARK, 0, 1.8, D * 0.43));
      for (let i = 0; i < 6; i++) parts.push(P(box(W * 0.6, 0.08, 0.17), 0x55606e, 0, 0.4 + i * 0.55, D * 0.43));
      parts.push(P(box(W * 0.5, 0.9, 0.12), col, 0, 4.2, D * 0.44));
      parts.push(P(tor(0.6, 0.18), C.dark, W * 0.38, 0.4, D * 0.45, Math.PI / 2, 0, 0));
      break;
    case 'turret': case 'cannonT': case 'laserT':
      parts.push(P(cyl(1.8, 2.2, 2.6, 8), type === 'laserT' ? 0xdedbe8 : CONCRETE, 0, 1.3, 0));
      parts.push(P(cyl(2.3, 2.3, 0.4, 8), col, 0, 2.7, 0));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.push(P(box(0.6, 0.7, 0.4), CONCRETE, Math.cos(a) * 2.1, 3.2, Math.sin(a) * 2.1, 0, -a, 0)); }
      break;
    case 'wall':
      parts.push(P(box(W * 0.98, 3.2, 1.6), RUST, 0, 1.6, 0));
      parts.push(P(box(W * 0.98, 0.4, 1.8), col, 0, 3.2, 0));
      for (let i = -1; i <= 1; i++) parts.push(P(cone(0.35, 1.2, 4), C.metal, i * 1.8, 3.9, 0));
      parts.push(P(box(1.4, 1.2, 0.2), TIN, 1, 1.5, 0.85, 0, 0, 0.2));
      parts.push(P(box(1.2, 1.4, 0.2), C.metal, -1.4, 1.1, 0.86, 0, 0, -0.15));
      break;
    case 'depot':
      parts.push(P(box(W * 0.9, 2.4, D * 0.5), 0x2a9d8f, 0, 1.2, -D * 0.2));
      parts.push(P(box(W * 0.9, 0.1, D * 0.5), col, 0, 2.45, -D * 0.2));
      for (let i = 0; i < 3; i++) parts.push(P(box(1.1, 1.0, 1.1), WOOD, -1.5 + i * 1.5, 0.5, D * 0.28));
      parts.push(P(box(1.0, 0.9, 1.0), WOOD, -0.7, 1.45, D * 0.28));
      break;
    case 'radio':
      for (let i = 0; i < 4; i++) parts.push(P(cyl(0.6 - i * 0.12, 0.7 - i * 0.12, 3.5, 4), i % 2 ? col : 0xdddddd, 0, 1.75 + i * 3.4, 0, 0, Math.PI / 4, 0));
      parts.push(P(sph(0.6, 8, 6), C.red, 0, 15.2, 0));
      parts.push(P(sph(1.0, 8, 4), 0xffffff, 0.8, 10, 0, 0.6, 0, 0.9, 1, 0.4, 1));
      break;
    case 'market':
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(P(cyl(0.1, 0.1, 3, 6), WOOD, sx * 2.2, 1.5, sz * 2.2));
      parts.push(P(box(5, 0.15, 5), col, 0, 3.1, 0, 0.12, 0, 0));
      for (let i = 0; i < 5; i++) parts.push(P(box(1.0, 0.2, 5.1), i % 2 ? 0xffffff : acc, -2 + i * 1.0, 3.05, 0, 0.12, 0, 0));
      parts.push(P(box(4, 1.0, 1.2), WOOD, 0, 0.5, 1.2));
      parts.push(P(sph(0.3, 6, 4), C.orange, -1, 1.2, 1.2));
      parts.push(P(sph(0.3, 6, 4), C.red, 0, 1.2, 1.2));
      parts.push(P(cyl(0.25, 0.25, 0.5, 8), 0x9be15d, 1, 1.25, 1.2));
      break;
    case 'autorig':
      parts.push(P(box(W * 0.7, 0.8, D * 0.7), DARK, 0, 0.4, 0));
      parts.push(P(cyl(0.3, 0.3, 2.6, 6), C.yellow, 0, 2.1, 0, 0, 0, 0.4));
      parts.push(P(cyl(0.25, 0.25, 2.2, 6), C.yellow, 1.0, 3.6, 0, 0, 0, -0.9));
      parts.push(P(box(0.6, 0.6, 0.6), C.orange, 1.9, 3.2, 0));
      parts.push(P(sph(0.3, 6, 4), 0x7fd1ff, 0, 1.0, 0.8));
      break;
    default:
      parts.push(P(box(W * 0.8, 2, D * 0.8), 0xff00ff, 0, 1, 0));
  }
  return parts;
}

const cache = new Map();
export function structureGeometry(type, w, d, col, acc) {
  const k = `${type}|${col}|${acc}`;
  if (!cache.has(k)) cache.set(k, mergeColored(structureParts(type, w, d, new THREE.Color(col).getHex(), new THREE.Color(acc).getHex())));
  return cache.get(k);
}

// rotating turret heads (pivot at origin, barrel +z)
const headCache = new Map();
export function turretHeadGeometry(type) {
  if (headCache.has(type)) return headCache.get(type);
  const parts = [];
  if (type === 'turret') {
    parts.push(P(rbox(1.4, 1.0, 1.6, 0.2), 0x6b7a3a, 0, 0.5, 0));
    for (const sx of [-1, 1]) parts.push(P(cyl(0.1, 0.1, 2.0, 6), DARK, sx * 0.3, 0.55, 1.4, Math.PI / 2, 0, 0));
  } else if (type === 'cannonT') {
    parts.push(P(rbox(1.8, 1.3, 2.0, 0.3), C.metal, 0, 0.65, 0));
    parts.push(P(cyl(0.25, 0.3, 3.2, 10), DARK, 0, 0.7, 2.0, Math.PI / 2, 0, 0));
  } else {
    parts.push(P(sph(0.9, 10, 8), 0xffffff, 0, 0.8, 0));
    parts.push(P(cyl(0.15, 0.22, 2.2, 8), C.metal, 0, 0.8, 1.4, Math.PI / 2, 0, 0));
    parts.push(P(new THREE.OctahedronGeometry(0.4), C.purple, 0, 0.8, 2.6));
  }
  const g = mergeColored(parts);
  headCache.set(type, g);
  return g;
}

// ---- Hub landmark pieces ----
export function hubParts() {
  const parts = [];
  // central water tower
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(P(cyl(0.4, 0.5, 18, 6), RUST, sx * 4, 9, sz * 4, sz * 0.08, 0, -sx * 0.08));
  parts.push(P(cyl(7, 7, 7, 16), 0x5fb3d9, 0, 21, 0));
  parts.push(P(cone(7.6, 4, 16), 0xe76f51, 0, 26.5, 0));
  parts.push(P(box(9, 2.2, 0.3), 0xfff3b0, 0, 21, 7.05));
  parts.push(P(cyl(3, 3.4, 1.2, 12), CONCRETE, 0, 0.6, 0));
  return parts;
}
