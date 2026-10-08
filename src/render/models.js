// Procedural low-poly cartoon models: cars, weapons, props.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeColored, M, toonMat, outlineGeometry, outlineMat } from './toon.js';
import { CHASSIS } from '../vehicle/parts.js';

export const C = {
  metal: 0xb8c0c8, dark: 0x3a3a44, glass: 0x7fd3ef, light: 0xfff3b0, tail: 0xff4d4d, tire: 0x2e2a2a, rust: 0xb5651d,
  hub: 0xd0d4da, wood: 0x9c6b3e, white: 0xf6f3ec, black: 0x222222, chrome: 0xe9eef2, olive: 0x6b7a3a, red: 0xe63946,
  yellow: 0xffd166, green: 0x7bc950, blue: 0x3a86ff, purple: 0xb04dff, orange: 0xff8c42, sand: 0xe9c46a,
};

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rbox = (w, h, d, r = 0.15) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const tor = (r, t, rs = 6, ts = 12) => new THREE.TorusGeometry(r, t, rs, ts);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const dod = (r) => new THREE.DodecahedronGeometry(r, 0);
const oct = (r) => new THREE.OctahedronGeometry(r, 0);

function P(geo, color, ...m) { return { geo, color, matrix: M(...m) }; }

// ---------- Cars ----------
function bodyParts(design, ch, stats) {
  const p = design.paint || '#ff7f50';
  const p2 = design.paint2 || '#ffd166';
  const L = ch.len, W = ch.wid, H = ch.hei;
  const parts = [];
  const type = design.chassis;
  const lightsZ = L / 2 - 0.05;
  const addLights = (y, spread = W * 0.32, r = 0.16) => {
    parts.push(P(sph(r, 8, 6), C.light, spread, y, lightsZ, 0, 0, 0, 1, 1, 0.6));
    parts.push(P(sph(r, 8, 6), C.light, -spread, y, lightsZ, 0, 0, 0, 1, 1, 0.6));
    parts.push(P(box(r * 1.6, r * 0.9, 0.1), C.tail, spread, y, -L / 2 + 0.02));
    parts.push(P(box(r * 1.6, r * 0.9, 0.1), C.tail, -spread, y, -L / 2 + 0.02));
  };
  if (type === 'buggy') {
    parts.push(P(rbox(W * 0.78, 0.55, L * 0.92, 0.2), p, 0, 0.25, 0));
    parts.push(P(rbox(W * 0.6, 0.3, L * 0.35, 0.12), p2, 0, 0.6, L * 0.24)); // hood
    parts.push(P(rbox(0.5, 0.45, 0.5, 0.1), C.dark, 0, 0.75, -0.3)); // seat
    // roll cage
    const cageY = 1.05;
    for (const sx of [-1, 1]) {
      parts.push(P(cyl(0.06, 0.06, 1.1, 6), C.dark, sx * W * 0.32, cageY, 0.25, 0.5, 0, 0));
      parts.push(P(cyl(0.06, 0.06, 1.0, 6), C.dark, sx * W * 0.32, cageY, -0.6, -0.25, 0, 0));
    }
    parts.push(P(cyl(0.06, 0.06, W * 0.66, 6), C.dark, 0, 1.45, -0.15, 0, 0, Math.PI / 2));
    parts.push(P(cyl(0.06, 0.06, 0.9, 6), C.dark, W * 0.32, 1.45, -0.15, Math.PI / 2, 0, 0));
    parts.push(P(cyl(0.06, 0.06, 0.9, 6), C.dark, -W * 0.32, 1.45, -0.15, Math.PI / 2, 0, 0));
    parts.push(P(cyl(0.1, 0.12, 0.5, 8), C.chrome, W * 0.25, 0.45, -L / 2 - 0.1, Math.PI / 2, 0, 0));
    addLights(0.45, W * 0.25, 0.14);
  } else if (type === 'coupe') {
    parts.push(P(rbox(W * 0.95, 0.7, L, 0.25), p, 0, 0.3, 0));
    parts.push(P(rbox(W * 0.78, 0.55, L * 0.42, 0.22), p, 0, 0.88, -0.35));
    parts.push(P(rbox(W * 0.8, 0.42, L * 0.36, 0.15), C.glass, 0, 0.88, -0.35, 0, 0, 0, 1.02, 0.85, 1.02));
    parts.push(P(box(0.35, 0.05, L * 0.98), p2, 0.3, 0.67, 0)); // racing stripes
    parts.push(P(box(0.35, 0.05, L * 0.98), p2, -0.3, 0.67, 0));
    parts.push(P(box(W * 0.9, 0.08, 0.35), p2, 0, 1.05, -L / 2 + 0.2)); // spoiler
    parts.push(P(box(0.08, 0.35, 0.2), C.dark, 0.6, 0.85, -L / 2 + 0.2));
    parts.push(P(box(0.08, 0.35, 0.2), C.dark, -0.6, 0.85, -L / 2 + 0.2));
    parts.push(P(box(0.6, 0.25, 0.7), C.chrome, 0, 0.75, L * 0.25)); // blower
    for (const sx of [-1, 1]) parts.push(P(cyl(0.09, 0.11, 0.6, 8), C.chrome, sx * W * 0.3, 0.2, -L / 2 - 0.15, Math.PI / 2, 0, 0));
    addLights(0.35);
  } else if (type === 'pickup') {
    parts.push(P(rbox(W * 0.95, 0.8, L, 0.2), p, 0, 0.4, 0));
    parts.push(P(rbox(W * 0.9, 0.85, L * 0.34, 0.2), p, 0, 1.15, L * 0.12));
    parts.push(P(rbox(W * 0.92, 0.5, L * 0.3, 0.12), C.glass, 0, 1.2, L * 0.12, 0, 0, 0, 1.0, 1.0, 1.04));
    parts.push(P(box(W * 0.85, 0.15, L * 0.42), C.wood, 0, 0.85, -L * 0.25)); // bed floor
    parts.push(P(box(0.12, 0.45, L * 0.42), p2, W * 0.45, 1.0, -L * 0.25));
    parts.push(P(box(0.12, 0.45, L * 0.42), p2, -W * 0.45, 1.0, -L * 0.25));
    parts.push(P(box(W * 0.95, 0.3, 0.3), C.chrome, 0, 0.3, L / 2)); // bumper
    parts.push(P(cyl(0.1, 0.1, 1.2, 8), C.chrome, W * 0.42, 1.6, L * -0.02));
    addLights(0.65);
  } else if (type === 'van') {
    parts.push(P(rbox(W * 0.96, H * 0.95, L, 0.35), p, 0, H * 0.45, -0.05));
    parts.push(P(rbox(W * 0.98, 0.55, L * 0.25, 0.2), C.glass, 0, H * 0.62, L * 0.36));
    parts.push(P(box(W * 1.0, 0.35, L * 0.7), p2, 0, H * 0.4, -L * 0.12)); // side stripe
    parts.push(P(box(0.15, 0.6, 0.9), C.glass, W * 0.49, H * 0.65, -0.3));
    parts.push(P(box(0.15, 0.6, 0.9), C.glass, -W * 0.49, H * 0.65, -0.3));
    parts.push(P(box(W * 0.95, 0.3, 0.3), C.chrome, 0, 0.15, L / 2));
    addLights(0.5);
  } else if (type === 'truck') {
    const cabZ = L * 0.33;
    parts.push(P(box(W * 0.9, 0.5, L), C.dark, 0, 0.35, 0)); // frame
    parts.push(P(rbox(W * 0.95, H * 0.72, L * 0.3, 0.3), p, 0, H * 0.58, cabZ));
    parts.push(P(rbox(W * 0.97, 0.7, L * 0.12, 0.15), C.glass, 0, H * 0.75, cabZ + L * 0.1));
    parts.push(P(rbox(W * 0.9, 0.8, L * 0.12, 0.2), p, 0, H * 0.32, L * 0.47)); // nose
    parts.push(P(box(W * 0.6, 0.5, 0.1), C.chrome, 0, H * 0.32, L * 0.53)); // grille
    parts.push(P(box(W * 0.98, H * 0.48, L * 0.58), p2, 0, H * 0.55, -L * 0.18)); // container
    parts.push(P(box(W * 1.0, 0.18, L * 0.6), p, 0, H * 0.8, -L * 0.18));
    for (const sx of [-1, 1]) parts.push(P(cyl(0.15, 0.15, H * 0.9, 8), C.chrome, sx * W * 0.5, H * 0.75, cabZ - L * 0.13));
    addLights(H * 0.32, W * 0.36, 0.22);
  } else if (type === 'rig' || type === 'ark') {
    const big = type === 'ark';
    parts.push(P(box(W * 0.92, 0.9, L), C.dark, 0, 0.5, 0));
    parts.push(P(rbox(W, H * 0.55, L * 0.95, 0.4), p, 0, H * 0.45, 0));
    parts.push(P(rbox(W * 0.8, H * 0.35, L * 0.25, 0.35), p, 0, H * 0.85, L * 0.32));
    parts.push(P(rbox(W * 0.82, H * 0.18, L * 0.08, 0.1), C.glass, 0, H * 0.9, L * 0.43));
    parts.push(P(box(W * 1.02, 0.4, L * 0.9), p2, 0, H * 0.55, 0));
    parts.push(P(box(W * 1.05, 0.9, 0.5), C.metal, 0, 0.7, L / 2 + 0.1)); // cow catcher
    for (let i = 0; i < (big ? 5 : 3); i++) parts.push(P(box(0.5, 0.4, 0.4), C.yellow, (i - (big ? 2 : 1)) * 0.9, 1.1, L / 2 + 0.3));
    // windows of bunks
    for (let i = 0; i < (big ? 6 : 4); i++) for (const sx of [-1, 1]) parts.push(P(box(0.08, 0.5, 0.7), C.light, sx * W * 0.5, H * 0.52, -L * 0.35 + i * (big ? 1.5 : 1.3)));
    for (const sx of [-1, 1]) parts.push(P(cyl(0.22, 0.22, H * 0.7, 8), C.chrome, sx * W * 0.42, H * 1.05, L * 0.15));
    if (big) {
      parts.push(P(rbox(W * 0.6, H * 0.3, L * 0.3, 0.3), p2, 0, H * 1.0, -L * 0.15)); // chapel / townhouse
      parts.push(P(cone(W * 0.38, 1.6, 4), C.red, 0, H * 1.0 + 1.6, -L * 0.15, 0, Math.PI / 4, 0));
      parts.push(P(cyl(0.06, 0.06, 4, 6), C.dark, 0, H * 1.0 + 3, -L * 0.4));
      parts.push(P(box(1.4, 0.8, 0.05), p, 0.7, H * 1.0 + 4.4, -L * 0.4));
    }
    addLights(H * 0.4, W * 0.38, 0.32);
  }

  // Armour plates
  const ar = design.armor;
  if (ar && ar !== 'none') {
    const thick = { light: 0.08, medium: 0.14, heavy: 0.22, reactive: 0.12 }[ar] || 0.1;
    const col = ar === 'reactive' ? 0xc792ff : ar === 'heavy' ? 0x6c7a89 : 0x8d99ae;
    const n = ar === 'light' ? 2 : 3;
    for (let i = 0; i < n; i++) for (const sx of [-1, 1]) {
      const z = (i - (n - 1) / 2) * (L / (n + 0.6));
      parts.push(P(box(thick, H * 0.38, L / (n + 1.2)), col, sx * (W * 0.49 + thick / 2), H * 0.32, z));
      // rivets
      parts.push(P(sph(0.06, 5, 4), C.chrome, sx * (W * 0.5 + thick), H * 0.42, z + L / (n + 1.2) * 0.35));
      parts.push(P(sph(0.06, 5, 4), C.chrome, sx * (W * 0.5 + thick), H * 0.42, z - L / (n + 1.2) * 0.35));
    }
  }
  // Tracks render as tread blocks
  if (design.wheels === 'tracks') {
    for (const sx of [-1, 1]) {
      parts.push(P(rbox(ch.wheelW * 1.3, ch.wheelR * 1.7, L * 0.95, ch.wheelR * 0.8), C.tire, sx * (W / 2 + ch.wheelW * 0.15), -0.15 - 0.3 * ch.wheelR, 0));
      for (let i = 0; i < 7; i++) parts.push(P(box(ch.wheelW * 1.35, 0.12, 0.25), C.dark, sx * (W / 2 + ch.wheelW * 0.15), -0.15 + 0.55 * ch.wheelR, -L * 0.42 + i * L * 0.14));
    }
  }
  if (design.wheels === 'hover') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(P(cyl(ch.wheelR * 0.9, ch.wheelR * 1.0, 0.3, 12), C.dark, sx * W * 0.45, -0.25, sz * L * 0.33));
      parts.push(P(cyl(ch.wheelR * 0.75, ch.wheelR * 0.75, 0.1, 12), 0x7cff4f, sx * W * 0.45, -0.42, sz * L * 0.33));
    }
  }
  // Utilities
  const utils = (design.utils || []).filter(Boolean);
  const roofY = type === 'buggy' ? 1.5 : type === 'coupe' ? 1.16 : type === 'pickup' ? 1.58 : type === 'van' ? H * 0.93 : H * 0.83;
  let roofUsed = 0;
  for (const u of utils) {
    if (u === 'solar') {
      const sw = Math.min(W * 0.9, 1.8 * Math.sqrt(stats.size)), sd = Math.min(L * 0.4, 1.6 * stats.size);
      parts.push(P(box(sw, 0.06, sd), 0x1d3557, 0, roofY + 0.12 + roofUsed * 0.02, -L * 0.08 - roofUsed * sd * 0.6));
      parts.push(P(box(sw * 0.96, 0.07, 0.04), C.chrome, 0, roofY + 0.13, -L * 0.08 - roofUsed * sd * 0.6));
      roofUsed++;
    } else if (u === 'fuelTank') {
      for (const sx of [-1, 1]) parts.push(P(rbox(0.3, 0.5, 0.4, 0.06), C.red, sx * (W * 0.5 + 0.15), H * 0.4, -L * 0.3));
    } else if (u === 'ammoBox') {
      parts.push(P(box(0.7, 0.4, 0.5), C.olive, W * 0.2, roofY * 0.75, -L * 0.42));
    } else if (u === 'cargoRack') {
      parts.push(P(box(W * 0.8, 0.08, L * 0.35), C.dark, 0, roofY + 0.15, 0));
      parts.push(P(box(0.6, 0.5, 0.6), C.wood, 0.3, roofY + 0.45, 0.1));
      parts.push(P(box(0.5, 0.4, 0.5), C.wood, -0.3, roofY + 0.4, -0.2));
    } else if (u === 'nitro') {
      for (const sx of [-1, 1]) parts.push(P(cyl(0.13, 0.13, 0.8, 8), C.blue, sx * 0.25, H * 0.55, -L * 0.45, Math.PI / 2, 0, 0));
    } else if (u === 'ram') {
      parts.push(P(box(W * 1.05, H * 0.5, 0.25), C.metal, 0, 0.3, L / 2 + 0.2, -0.3, 0, 0));
      for (let i = -2; i <= 2; i++) parts.push(P(cone(0.12, 0.45, 5), C.chrome, i * W * 0.2, 0.3, L / 2 + 0.45, Math.PI / 2, 0, 0));
    } else if (u === 'plow') {
      parts.push(P(box(W * 1.3, H * 0.55, 0.2), C.yellow, 0, 0.15, L / 2 + 0.55, -0.45, 0, 0));
    } else if (u === 'spikes') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(P(cone(0.14, 0.7, 5), C.chrome, sx * (W / 2 + ch.wheelW + 0.2), 0, sz * L * 0.36, 0, 0, -sx * Math.PI / 2));
    } else if (u === 'magnet') {
      parts.push(P(tor(0.35, 0.12, 6, 10), C.red, 0, roofY + 0.5, L * 0.15, 0, 0, 0, 1, 1, 1));
    } else if (u === 'radar') {
      parts.push(P(cyl(0.05, 0.05, 0.8, 6), C.dark, -W * 0.3, roofY + 0.4, -L * 0.3));
      parts.push(P(sph(0.4, 8, 4), C.white, -W * 0.3, roofY + 0.85, -L * 0.3, 0.6, 0, 0, 1, 0.4, 1));
    } else if (u === 'battery') {
      parts.push(P(box(0.6, 0.35, 0.5), C.yellow, -W * 0.2, roofY * 0.75, -L * 0.42));
    } else if (u === 'jumpjets') {
      for (const sx of [-1, 1]) {
        parts.push(P(cyl(0.2, 0.28, 0.7, 8), C.dark, sx * W * 0.42, H * 0.5, -L * 0.42));
        parts.push(P(cyl(0.16, 0.16, 0.06, 8), C.orange, sx * W * 0.42, H * 0.14, -L * 0.42));
      }
    } else if (u === 'repair') {
      parts.push(P(sph(0.22, 8, 6), C.white, W * 0.35, roofY + 0.7, -L * 0.1));
      parts.push(P(box(0.6, 0.04, 0.12), C.dark, W * 0.35, roofY + 0.82, -L * 0.1));
    } else if (u === 'shield') {
      parts.push(P(cyl(0.18, 0.25, 0.4, 8), 0x9be7ff, -W * 0.35, roofY + 0.25, L * 0.05));
      parts.push(P(sph(0.16, 8, 6), 0x9be7ff, -W * 0.35, roofY + 0.55, L * 0.05));
    }
  }
  // Bunk flag for mobile bases
  if (CHASSIS[type]?.bunk) {
    parts.push(P(cyl(0.05, 0.05, 2.5, 6), C.dark, W * 0.4, H * 1.15, -L * 0.45));
    parts.push(P(box(1.0, 0.6, 0.04), p2, W * 0.4 + 0.5, H * 1.15 + 1.0, -L * 0.45));
  }
  return parts;
}

const carGeoCache = new Map();
export function carGeometry(design, stats) {
  const key = JSON.stringify([design.chassis, design.paint, design.paint2, design.armor, design.wheels, design.utils]);
  if (carGeoCache.has(key)) return carGeoCache.get(key);
  const ch = CHASSIS[design.chassis] || CHASSIS.buggy;
  const geo = mergeColored(bodyParts(design, ch, stats));
  carGeoCache.set(key, geo);
  return geo;
}

// Turret / weapon models, built around their own pivot. Barrel points +z.
const weaponGeoCache = new Map();
export function weaponGeometry(wid, scale = 1) {
  const key = wid + scale;
  if (weaponGeoCache.has(key)) return weaponGeoCache.get(key);
  const s = scale;
  const parts = [];
  const base = () => parts.push(P(cyl(0.38 * s, 0.45 * s, 0.25 * s, 10), C.dark, 0, 0.1 * s, 0));
  switch (wid) {
    case 'mg':
      base();
      parts.push(P(rbox(0.5 * s, 0.35 * s, 0.6 * s, 0.08 * s), C.olive, 0, 0.35 * s, 0));
      for (const sx of [-1, 1]) parts.push(P(cyl(0.06 * s, 0.06 * s, 1.0 * s, 6), C.dark, sx * 0.12 * s, 0.38 * s, 0.7 * s, Math.PI / 2, 0, 0));
      break;
    case 'scatter':
      base();
      parts.push(P(rbox(0.5 * s, 0.4 * s, 0.6 * s, 0.1 * s), C.wood, 0, 0.35 * s, -0.05 * s));
      parts.push(P(cyl(0.17 * s, 0.13 * s, 0.9 * s, 8), C.dark, 0, 0.4 * s, 0.6 * s, Math.PI / 2, 0, 0));
      break;
    case 'cannon':
      base();
      parts.push(P(rbox(0.8 * s, 0.55 * s, 0.9 * s, 0.15 * s), C.metal, 0, 0.45 * s, 0));
      parts.push(P(cyl(0.14 * s, 0.16 * s, 1.8 * s, 10), C.dark, 0, 0.5 * s, 1.2 * s, Math.PI / 2, 0, 0));
      parts.push(P(cyl(0.22 * s, 0.22 * s, 0.3 * s, 10), C.dark, 0, 0.5 * s, 2.1 * s, Math.PI / 2, 0, 0));
      break;
    case 'rockets':
      base();
      parts.push(P(rbox(0.8 * s, 0.6 * s, 0.9 * s, 0.12 * s), C.red, 0, 0.5 * s, 0.1 * s));
      for (let i = 0; i < 4; i++) parts.push(P(cyl(0.11 * s, 0.11 * s, 0.1 * s, 8), C.white, ((i % 2) - 0.5) * 0.36 * s, (0.38 + Math.floor(i / 2) * 0.25) * s, 0.56 * s, Math.PI / 2, 0, 0));
      break;
    case 'flamer':
      base();
      parts.push(P(cyl(0.22 * s, 0.22 * s, 0.7 * s, 10), C.orange, 0, 0.45 * s, -0.1 * s, Math.PI / 2, 0, 0));
      parts.push(P(cyl(0.08 * s, 0.14 * s, 0.9 * s, 8), C.dark, 0, 0.45 * s, 0.65 * s, Math.PI / 2, 0, 0));
      break;
    case 'laser':
      base();
      parts.push(P(rbox(0.5 * s, 0.4 * s, 0.7 * s, 0.12 * s), C.white, 0, 0.4 * s, 0));
      parts.push(P(cyl(0.09 * s, 0.12 * s, 1.1 * s, 8), C.metal, 0, 0.42 * s, 0.75 * s, Math.PI / 2, 0, 0));
      parts.push(P(oct(0.18 * s), C.purple, 0, 0.42 * s, 1.35 * s));
      break;
    case 'tesla':
      base();
      for (let i = 0; i < 3; i++) parts.push(P(tor(0.25 * s, 0.07 * s, 6, 12), 0x7fd1ff, 0, (0.4 + i * 0.25) * s, 0, Math.PI / 2, 0, 0));
      parts.push(P(cyl(0.08 * s, 0.08 * s, 0.9 * s, 6), C.metal, 0, 0.7 * s, 0));
      parts.push(P(sph(0.22 * s), 0xbde9ff, 0, 1.25 * s, 0));
      break;
    case 'mines':
      parts.push(P(rbox(0.8 * s, 0.4 * s, 0.5 * s, 0.08 * s), C.olive, 0, 0.2 * s, 0));
      parts.push(P(box(0.5 * s, 0.1 * s, 0.1 * s), C.yellow, 0, 0.25 * s, -0.26 * s));
      break;
    case 'oil':
      parts.push(P(cyl(0.3 * s, 0.3 * s, 0.7 * s, 10), C.black, 0, 0.35 * s, 0, 0, 0, Math.PI / 2));
      break;
    default:
      base();
  }
  const g = mergeColored(parts);
  weaponGeoCache.set(key, g);
  return g;
}

// Unit wheel: radius 1, width 1, axis along x
let _wheelGeo = null;
export function wheelGeometry() {
  if (_wheelGeo) return _wheelGeo;
  const parts = [
    P(cyl(1, 1, 1, 14), C.tire, 0, 0, 0, 0, 0, Math.PI / 2),
    P(cyl(0.55, 0.55, 1.04, 10), C.hub, 0, 0, 0, 0, 0, Math.PI / 2),
    P(cyl(0.22, 0.22, 1.12, 6), C.dark, 0, 0, 0, 0, 0, Math.PI / 2),
  ];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(P(box(1.06, 0.22, 0.3), C.tire, 0, Math.cos(a) * 0.98, Math.sin(a) * 0.98, a, 0, 0));
  }
  _wheelGeo = mergeColored(parts);
  return _wheelGeo;
}

// ---------- Props ----------
const propGeoCache = new Map();
export function propGeometry(type) {
  if (propGeoCache.has(type)) return propGeoCache.get(type);
  const parts = [];
  switch (type) {
    case 'cactus':
      parts.push(P(cyl(0.45, 0.5, 4, 8), 0x5aa83c, 0, 2, 0));
      parts.push(P(sph(0.45, 8, 6), 0x5aa83c, 0, 4, 0));
      parts.push(P(cyl(0.3, 0.3, 1.0, 8), 0x5aa83c, 0.65, 2.1, 0, 0, 0, Math.PI / 2));
      parts.push(P(cyl(0.3, 0.3, 1.3, 8), 0x5aa83c, 1.1, 2.7, 0));
      parts.push(P(sph(0.3, 8, 6), 0x5aa83c, 1.1, 3.35, 0));
      parts.push(P(cyl(0.26, 0.26, 0.8, 8), 0x5aa83c, -0.55, 1.6, 0, 0, 0, Math.PI / 2));
      parts.push(P(cyl(0.26, 0.26, 0.9, 8), 0x5aa83c, -0.9, 2.0, 0));
      parts.push(P(sph(0.26, 8, 6), 0x5aa83c, -0.9, 2.45, 0));
      parts.push(P(sph(0.2, 6, 4), 0xff7eb6, 0, 4.4, 0));
      break;
    case 'rock':
      parts.push(P(dod(1.1), 0xa08b74, 0, 0.5, 0, 0.3, 0.5, 0, 1, 0.7, 1));
      break;
    case 'boulder':
      parts.push(P(ico(2.6, 0), 0xb36a4a, 0, 1.4, 0, 0.2, 0.3, 0.1, 1, 0.8, 1));
      parts.push(P(ico(1.2, 0), 0xc47a58, 2.0, 0.6, 1.0));
      break;
    case 'wreck':
      parts.push(P(rbox(2.0, 0.9, 4.0, 0.2), C.rust, 0, 0.35, 0, 0.15, 0, 0.1));
      parts.push(P(rbox(1.7, 0.7, 1.8, 0.2), 0x9e5a2b, 0, 1.0, -0.4, 0.15, 0, 0.1));
      parts.push(P(rbox(1.6, 0.5, 1.5, 0.15), 0x55606e, 0, 1.05, -0.4, 0.15, 0, 0.1, 1.02, 0.7, 1.02));
      parts.push(P(cyl(0.5, 0.5, 0.35, 10), C.tire, 1.1, 0.2, 1.2, 0, 0, Math.PI / 2));
      break;
    case 'bones':
      for (let i = 0; i < 5; i++) parts.push(P(tor(1.2, 0.09, 4, 8), C.white, 0, 0.2, i * 0.45 - 1, 0, 0, 0, 1, 1, 1));
      parts.push(P(cyl(0.12, 0.12, 2.6, 6), C.white, 0, 0.15, 0, Math.PI / 2, 0, 0));
      break;
    case 'skull':
      parts.push(P(sph(1.3, 10, 8), C.white, 0, 1.3, 0, 0, 0, 0, 1, 0.9, 1.2));
      parts.push(P(sph(0.35, 8, 6), C.black, 0.45, 1.5, 1.2));
      parts.push(P(sph(0.35, 8, 6), C.black, -0.45, 1.5, 1.2));
      parts.push(P(cone(0.35, 2.2, 6), C.white, 1.4, 2.4, 0, 0, 0, -0.9));
      parts.push(P(cone(0.35, 2.2, 6), C.white, -1.4, 2.4, 0, 0, 0, 0.9));
      break;
    case 'palm':
      for (let i = 0; i < 6; i++) parts.push(P(cyl(0.32 - i * 0.02, 0.36 - i * 0.02, 1.4, 7), i % 2 ? 0xa47148 : 0x8b5e3c, i * i * 0.04, 0.7 + i * 1.3, 0, 0, 0, -i * 0.04));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(P(cone(0.7, 3.6, 4), i % 2 ? 0x5fbf4a : 0x4aa83c, 1.0 + Math.cos(a) * 1.4, 8.3, Math.sin(a) * 1.4, Math.sin(a) * 1.9, 0, -Math.cos(a) * 1.9, 1, 1, 0.35));
      }
      parts.push(P(sph(0.3, 6, 5), 0x6b4423, 1.2, 7.9, 0.3));
      parts.push(P(sph(0.3, 6, 5), 0x6b4423, 0.9, 7.9, -0.3));
      break;
    case 'bush':
      parts.push(P(ico(1.0, 1), 0x6dbb4c, 0, 0.6, 0));
      parts.push(P(ico(0.75, 1), 0x7fd35a, 0.8, 0.5, 0.3));
      parts.push(P(ico(0.6, 1), 0x5aa83c, -0.6, 0.4, -0.4));
      break;
    case 'flower':
      parts.push(P(cyl(0.04, 0.04, 0.5, 4), 0x4aa83c, 0, 0.25, 0));
      parts.push(P(sph(0.18, 6, 4), 0xff8fab, 0, 0.55, 0));
      parts.push(P(sph(0.15, 6, 4), 0xffd166, 0.35, 0.45, 0.2));
      parts.push(P(cyl(0.04, 0.04, 0.4, 4), 0x4aa83c, 0.35, 0.2, 0.2));
      break;
    case 'pillar': {
      const cols = [0xc65d3b, 0xd9734e, 0xe8a26b];
      for (let i = 0; i < 5; i++) parts.push(P(cyl(3.2 - i * 0.3, 3.5 - i * 0.3, 3.4, 9), cols[i % 3], 0, 1.7 + i * 3.2, 0, 0, i * 0.4, 0));
      parts.push(P(cyl(4.5, 3.0, 2.0, 9), 0xe6be86, 0, 17.0, 0));
      break;
    }
    case 'deadtree':
      parts.push(P(cyl(0.25, 0.4, 4, 6), 0x6b4f3a, 0, 2, 0));
      parts.push(P(cyl(0.12, 0.18, 2.2, 5), 0x6b4f3a, 0.8, 3.8, 0, 0, 0, -0.8));
      parts.push(P(cyl(0.1, 0.15, 1.8, 5), 0x6b4f3a, -0.7, 3.4, 0.2, 0.2, 0, 0.9));
      parts.push(P(cyl(0.08, 0.1, 1.2, 5), 0x6b4f3a, 0.2, 4.5, -0.4, -0.6, 0, 0));
      break;
    case 'barrel':
      parts.push(P(cyl(0.45, 0.45, 1.2, 10), 0xe9c46a, 0, 0.6, 0));
      parts.push(P(cyl(0.47, 0.47, 0.15, 10), C.dark, 0, 0.35, 0));
      parts.push(P(cyl(0.47, 0.47, 0.15, 10), C.dark, 0, 0.85, 0));
      parts.push(P(cyl(0.3, 0.3, 0.05, 6), 0x7cff4f, 0, 1.22, 0));
      break;
    case 'pumpjack':
      parts.push(P(box(2.4, 0.4, 5.0), C.dark, 0, 0.2, 0));
      parts.push(P(cyl(0.15, 0.15, 4.2, 6), C.yellow, 0.6, 2.2, 0, 0, 0, 0.18));
      parts.push(P(cyl(0.15, 0.15, 4.2, 6), C.yellow, -0.6, 2.2, 0, 0, 0, -0.18));
      parts.push(P(box(0.5, 0.5, 6.0), C.yellow, 0, 4.4, 0, 0.12, 0, 0));
      parts.push(P(rbox(0.7, 1.6, 1.0, 0.2), C.red, 0, 4.0, 3.0, 0.12, 0, 0));
      parts.push(P(box(1.0, 1.0, 1.0), C.dark, 0, 1.0, -2.0));
      parts.push(P(cyl(0.12, 0.12, 3.5, 6), C.metal, 0, 1.8, 3.2));
      break;
    case 'derrick':
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(P(cyl(0.15, 0.15, 16.5, 5), 0xc0c0c0, sx * 1.4, 8, sz * 1.4, sz * 0.17, 0, -sx * 0.17));
      for (let i = 1; i < 5; i++) parts.push(P(box(3.6 - i * 0.65, 0.15, 0.15), C.red, 0, i * 3.2, 1.6 - i * 0.28));
      parts.push(P(box(1.2, 0.8, 1.2), C.red, 0, 16.2, 0));
      break;
    case 'mushroom':
      parts.push(P(cyl(0.45, 0.6, 4.5, 8), 0xf1e3c8, 0, 2.25, 0));
      parts.push(P(sph(2.2, 12, 8), 0xb04dff, 0, 4.5, 0, 0, 0, 0, 1, 0.55, 1));
      parts.push(P(sph(0.35, 6, 4), 0x7cff4f, 1.2, 5.3, 0.5));
      parts.push(P(sph(0.3, 6, 4), 0x7cff4f, -0.9, 5.4, -0.8));
      parts.push(P(sph(0.25, 6, 4), 0x7cff4f, 0.1, 5.7, 1.1));
      break;
    case 'tower':
      parts.push(P(box(12, 22, 12), 0x9a9286, 0, 11, 0));
      parts.push(P(box(9, 8, 9), 0x8a8276, -1.2, 25, 1.0, 0.05, 0, 0.08));
      for (let i = 0; i < 6; i++) parts.push(P(box(12.2, 0.9, 12.2), 0x4a5a6a, 0, 3 + i * 3.4, 0));
      parts.push(P(box(3, 4, 0.3), C.red, 3, 17, 6.2));
      break;
    case 'building':
      parts.push(P(box(13, 9, 11), 0xb3a58f, 0, 4.5, 0));
      parts.push(P(box(7, 4, 6), 0xa39580, 2.5, 11, 1.5, 0, 0, 0.1));
      for (let i = 0; i < 2; i++) parts.push(P(box(13.2, 1.0, 11.2), 0x4a5a6a, 0, 2.6 + i * 3.6, 0));
      parts.push(P(box(4, 1.2, 0.2), C.yellow, -2, 7.5, 5.6));
      break;
    case 'lamp':
      parts.push(P(cyl(0.12, 0.15, 6, 6), C.dark, 0, 3, 0));
      parts.push(P(box(0.15, 0.15, 1.6), C.dark, 0, 6, 0.7, 0.3, 0, 0));
      parts.push(P(box(0.5, 0.25, 0.7), C.light, 0, 5.9, 1.4));
      break;
    case 'billboard':
      parts.push(P(cyl(0.15, 0.15, 6, 6), C.dark, -2, 3, 0));
      parts.push(P(cyl(0.15, 0.15, 6, 6), C.dark, 2, 3, 0));
      parts.push(P(box(6, 3, 0.25), 0xffd166, 0, 6.5, 0));
      parts.push(P(box(4, 1.2, 0.3), C.red, 0, 6.9, 0));
      parts.push(P(sph(0.6, 8, 6), C.blue, 1.8, 6.1, 0.1));
      break;
    case 'spike':
      parts.push(P(cone(1.6, 7, 6), 0x2f2b2b, 0, 3.5, 0));
      parts.push(P(cone(0.5, 1.4, 6), 0xff6a3d, 0, 6.6, 0));
      parts.push(P(cone(0.9, 3.5, 5), 0x3a3434, 1.4, 1.6, 0.4, 0, 0, -0.3));
      break;
    case 'vent':
      parts.push(P(cyl(1.0, 1.4, 1.6, 8), 0x3a3434, 0, 0.8, 0));
      parts.push(P(cyl(0.7, 0.7, 0.1, 8), 0xff7a45, 0, 1.62, 0));
      break;
    case 'crystalBig':
      parts.push(P(oct(1.0), 0xc792ff, 0, 4, 0, 0, 0, 0, 1, 4, 1));
      parts.push(P(oct(0.8), 0xe0b0ff, 1.2, 2.5, 0.3, 0, 0, -0.4, 1, 3, 1));
      parts.push(P(oct(0.7), 0xa070ff, -1.0, 2.2, -0.4, 0.2, 0, 0.5, 1, 3, 1));
      parts.push(P(oct(0.5), 0xff8fe0, 0.3, 1.5, 1.1, 0.5, 0, 0, 1, 2.5, 1));
      break;
    case 'crystalSmall':
      parts.push(P(oct(0.4), 0xc792ff, 0, 0.8, 0, 0, 0, 0, 1, 2.5, 1));
      parts.push(P(oct(0.3), 0xff8fe0, 0.5, 0.5, 0.2, 0, 0, -0.5, 1, 2, 1));
      break;
    case 'shard':
      parts.push(P(cone(1.1, 4.5, 4), 0x9ff0d8, 0, 2.2, 0, 0.2, 0.3, 0.15));
      parts.push(P(cone(0.6, 2.5, 4), 0x6cd8bb, 1.0, 1.2, 0.5, -0.3, 0, -0.4));
      break;
    case 'sign':
      parts.push(P(cyl(0.08, 0.08, 3, 5), C.wood, 0, 1.5, 0));
      parts.push(P(box(1.6, 0.6, 0.08), C.white, 0.3, 2.6, 0, 0, 0, 0.1));
      parts.push(P(box(1.3, 0.2, 0.1), C.red, 0.3, 2.6, 0.01, 0, 0, 0.1));
      break;
    case 'saltcrystal':
      parts.push(P(box(0.7, 0.7, 0.7), C.white, 0, 0.3, 0, 0.5, 0.6, 0.2));
      parts.push(P(box(0.5, 0.5, 0.5), 0xf2d9dc, 0.6, 0.2, 0.3, 0.2, 0.3, 0.8));
      break;
    case 'tire':
      parts.push(P(tor(0.6, 0.28, 6, 12), C.tire, 0, 0.3, 0, Math.PI / 2, 0, 0));
      break;
    case 'pipe':
      parts.push(P(cyl(0.6, 0.6, 8, 10), 0x8d99ae, 0, 0.9, 0, 0, 0, Math.PI / 2));
      parts.push(P(cyl(0.8, 0.8, 0.3, 10), C.rust, 2.5, 0.9, 0, 0, 0, Math.PI / 2));
      parts.push(P(cyl(0.8, 0.8, 0.3, 10), C.rust, -2.5, 0.9, 0, 0, 0, Math.PI / 2));
      break;
    // ---- resource nodes (pickups) ----
    case 'scrapPile':
      parts.push(P(box(1.2, 0.5, 0.8), C.metal, 0, 0.25, 0, 0.2, 0.3, 0.1));
      parts.push(P(cyl(0.3, 0.3, 0.9, 8), C.rust, 0.3, 0.7, 0.2, 0.6, 0, 0.8));
      parts.push(P(tor(0.35, 0.1, 6, 10), C.dark, -0.4, 0.6, 0, 1.2, 0, 0));
      parts.push(P(box(0.6, 0.3, 0.6), 0x9aa3ad, -0.2, 0.9, -0.2, 0.5, 0.4, 0));
      break;
    case 'oilBarrels':
      parts.push(P(cyl(0.4, 0.4, 1.1, 10), C.orange, 0, 0.55, 0));
      parts.push(P(cyl(0.4, 0.4, 1.1, 10), C.red, 0.85, 0.55, 0.2));
      parts.push(P(cyl(0.4, 0.4, 1.1, 10), C.orange, 0.4, 0.4, -0.75, Math.PI / 2, 0.4, 0));
      break;
    case 'ammoCrate':
      parts.push(P(box(1.2, 0.7, 0.8), C.olive, 0, 0.35, 0));
      parts.push(P(box(1.25, 0.12, 0.82), C.yellow, 0, 0.45, 0));
      break;
    case 'waterTank':
      parts.push(P(cyl(0.7, 0.7, 1.4, 12), 0x56c2f0, 0, 0.7, 0));
      parts.push(P(sph(0.7, 12, 6), 0x56c2f0, 0, 1.4, 0, 0, 0, 0, 1, 0.4, 1));
      parts.push(P(sph(0.25, 6, 4), C.white, 0.4, 1.0, 0.5));
      break;
    case 'foodCrate':
      parts.push(P(box(1.1, 0.8, 0.9), C.wood, 0, 0.4, 0));
      parts.push(P(cyl(0.2, 0.2, 0.35, 8), C.red, 0.2, 0.98, 0.1));
      parts.push(P(cyl(0.2, 0.2, 0.35, 8), 0xe07a5f, -0.25, 0.98, -0.1));
      break;
    case 'chemDrum':
      parts.push(P(cyl(0.45, 0.45, 1.2, 10), 0x9be15d, 0, 0.6, 0));
      parts.push(P(cyl(0.47, 0.47, 0.14, 10), C.dark, 0, 0.9, 0));
      parts.push(P(sph(0.16, 6, 4), C.black, 0, 0.6, 0.45));
      break;
    case 'circuitBox':
      parts.push(P(box(1.0, 0.6, 0.8), 0x2a9d8f, 0, 0.3, 0));
      parts.push(P(box(0.8, 0.05, 0.6), 0x7fd1ff, 0, 0.62, 0));
      parts.push(P(cyl(0.03, 0.03, 0.6, 4), C.dark, 0.3, 0.9, 0.2));
      break;
    case 'crystalNode':
      parts.push(P(oct(0.5), 0xc792ff, 0, 0.9, 0, 0, 0, 0, 1, 2, 1));
      parts.push(P(oct(0.35), 0xff8fe0, 0.45, 0.6, 0.2, 0, 0, -0.5, 1, 2, 1));
      parts.push(P(oct(0.3), 0xa070ff, -0.4, 0.5, -0.2, 0, 0, 0.5, 1, 2, 1));
      break;
    case 'lootCrate':
      parts.push(P(rbox(1.3, 1.0, 1.0, 0.1), 0xffd166, 0, 0.5, 0));
      parts.push(P(box(1.35, 0.15, 1.05), C.red, 0, 0.5, 0));
      parts.push(P(box(0.15, 1.05, 1.05), C.red, 0, 0.5, 0));
      break;
    default:
      parts.push(P(box(1, 1, 1), 0xff00ff, 0, 0.5, 0));
  }
  const g = mergeColored(parts);
  propGeoCache.set(type, g);
  return g;
}

export const vcMat = () => toonMat(0xffffff, { vertexColors: true });

// A group with mesh + outline for one-off objects
export function makeOutlinedMesh(geo, thickness = 0.05) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, vcMat());
  mesh.castShadow = true; mesh.receiveShadow = true;
  const ol = new THREE.Mesh(outlineGeometry(geo), outlineMat(thickness));
  g.add(mesh, ol);
  g.userData.mesh = mesh;
  return g;
}
