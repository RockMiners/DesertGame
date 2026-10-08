// Biome definitions: terrain shape, palette, surface handling and resources.
import { clamp, fract, smoothstep, lerp } from '../core/math.js';

export const RESOURCES = ['scrap', 'fuel', 'ammo', 'water', 'food', 'chems', 'electronics', 'crystal'];
export const RES_INFO = {
  scrap: { name: 'Scrap', icon: '⚙️', color: '#9aa3ad', base: 4 },
  fuel: { name: 'Petrol', icon: '⛽', color: '#f2a03d', base: 7 },
  ammo: { name: 'Ammo', icon: '🔸', color: '#e4c14a', base: 6 },
  water: { name: 'Water', icon: '💧', color: '#56c2f0', base: 5 },
  food: { name: 'Grub', icon: '🥫', color: '#e07a5f', base: 5 },
  chems: { name: 'Chems', icon: '🧪', color: '#9be15d', base: 9 },
  electronics: { name: 'Circuits', icon: '🔌', color: '#7fd1ff', base: 14 },
  crystal: { name: 'Crystal', icon: '💎', color: '#c792ff', base: 20 },
};

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function terrace(v, steps, sharp) {
  const t = v * steps;
  const f = Math.floor(t);
  const r = t - f;
  return (f + smoothstep(sharp, 1.0, r)) / steps;
}

// Surface: grip = tyre grip multiplier, soft = how much heavy vehicles bog down,
// liquid = what fills the low spots in this biome (with level in metres)
export const BIOMES = {
  hub: {
    name: 'The Hub', surface: 'packed', grip: 1.05, soft: 0.1, dust: 0xd9b382,
    sky: 0x9fd8f5, resources: {},
    desc: 'A walled trade town around the last clean well. No shooting inside the walls.',
  },
  dunes: {
    name: 'Dunes', surface: 'sand', grip: 0.86, soft: 1.0, dust: 0xf0c27b,
    resources: { scrap: 1.0, water: 0.15, ammo: 0.15 },
    desc: 'Endless golden ramps. Light cars fly; heavy rigs dig themselves in.',
  },
  saltflats: {
    name: 'Salt Flats', surface: 'salt', grip: 1.05, soft: 0.05, dust: 0xf5f0e6,
    resources: { chems: 1.0, scrap: 0.35 },
    desc: 'Flat, white and fast. Nowhere to hide, nothing to stop you.',
  },
  canyon: {
    name: 'Canyon', surface: 'rock', grip: 1.12, soft: 0.1, dust: 0xd9734e,
    resources: { scrap: 1.2, crystal: 0.25, ammo: 0.2 },
    desc: 'Mesas, cliffs and choke points. Defenders love it. Big rigs hate it.',
  },
  oilfield: {
    name: 'Oil Fields', surface: 'tar', grip: 0.92, soft: 0.4, dust: 0x6b5440,
    liquid: { type: 'tar', level: 1.2 },
    resources: { fuel: 1.6, chems: 0.3 },
    desc: 'Black gold. Whoever holds the pumps sets the price of everything.',
  },
  toxic: {
    name: 'Toxic Bog', surface: 'mud', grip: 0.74, soft: 0.8, dust: 0x8fa34a,
    liquid: { type: 'toxic', level: 0.6 },
    resources: { chems: 1.3, crystal: 0.35 },
    desc: 'Glowing pools that eat tyres. The Glowkin call it home.',
  },
  ruins: {
    name: 'Ruins', surface: 'concrete', grip: 1.1, soft: 0.0, dust: 0xbfb5a3,
    resources: { electronics: 1.2, scrap: 0.8, ammo: 0.35 },
    desc: 'Old-world towers full of circuits, ambush spots and rusted dreams.',
  },
  oasis: {
    name: 'Oasis', surface: 'grass', grip: 0.98, soft: 0.3, dust: 0x9ccc65,
    liquid: { type: 'water', level: 1.0 },
    resources: { water: 1.3, food: 1.3 },
    desc: 'Green, wet and precious. Everyone wants it, few can hold it.',
  },
  ashlands: {
    name: 'Ash Wastes', surface: 'ash', grip: 0.88, soft: 0.45, dust: 0x5d5755,
    liquid: { type: 'lava', level: 3.0 },
    resources: { crystal: 0.8, scrap: 0.7, fuel: 0.3 },
    desc: 'Black ridges and lava seams. Only the Dominion is mad enough to live here.',
  },
  crystal: {
    name: 'Crystal Mesa', surface: 'crystal', grip: 0.96, soft: 0.2, dust: 0xb9a3d9,
    resources: { crystal: 1.6, electronics: 0.4 },
    desc: 'Purple spires that hum at night. Laser-grade crystal grows here.',
  },
  glass: {
    name: 'Glass Sea', surface: 'glass', grip: 0.76, soft: 0.0, dust: 0x7fd1b9,
    resources: { crystal: 0.6, electronics: 0.9 },
    desc: 'Where the bombs fell, sand turned to glass bowls. Slippery skate-park of the gods.',
  },
};

// Wheel types modify how surfaces feel
export const SURFACE_WHEEL = {
  standard: { sand: 1, salt: 1, rock: 1, tar: 1, mud: 1, concrete: 1, grass: 1, ash: 1, crystal: 1, glass: 1, packed: 1 },
  offroad: { sand: 1.22, salt: 0.95, rock: 1.05, tar: 1.1, mud: 1.25, concrete: 0.93, grass: 1.1, ash: 1.15, crystal: 1, glass: 0.9, packed: 1 },
  slicks: { sand: 0.68, salt: 1.3, rock: 0.95, tar: 0.85, mud: 0.6, concrete: 1.3, grass: 0.85, ash: 0.75, crystal: 1.05, glass: 1.2, packed: 1.15 },
  tracks: { sand: 1.15, salt: 1.1, rock: 1.25, tar: 1.15, mud: 1.2, concrete: 1.1, grass: 1.15, ash: 1.2, crystal: 1.15, glass: 1.05, packed: 1.1 },
  hover: { sand: 1, salt: 1, rock: 1, tar: 1, mud: 1, concrete: 1, grass: 1, ash: 1, crystal: 1, glass: 1, packed: 1 },
};

export const LIQUIDS = {
  water: { color: 0x4fc3e8, drag: 2.2, damage: 0, emissive: 0x000000, opacity: 0.82 },
  toxic: { color: 0x7cff4f, drag: 2.6, damage: 6, emissive: 0x2a8a10, opacity: 0.9 },
  tar: { color: 0x1e1712, drag: 4.0, damage: 0, emissive: 0x000000, opacity: 0.97 },
  lava: { color: 0xff6a2a, drag: 3.0, damage: 30, emissive: 0xff4a10, opacity: 1.0 },
};

// --- Height functions: (x, z, N) -> metres, N = { a, b, c } noise generators ---
export const HEIGHT = {
  hub(x, z, N) {
    const r = Math.hypot(x, z);
    const berm = 2.5 * smoothstep(150, 185, r) * (1 - smoothstep(205, 240, r));
    return 3 + 0.6 * N.a.fbm(x / 80, z / 80, 2) + berm;
  },
  dunes(x, z, N) {
    const ang = 0.6 + 0.6 * N.c.noise(x / 1600, z / 1600);
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const along = x * dx + z * dz, across = -x * dz + z * dx;
    const u = along / 74 + 0.95 * N.a.fbm(across / 280, along / 420, 2) + 0.25 * N.b.noise(x / 95, z / 95);
    const s = fract(u);
    const prof = s < 0.78 ? Math.pow(s / 0.78, 1.25) : 1 - smoothstep(0.78, 1.0, s);
    let amp = 5 + 10 * (0.5 + 0.5 * N.b.fbm(x / 520, z / 520, 2));
    amp *= 0.55 + 0.45 * (0.5 + 0.5 * N.c.noise(across / 130, along / 300));
    // small cross-dunes for chatter
    const u2 = (x * 0.8 - z * 0.6) / 33 + 0.6 * N.c.noise(x / 120, z / 120);
    const s2 = fract(u2);
    const p2 = s2 < 0.7 ? s2 / 0.7 : 1 - smoothstep(0.7, 1, s2);
    return 4 + amp * prof + 1.6 * p2 + 3 * N.a.fbm(x / 190, z / 190, 3);
  },
  saltflats(x, z, N) {
    let h = 3 + 0.9 * N.a.fbm(x / 320, z / 320, 2);
    const b = N.b.noise(x / 230, z / 230);
    h += 13 * smoothstep(0.62, 0.72, b); // flat-topped buttes
    const k = N.c.noise(x / 60, z / 60); // natural kicker ramps
    h += 2.2 * smoothstep(0.55, 0.85, k);
    return h;
  },
  canyon(x, z, N) {
    const n0 = 0.5 + 0.5 * N.a.fbm(x / 360, z / 360, 4);
    const sharp = 0.45 + 0.35 * (0.5 + 0.5 * N.b.noise(x / 210, z / 210));
    const mesa = terrace(smoothstep(0.32, 0.78, n0), 3, sharp) * 38;
    return 3 + mesa + 1.2 * N.c.fbm(x / 45, z / 45, 2);
  },
  oilfield(x, z, N) {
    let h = 5 + 5 * N.a.fbm(x / 260, z / 260, 3) + 1.6 * N.b.fbm(x / 60, z / 60, 2);
    const p = N.c.noise(x / 150 + 50, z / 150);
    h -= 7.5 * smoothstep(0.5, 0.8, p);
    return h;
  },
  toxic(x, z, N) {
    let h = 2.8 + 3.2 * N.a.fbm(x / 210, z / 210, 3);
    h += 3.5 * Math.pow(N.b.ridged(x / 70, z / 70, 2), 2);
    h -= 4 * smoothstep(0.3, 0.7, N.c.noise(x / 170, z / 170));
    return h;
  },
  ruins(x, z, N) {
    return 2.6 + 1.1 * N.a.fbm(x / 220, z / 220, 2) + 0.3 * N.b.noise(x / 30, z / 30);
  },
  oasis(x, z, N) {
    let h = 5 + 7 * N.a.fbm(x / 300, z / 300, 3);
    const l = N.b.noise(x / 380 + 9, z / 380 - 3);
    h -= 11 * smoothstep(0.25, 0.6, l);
    return h;
  },
  ashlands(x, z, N) {
    const r = N.a.ridged(x / 230, z / 230, 4);
    let h = 7 + 20 * Math.pow(r, 1.6) + 2 * N.b.fbm(x / 50, z / 50, 2);
    h -= 6 * smoothstep(0.45, 0.75, N.c.noise(x / 260, z / 260));
    return h;
  },
  crystal(x, z, N) {
    const n = 0.5 + 0.5 * N.a.fbm(x / 270, z / 270, 4);
    return 5 + 16 * terrace(n, 4, 0.55) + 1.2 * N.b.noise(x / 40, z / 40);
  },
  glass(x, z, N) {
    let h = 7 + 1.5 * N.a.fbm(x / 300, z / 300, 2);
    const cell = 150;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const gx = cx + i, gz = cz + j;
      const hx = (gx + 0.5 + 0.35 * N.c.noise(gx * 7.1, gz * 3.3)) * cell;
      const hz = (gz + 0.5 + 0.35 * N.c.noise(gx * 2.7, gz * 9.1)) * cell;
      const rad = 45 + 30 * (0.5 + 0.5 * N.b.noise(gx * 5.3, gz * 1.9));
      const d = Math.hypot(x - hx, z - hz);
      if (d < rad) h -= 9 * (1 - (d / rad) * (d / rad));
      const rim = (d - rad) / 9;
      h += 3.2 * Math.exp(-rim * rim);
    }
    return h;
  },
};

// --- Colour functions: (h, slope, x, z, N, liquidLevel) -> [r,g,b] in 0..1 ---
const P = {
  sandL: hex(0xf6cf86), sandD: hex(0xe3a75c), sandC: hex(0xffe3a8),
  salt: hex(0xf6f3ec), saltD: hex(0xdcd4c4), saltP: hex(0xf2d9dc),
  red: hex(0xd9734e), redD: hex(0xbf5a3a), redL: hex(0xeaa36c), redT: hex(0xe6be86),
  oil: hex(0x7a604a), oilD: hex(0x5a4636), oilL: hex(0x957a5c),
  tox: hex(0x93a84c), toxD: hex(0x6f8a3d), toxL: hex(0xbccd58),
  ruin: hex(0xc4baa8), ruinD: hex(0x8d877e), ruinL: hex(0xd6cdb9),
  grass: hex(0x8fd05f), grassD: hex(0x67ad4a), grassS: hex(0xead69c),
  ash: hex(0x4d4848), ashD: hex(0x3a3636), ashL: hex(0x6c6462), ember: hex(0xff7a45),
  cry: hex(0xbca6dc), cryD: hex(0x9a83c8), cryL: hex(0xd9c9f0),
  glass: hex(0x86d8c0), glassD: hex(0x5cbaa3), glassL: hex(0xb6f0de),
  hub: hex(0xdcb886), hubD: hex(0xc49a6a),
  cliff: hex(0xb07b5b), shore: hex(0xe9d9a6),
};

export const COLOR = {
  hub(h, s, x, z, N) {
    const n = N.b.noise(x / 18, z / 18);
    return mix3(P.hub, P.hubD, 0.3 + 0.3 * n);
  },
  dunes(h, s, x, z, N) {
    const t = clamp((h - 4) / 16, 0, 1);
    let c = mix3(P.sandD, P.sandL, t);
    if (s > 0.45) c = mix3(c, P.sandD, 0.5);
    if (t > 0.75) c = mix3(c, P.sandC, (t - 0.75) * 3);
    return c;
  },
  saltflats(h, s, x, z, N) {
    const n = N.c.noise(x / 9, z / 9);
    let c = Math.abs(n) < 0.06 ? P.saltD : P.salt;
    if (h > 8) c = mix3(P.saltP, P.redL, clamp((h - 8) / 10, 0, 1) * 0.6);
    return c;
  },
  canyon(h, s, x, z, N) {
    const band = fract(h / 6.5 + 0.15 * N.c.noise(x / 50, z / 50));
    let c = band < 0.33 ? P.redD : band < 0.66 ? P.red : P.redL;
    if (s < 0.18 && h > 10) c = mix3(c, P.redT, 0.6);
    return c;
  },
  oilfield(h, s, x, z, N) {
    const n = N.b.noise(x / 25, z / 25);
    return mix3(P.oilD, P.oilL, clamp(0.5 + 0.5 * n + (h - 5) / 20, 0, 1));
  },
  toxic(h, s, x, z, N) {
    const n = N.b.noise(x / 20, z / 20);
    return mix3(P.toxD, P.toxL, clamp(0.4 + 0.5 * n + (h - 3) / 12, 0, 1));
  },
  ruins(h, s, x, z, N) {
    const gx = fract(x / 64), gz = fract(z / 64);
    const road = gx < 0.18 || gz < 0.18;
    return road ? P.ruinD : mix3(P.ruin, P.ruinL, 0.5 + 0.5 * N.c.noise(x / 14, z / 14));
  },
  oasis(h, s, x, z, N) {
    if (h < 2.2) return P.shore;
    const n = N.b.noise(x / 22, z / 22);
    return mix3(P.grassD, P.grass, clamp(0.5 + 0.5 * n, 0, 1));
  },
  ashlands(h, s, x, z, N) {
    if (h < 4.2) return mix3(P.ember, P.ashD, clamp((h - 3) / 1.2, 0, 1));
    const n = N.b.noise(x / 16, z / 16);
    return mix3(P.ashD, P.ashL, clamp(0.4 + 0.5 * n + (h - 10) / 30, 0, 1));
  },
  crystal(h, s, x, z, N) {
    const band = fract(h / 4);
    return band < 0.5 ? mix3(P.cryD, P.cry, band * 2) : mix3(P.cry, P.cryL, (band - 0.5));
  },
  glass(h, s, x, z, N) {
    const n = N.b.noise(x / 30, z / 30);
    return mix3(P.glassD, P.glassL, clamp(0.5 + 0.4 * n + (h - 4) / 14, 0, 1));
  },
};

export const CLIFF_COLOR = P.cliff;
export { hex, mix3 };
