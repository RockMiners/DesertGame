// Vehicle part catalogue and design -> stats calculation. Pure data (Node-safe).

export const CHASSIS = {
  buggy: {
    name: 'Dune Buggy', tier: 1, len: 3.6, wid: 2.1, hei: 1.0, mass: 600, hp: 220, axles: 2, wheelR: 0.6, wheelW: 0.45,
    mounts: [{ kind: 'turret', pos: [0, 1.25, -0.4] }, { kind: 'fixed', pos: [0, 0.55, 1.6] }],
    utils: 2, cargo: 24, cost: { scrap: 30 }, buildTime: 1, size: 1,
    desc: 'Featherweight and jumpy. Flies over dunes, folds in a crash.',
  },
  coupe: {
    name: 'Muscle Car', tier: 1, len: 4.4, wid: 2.15, hei: 1.15, mass: 1000, hp: 330, axles: 2, wheelR: 0.55, wheelW: 0.5,
    mounts: [{ kind: 'turret', pos: [0, 1.5, -0.4] }, { kind: 'fixed', pos: [0, 0.85, 1.9] }],
    utils: 2, cargo: 36, cost: { scrap: 60 }, buildTime: 1.5, size: 1.15,
    desc: 'Big engine bay, low centre of gravity. King of the salt flats.',
  },
  pickup: {
    name: 'Pickup', tier: 1, len: 4.9, wid: 2.3, hei: 1.6, mass: 1400, hp: 420, axles: 2, wheelR: 0.68, wheelW: 0.55,
    mounts: [{ kind: 'turret', pos: [0, 2.0, 0.3] }, { kind: 'turret', pos: [0, 1.35, -1.5] }],
    utils: 3, cargo: 90, cost: { scrap: 90 }, buildTime: 2, size: 1.3,
    desc: 'The wasteland workhorse. Hauls loot, mounts two guns.',
  },
  van: {
    name: 'Battle Van', tier: 2, len: 5.0, wid: 2.4, hei: 2.2, mass: 1800, hp: 520, axles: 2, wheelR: 0.62, wheelW: 0.55,
    mounts: [{ kind: 'turret', pos: [0, 2.45, -0.3] }, { kind: 'fixed', pos: [0, 0.9, 2.3] }, { kind: 'rear', pos: [0, 0.9, -2.4] }],
    utils: 4, cargo: 110, cost: { scrap: 130, electronics: 5 }, buildTime: 3, size: 1.45,
    desc: 'A flat roof begging for solar panels. Top-heavy on slopes.',
  },
  truck: {
    name: 'War Truck', tier: 2, len: 7.6, wid: 2.8, hei: 2.7, mass: 4200, hp: 950, axles: 3, wheelR: 0.82, wheelW: 0.7,
    mounts: [{ kind: 'turret', pos: [0, 3.25, 2.2] }, { kind: 'turret', pos: [0, 2.6, -1.0] }, { kind: 'turret', pos: [0, 2.6, -3.0] }, { kind: 'rear', pos: [0, 1.2, -3.8] }],
    utils: 5, cargo: 260, cost: { scrap: 320, electronics: 15 }, buildTime: 5, size: 2.1,
    desc: 'Three gun mounts and a mountain of cargo. Drinks petrol like a Saint.',
  },
  rig: {
    name: 'Juggernaut', tier: 3, len: 11, wid: 3.7, hei: 3.8, mass: 9000, hp: 2000, axles: 4, wheelR: 1.05, wheelW: 0.9,
    mounts: [{ kind: 'turret', pos: [0, 4.7, 3.4] }, { kind: 'turret', pos: [0, 4.2, 0.2] }, { kind: 'turret', pos: [0, 4.2, -2.6] }, { kind: 'turret', pos: [0, 4.2, -4.6] }, { kind: 'fixed', pos: [0, 1.4, 5.6] }, { kind: 'rear', pos: [0, 1.4, -5.6] }],
    utils: 7, cargo: 650, cost: { scrap: 900, electronics: 60, crystal: 10 }, buildTime: 9, size: 3.1, bunk: true,
    desc: 'A rolling fortress with bunks: sleep aboard and respawn on it. Bogs down in sand, can\'t climb steep canyon ramps.',
  },
  ark: {
    name: 'Land Ark', tier: 4, len: 16, wid: 5.2, hei: 5.2, mass: 22000, hp: 4200, axles: 5, wheelR: 1.45, wheelW: 1.2,
    mounts: [{ kind: 'turret', pos: [0, 6.4, 5.5] }, { kind: 'turret', pos: [1.6, 5.8, 1.5] }, { kind: 'turret', pos: [-1.6, 5.8, 1.5] }, { kind: 'turret', pos: [1.6, 5.8, -3] }, { kind: 'turret', pos: [-1.6, 5.8, -3] }, { kind: 'turret', pos: [0, 5.8, -6.5] }, { kind: 'fixed', pos: [0, 2, 8.2] }],
    utils: 9, cargo: 1600, cost: { scrap: 2600, electronics: 220, crystal: 80 }, buildTime: 16, size: 4.4, bunk: true,
    desc: 'A town on wheels. Unstoppable, unsteerable and visible from three zones away.',
  },
};

export const ENGINES = {
  v4: { name: 'Rattly V4', tier: 1, power: 95000, fuel: 0.022, energy: 0, mass: 110, cost: { scrap: 15 }, pitch: 1.35, desc: 'Sips fuel, wheezes uphill.' },
  v8: { name: 'Thumpin\' V8', tier: 1, power: 185000, fuel: 0.045, energy: 0, mass: 220, cost: { scrap: 50, fuel: 10 }, pitch: 1.0, desc: 'The sound of freedom.' },
  turbo: { name: 'Turbo V12', tier: 2, power: 320000, fuel: 0.085, energy: 0, mass: 320, cost: { scrap: 120, electronics: 12 }, pitch: 0.9, desc: 'Pure speed. Pure thirst.' },
  diesel: { name: 'Big Diesel', tier: 2, power: 420000, fuel: 0.075, energy: 0, mass: 700, cost: { scrap: 160, electronics: 6 }, pitch: 0.55, torque: 1.6, desc: 'Monster low-end torque for heavy rigs.' },
  electric: { name: 'Sparky Electric', tier: 2, power: 210000, fuel: 0, energy: 4.0, mass: 340, cost: { scrap: 60, electronics: 40, chems: 20 }, pitch: 1.8, desc: 'No petrol needed. Pair it with solar panels.' },
  fusion: { name: 'Pocket Fusion', tier: 3, power: 620000, fuel: 0, energy: -2.0, mass: 520, cost: { crystal: 70, electronics: 90, scrap: 150 }, pitch: 2.4, desc: 'Old-world miracle. Generates its own power.' },
};

export const WHEELS = {
  standard: { name: 'Road Tyres', tier: 1, mass: 15, grip: 1.0, soft: 1.0, speed: 1.0, cost: { scrap: 8 }, desc: 'Fine anywhere, great nowhere.' },
  offroad: { name: 'Knobblies', tier: 1, mass: 22, grip: 1.0, soft: 0.55, speed: 0.97, cost: { scrap: 20 }, desc: 'Chunky tread. Dunes and mud are no problem.' },
  slicks: { name: 'Racing Slicks', tier: 2, mass: 12, grip: 1.0, soft: 1.35, speed: 1.08, cost: { scrap: 30, chems: 8 }, desc: 'Blistering on salt and concrete. Useless in sand.' },
  tracks: { name: 'Tank Tracks', tier: 2, mass: 90, grip: 1.15, soft: 0.2, speed: 0.72, cost: { scrap: 90 }, desc: 'Climb anything, never sink, never hurry.' },
  hover: { name: 'Hover Pads', tier: 3, mass: 30, grip: 0.55, soft: 0, speed: 1.12, cost: { crystal: 30, electronics: 40 }, energy: 1.5, desc: 'Float over liquids and sand. Slidey. Drinks energy.' },
};

export const ARMOR = {
  none: { name: 'Bare Metal', tier: 1, hp: 0, mass: 0, cost: {}, desc: 'Light and fast. Hope nobody shoots.' },
  light: { name: 'Scrap Plates', tier: 1, hp: 0.35, mass: 0.12, cost: { scrap: 25 }, desc: '+35% HP, a little heavier.' },
  medium: { name: 'Riveted Steel', tier: 2, hp: 0.8, mass: 0.28, cost: { scrap: 70 }, desc: '+80% HP. Noticeably heavier.' },
  heavy: { name: 'Bunker Plate', tier: 2, hp: 1.5, mass: 0.55, cost: { scrap: 150 }, desc: '+150% HP. Handles like a fridge.' },
  reactive: { name: 'Crystal Lattice', tier: 3, hp: 1.1, mass: 0.2, cost: { crystal: 40, scrap: 60 }, explosiveResist: 0.5, desc: '+110% HP and halves blast damage.' },
};

// kind: turret (rotates to aim), fixed (forward, minor auto-aim), rear (drops behind)
export const WEAPONS = {
  mg: { name: 'Rattler MG', tier: 1, kinds: ['turret', 'fixed'], dmg: 9, rate: 11, speed: 220, spread: 0.022, range: 170, ammo: 1, mass: 40, cost: { scrap: 25 }, proj: 'bullet', sound: 'mg', desc: 'Brrrrt. Reliable, cheap, chews ammo.' },
  scatter: { name: 'Boomstick', tier: 1, kinds: ['turret', 'fixed'], dmg: 7, pellets: 8, rate: 1.4, speed: 170, spread: 0.09, range: 60, ammo: 3, mass: 45, cost: { scrap: 30 }, proj: 'bullet', sound: 'shotgun', desc: 'Up close and very personal.' },
  cannon: { name: 'Thumper Cannon', tier: 2, kinds: ['turret', 'fixed'], dmg: 90, rate: 0.75, speed: 120, spread: 0.004, range: 260, ammo: 6, splash: 6, gravity: 0.35, mass: 160, cost: { scrap: 110 }, proj: 'shell', sound: 'cannon', knock: 9, desc: 'Lobbed shells with a big splash.' },
  rockets: { name: 'Fizzler Pod', tier: 2, kinds: ['turret'], dmg: 45, rate: 2.2, speed: 70, spread: 0.05, range: 230, ammo: 5, splash: 5, homing: 2.0, mass: 90, cost: { scrap: 80, chems: 15 }, proj: 'rocket', sound: 'rocket', knock: 5, desc: 'Lightly homing rockets. Very satisfying.' },
  flamer: { name: 'Toaster', tier: 2, kinds: ['turret', 'fixed'], dmg: 5, rate: 22, speed: 38, spread: 0.12, range: 32, fuel: 0.012, burn: 6, mass: 70, cost: { scrap: 60, fuel: 20 }, proj: 'flame', sound: 'flame', desc: 'Burns petrol, burns enemies. Short range.' },
  laser: { name: 'Sunbeam Laser', tier: 3, kinds: ['turret', 'fixed'], dmg: 70, rate: 0, beam: true, range: 200, energy: 9, mass: 80, cost: { crystal: 30, electronics: 25 }, proj: 'beam', sound: 'laser', desc: 'Continuous beam (DPS). No ammo — runs on energy.' },
  tesla: { name: 'Zapper Coil', tier: 3, kinds: ['turret'], dmg: 34, rate: 2.5, range: 55, energy: 6, chain: 3, mass: 100, cost: { crystal: 20, electronics: 35, chems: 10 }, proj: 'zap', sound: 'zap', desc: 'Lightning that jumps between enemies.' },
  mines: { name: 'Caltrop Dropper', tier: 1, kinds: ['rear'], dmg: 80, rate: 0.8, ammo: 8, splash: 5, mass: 50, cost: { scrap: 40, chems: 5 }, proj: 'mine', sound: 'clunk', desc: 'Drop a present for whoever is tailgating.' },
  oil: { name: 'Oil Slick', tier: 1, kinds: ['rear'], dmg: 0, rate: 0.5, fuel: 2, mass: 30, cost: { scrap: 20 }, proj: 'slick', sound: 'splat', desc: 'Spill petrol. Pursuers spin out. Light it for a fire wall.' },
};

export const UTILS = {
  fuelTank: { name: 'Jerry Cans', tier: 1, mass: 50, cost: { scrap: 15 }, fuelCap: 60, desc: '+60 L petrol capacity.' },
  ammoBox: { name: 'Ammo Crates', tier: 1, mass: 45, cost: { scrap: 15 }, ammoCap: 150, desc: '+150 ammo capacity.' },
  cargoRack: { name: 'Cargo Rack', tier: 1, mass: 60, cost: { scrap: 20 }, cargoMult: 0.6, desc: '+60% cargo space.' },
  nitro: { name: 'Nitro Bottles', tier: 1, mass: 30, cost: { scrap: 25, chems: 10 }, nitro: 1, desc: 'Hold Shift to go stupid fast.' },
  ram: { name: 'Ram Plate', tier: 1, mass: 0.06, cost: { scrap: 35 }, ram: 1, desc: 'x2.5 ram damage dealt, half ram damage taken.' },
  spikes: { name: 'Wheel Spikes', tier: 1, mass: 25, cost: { scrap: 20 }, spikes: 1, desc: 'Side-swipe damage. Very rude.' },
  magnet: { name: 'Scrap Magnet', tier: 1, mass: 30, cost: { scrap: 30, electronics: 5 }, magnet: 1, desc: 'Triple pickup radius.' },
  solar: { name: 'Solar Panels', tier: 2, mass: 40, cost: { scrap: 30, electronics: 20, crystal: 5 }, solar: 4.5, desc: 'Free energy while the sun shines.' },
  battery: { name: 'Battery Bank', tier: 2, mass: 70, cost: { scrap: 30, chems: 20, electronics: 10 }, energyCap: 120, desc: '+120 energy capacity.' },
  jumpjets: { name: 'Jump Jets', tier: 2, mass: 45, cost: { scrap: 40, fuel: 20, electronics: 15 }, jump: 1, desc: 'Press Q to hop. Yes, over that.' },
  repair: { name: 'Repair Drone', tier: 2, mass: 30, cost: { scrap: 50, electronics: 25 }, repair: 6, desc: 'Slowly patches hull using scrap from cargo.' },
  shield: { name: 'Bubble Shield', tier: 3, mass: 60, cost: { crystal: 30, electronics: 40 }, shield: 160, desc: 'Absorbs damage, recharges with energy.' },
  radar: { name: 'Radar Dish', tier: 1, mass: 20, cost: { scrap: 20, electronics: 10 }, radar: 1, desc: 'See enemies and loot further away.' },
  plow: { name: 'Dozer Blade', tier: 1, mass: 0.08, cost: { scrap: 40 }, plow: 1, desc: 'Smash props and small cars aside.' },
};

export const PART_TABLES = { chassis: CHASSIS, engine: ENGINES, wheels: WHEELS, armor: ARMOR, weapon: WEAPONS, util: UTILS };

export const DEFAULT_DESIGN = {
  id: 'starter', name: 'Rustbucket', chassis: 'buggy', engine: 'v4', wheels: 'offroad', armor: 'none',
  weapons: ['mg', null], utils: ['fuelTank', null], paint: '#ff7f50', paint2: '#ffd166',
};

export function addCost(a, b, mult = 1) {
  for (const k in b) a[k] = (a[k] || 0) + Math.ceil(b[k] * mult);
  return a;
}

// All cost and mass scaling lives here so the garage, AI and sim agree.
export function designStats(d) {
  const ch = CHASSIS[d.chassis] || CHASSIS.buggy;
  const en = ENGINES[d.engine] || ENGINES.v4;
  const wh = WHEELS[d.wheels] || WHEELS.standard;
  const ar = ARMOR[d.armor] || ARMOR.none;
  const sz = ch.size;
  const cost = {};
  addCost(cost, ch.cost);
  addCost(cost, en.cost, Math.max(1, sz * 0.7));
  addCost(cost, wh.cost, ch.axles / 2 * Math.max(1, sz * 0.8));
  addCost(cost, ar.cost, sz * sz);
  let mass = ch.mass + en.mass + wh.mass * ch.axles * 2 * sz + ch.mass * ar.mass;
  let hp = ch.hp * (1 + ar.hp);
  let fuelCap = Math.round(45 * Math.pow(sz, 1.6));
  let ammoCap = Math.round(180 * sz);
  let energyCap = 60 + (en.energy > 0 ? 120 : 0);
  let energyRegen = 1.5 + (en.energy < 0 ? -en.energy : 0);
  let cargo = ch.cargo;
  const flags = { nitro: 0, ram: 0, spikes: 0, magnet: 0, solar: 0, jump: 0, repair: 0, shield: 0, radar: 0, plow: 0 };
  const weapons = [];
  const mounts = ch.mounts;
  (d.weapons || []).forEach((wid, i) => {
    if (!wid || i >= mounts.length) return;
    const w = WEAPONS[wid];
    if (!w || !w.kinds.includes(mounts[i].kind)) return;
    mass += w.mass;
    addCost(cost, w.cost);
    weapons.push({ id: wid, mount: i, kind: mounts[i].kind, ...w });
  });
  (d.utils || []).slice(0, ch.utils).forEach((uid) => {
    if (!uid) return;
    const u = UTILS[uid];
    if (!u) return;
    mass += u.mass < 1 ? ch.mass * u.mass : u.mass * Math.max(1, sz * 0.6);
    addCost(cost, u.cost, Math.max(1, sz * 0.5));
    if (u.fuelCap) fuelCap += Math.round(u.fuelCap * Math.max(1, sz * 0.7));
    if (u.ammoCap) ammoCap += Math.round(u.ammoCap * Math.max(1, sz * 0.7));
    if (u.cargoMult) cargo = Math.round(cargo * (1 + u.cargoMult));
    if (u.energyCap) energyCap += u.energyCap;
    if (u.solar) { flags.solar += u.solar * Math.max(1, sz * 0.8); }
    for (const k of ['nitro', 'ram', 'spikes', 'magnet', 'jump', 'repair', 'shield', 'radar', 'plow']) if (u[k]) flags[k] += u[k];
  });
  if (wh.energy) energyRegen -= wh.energy * Math.max(1, sz * 0.5);
  const power = en.power * (en.torque ? 1 : 1);
  const drag = 0.9 + 0.55 * ch.wid * ch.hei; // frontal area-ish
  const topSpeed = Math.cbrt(power / drag) * wh.speed;
  const pw = power / mass;
  const groundPressure = mass / (ch.axles * 2 * ch.wheelW * ch.wheelR * 1000);
  const dps = weapons.reduce((s, w) => s + (w.beam ? w.dmg : w.dmg * (w.pellets || 1) * w.rate), 0);
  const fuelPerSec = en.fuel * (0.6 + 0.4 * Math.sqrt(mass / 1000));
  const ramMult = (flags.ram ? 2.5 : 1) * (flags.plow ? 1.6 : 1);
  const buildTime = ch.buildTime + (ar.hp > 0.7 ? 1 : 0) + weapons.length * 0.3;
  const strength = Math.round((hp / 10 + dps * 1.4 + (flags.shield ? 25 : 0)) * (0.8 + Math.min(1.2, pw / 200)));
  return {
    chassis: ch, engine: en, wheel: wh, armor: ar, wheelId: d.wheels in WHEELS ? d.wheels : 'standard', mass: Math.round(mass), hp: Math.round(hp), power, topSpeed, powerToWeight: pw,
    fuelCap, ammoCap, energyCap, energyRegen, cargo, flags, weapons, mounts, cost, groundPressure, dps, fuelPerSec,
    ramMult, drag, size: sz, buildTime, strength, bunk: !!ch.bunk,
    explosiveResist: ar.explosiveResist || 0,
    usesFuel: en.fuel > 0, usesEnergy: en.energy > 0,
  };
}

export function costString(cost, RES_INFO) {
  return Object.entries(cost).filter(([, v]) => v > 0).map(([k, v]) => `${RES_INFO?.[k]?.icon || k} ${v}`).join('  ');
}

// Premade designs used by AI factions (by style) and the hub dealer
export const PRESET_DESIGNS = {
  scav: { name: 'Scav Runner', chassis: 'buggy', engine: 'v4', wheels: 'offroad', armor: 'none', weapons: ['mg', null], utils: [null, null], paint: '#7d7a75', paint2: '#4a4646' },
  scrappy: { name: 'Rat Rod', chassis: 'buggy', engine: 'v4', wheels: 'offroad', armor: 'light', weapons: ['mg', null], utils: ['magnet', null] },
  spiky: { name: 'Clawbuggy', chassis: 'buggy', engine: 'v8', wheels: 'offroad', armor: 'light', weapons: ['scatter', null], utils: ['spikes', 'nitro'] },
  spikyHeavy: { name: 'Gutripper', chassis: 'pickup', engine: 'v8', wheels: 'offroad', armor: 'medium', weapons: ['mg', 'scatter'], utils: ['spikes', 'ram', null] },
  muscle: { name: 'Hallelujah', chassis: 'coupe', engine: 'v8', wheels: 'standard', armor: 'light', weapons: ['flamer', 'mg'], utils: ['ram', 'nitro'] },
  muscleHeavy: { name: 'Pilgrim Truck', chassis: 'truck', engine: 'diesel', wheels: 'standard', armor: 'medium', weapons: ['flamer', 'cannon', 'mg', null], utils: ['ram', 'fuelTank', null, null, null] },
  fast: { name: 'Salt Skimmer', chassis: 'coupe', engine: 'turbo', wheels: 'slicks', armor: 'light', weapons: ['rockets', 'mg'], utils: ['nitro', 'cargoRack'] },
  fastHeavy: { name: 'Caravan Hauler', chassis: 'truck', engine: 'diesel', wheels: 'slicks', armor: 'medium', weapons: ['rockets', 'mg', 'mg', 'mines'], utils: ['cargoRack', 'fuelTank', null, null, null] },
  heavy: { name: 'Dominion APC', chassis: 'pickup', engine: 'diesel', wheels: 'tracks', armor: 'heavy', weapons: ['cannon', 'mg'], utils: ['ammoBox', 'radar', null] },
  heavyHeavy: { name: 'Hardplate Tank', chassis: 'truck', engine: 'diesel', wheels: 'tracks', armor: 'heavy', weapons: ['cannon', 'cannon', 'mg', null], utils: ['ammoBox', 'radar', 'repair', null, null] },
  tech: { name: 'Glowskimmer', chassis: 'buggy', engine: 'electric', wheels: 'hover', armor: 'light', weapons: ['laser', null], utils: ['solar', 'battery'] },
  techHeavy: { name: 'Neon Crawler', chassis: 'van', engine: 'electric', wheels: 'hover', armor: 'reactive', weapons: ['tesla', 'laser', null], utils: ['solar', 'battery', 'shield', null] },
  solar: { name: 'Sunflower Van', chassis: 'van', engine: 'electric', wheels: 'offroad', armor: 'light', weapons: ['mg', null, null], utils: ['solar', 'solar', 'repair', null] },
  solarHeavy: { name: 'Greenhouse Tank', chassis: 'truck', engine: 'electric', wheels: 'offroad', armor: 'medium', weapons: ['tesla', 'mg', 'mg', null], utils: ['solar', 'solar', 'shield', 'battery', null] },
  convoy: { name: 'Supply Truck', chassis: 'truck', engine: 'diesel', wheels: 'standard', armor: 'light', weapons: [null, 'mg', null, null], utils: ['cargoRack', 'fuelTank', null, null, null] },
  raider: { name: 'Scav Brute', chassis: 'pickup', engine: 'v8', wheels: 'offroad', armor: 'light', weapons: ['mg', 'mg'], utils: ['spikes', null, null] },
};
