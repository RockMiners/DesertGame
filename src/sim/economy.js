// Supply & demand market. Prices float with stock levels; factions dump surplus and buy shortages.
import { RESOURCES, RES_INFO } from '../world/biomes.js';
import { clamp } from '../core/math.js';

const ELASTICITY = 0.75;

export function initMarket() {
  const stock = {}, target = {}, hist = {};
  for (const r of RESOURCES) {
    target[r] = 300;
    stock[r] = 300;
    hist[r] = [];
  }
  // Hub begins slightly thirsty
  stock.water = 220; stock.fuel = 240; stock.crystal = 160; stock.electronics = 200;
  return { stock, target, hist, volume: {} };
}

export function unitPrice(m, res, stockOverride) {
  const s = Math.max(5, stockOverride ?? m.stock[res]);
  const k = Math.pow(m.target[res] / s, ELASTICITY);
  return RES_INFO[res].base * clamp(k, 0.25, 5);
}

export function buyPrice(m, res) { return Math.max(1, Math.round(unitPrice(m, res) * 1.12)); }
export function sellPrice(m, res) { return Math.max(1, Math.round(unitPrice(m, res) * 0.88)); }

// Quote for a transaction of n units (integrates over the moving price)
export function quote(m, res, n, selling) {
  let total = 0;
  let s = m.stock[res];
  const chunk = Math.max(1, Math.ceil(n / 10));
  let left = n;
  while (left > 0) {
    const c = Math.min(chunk, left);
    const p = unitPrice(m, res, selling ? s + c / 2 : s - c / 2) * (selling ? 0.88 : 1.12);
    total += p * c;
    s += selling ? c : -c;
    left -= c;
  }
  return Math.max(n > 0 ? 1 : 0, Math.round(total));
}

export function marketSell(m, res, n) {
  const caps = quote(m, res, n, true);
  m.stock[res] += n;
  m.volume[res] = (m.volume[res] || 0) + n;
  return caps;
}

export function marketBuy(m, res, n) {
  n = Math.min(n, Math.floor(m.stock[res] - 5));
  if (n <= 0) return { n: 0, caps: 0 };
  const caps = quote(m, res, n, false);
  m.stock[res] -= n;
  m.volume[res] = (m.volume[res] || 0) + n;
  return { n, caps };
}

// Hub townsfolk consume every hour; caravans of independent traders trickle in.
const HUB_DEMAND = { water: 3.2, food: 3.0, fuel: 2.8, ammo: 1.6, scrap: 1.5, chems: 1.0, electronics: 0.7, crystal: 0.5 };
const HUB_SUPPLY = { water: 1.2, food: 1.2, fuel: 1.0, ammo: 0.9, scrap: 1.6, chems: 0.6, electronics: 0.45, crystal: 0.25 };

export function marketHour(m, rng, mods = {}) {
  for (const r of RESOURCES) {
    const demand = HUB_DEMAND[r] * (mods.demand?.[r] ?? 1);
    const supply = HUB_SUPPLY[r] * (mods.supply?.[r] ?? 1) * (0.6 + rng.next() * 0.8);
    m.stock[r] = clamp(m.stock[r] - demand + supply, 5, 3000);
  }
}

export function recordPrices(m) {
  for (const r of RESOURCES) {
    const h = m.hist[r];
    h.push(Math.round(unitPrice(m, r) * 10) / 10);
    if (h.length > 48) h.shift();
  }
}

// price at a faction trade post: cheap where the faction is drowning in it
export function localPrice(m, res, faction, factionStock, selling) {
  const hub = unitPrice(m, res);
  const fs = factionStock[res] || 0;
  const k = clamp(Math.pow(150 / Math.max(10, fs), 0.35), 0.6, 1.6);
  return Math.max(1, Math.round(hub * k * (selling ? 0.8 : 1.2)));
}

export function priceTrend(m, res) {
  const h = m.hist[res];
  if (h.length < 4) return 0;
  const a = h[h.length - 1], b = h[Math.max(0, h.length - 12)];
  return (a - b) / Math.max(1, b);
}
