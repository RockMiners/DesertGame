// Strategic constants and the base-structure catalogue.

export const DAY_LEN = 720; // real seconds per in-game day
export const HOUR = DAY_LEN / 24;
export const TILE = 6; // metres per base tile
export const BASE_SIZES = [0, 7, 9, 11]; // tiles per side by base level
export const PHYS_R = 420; // squads/bases within this of a player become physical
export const PHYS_R_OUT = 560;
export const GUARD_R = 260; // garrison guard cars only roll out when a player is this close
export const GUARD_R_OUT = 340;
export const HUB_QUIET_R = 650; // scavvers never spawn or roam inside this ring around the Hub

// produces: { res: per game hour at full efficiency }; workers: members needed; power: +gen / -use
export const STRUCTS = {
  hq: { name: 'Headquarters', icon: '🏰', w: 2, d: 2, hp: 1600, cost: { scrap: 80 }, beds: 4, storage: 500, power: 2, unique: true, desc: 'Heart of the base. Sleep here to set your respawn point. Lose it and the base falls.' },
  shack: { name: 'Shack', icon: '🛖', w: 1, d: 1, hp: 220, cost: { scrap: 20 }, beds: 4, desc: 'Sleeps 4. Every faction member needs a bed somewhere.' },
  bunkhouse: { name: 'Bunkhouse', icon: '🏠', w: 2, d: 1, hp: 450, cost: { scrap: 55, water: 10 }, beds: 10, desc: 'Sleeps 10. Space-efficient lodging.' },
  mine: { name: 'Scrap Mine', icon: '⛏️', w: 2, d: 2, hp: 500, cost: { scrap: 60 }, workers: 2, power: -1, produces: 'minerals', rate: 3.2, desc: 'Digs whatever the zone holds: scrap, crystal or circuits.' },
  pump: { name: 'Pumpjack', icon: '🛢️', w: 1, d: 2, hp: 380, cost: { scrap: 50 }, workers: 1, produces: { fuel: 3.0 }, needs: 'fuel', desc: 'Pumps petrol. Only worthwhile where there is oil.' },
  well: { name: 'Water Well', icon: '💧', w: 1, d: 1, hp: 250, cost: { scrap: 30 }, workers: 1, produces: { water: 2.4 }, desc: 'Draws water. Better in an oasis.' },
  farm: { name: 'Greenhouse', icon: '🌱', w: 2, d: 2, hp: 300, cost: { scrap: 40, water: 15 }, workers: 2, produces: { food: 3.0 }, consumes: { water: 0.6 }, desc: 'Grows grub. Drinks water.' },
  extractor: { name: 'Chem Extractor', icon: '🧪', w: 1, d: 1, hp: 300, cost: { scrap: 50 }, workers: 1, power: -1, produces: { chems: 2.2 }, desc: 'Leaches chems from salt and bog.' },
  solar: { name: 'Solar Array', icon: '☀️', w: 2, d: 1, hp: 220, cost: { scrap: 30, electronics: 10 }, power: 3, solar: true, desc: '+3 power in daylight. Free and clean.' },
  generator: { name: 'Generator', icon: '⚡', w: 1, d: 1, hp: 320, cost: { scrap: 40 }, power: 4, consumes: { fuel: 0.5 }, desc: '+4 power, day and night. Burns petrol.' },
  ammo: { name: 'Ammo Works', icon: '🔸', w: 2, d: 2, hp: 420, cost: { scrap: 80, chems: 10 }, workers: 2, power: -2, produces: { ammo: 8 }, consumes: { scrap: 1.5, chems: 0.8 }, desc: 'Turns scrap and chems into ammo.' },
  garage: { name: 'Garage', icon: '🔧', w: 2, d: 2, hp: 550, cost: { scrap: 100 }, workers: 1, desc: 'Build cars from your designs, repair and refit.' },
  turret: { name: 'MG Turret', icon: '🔫', w: 1, d: 1, hp: 380, cost: { scrap: 40, ammo: 20 }, weapon: 'mg', range: 120, defense: 14, dps: 32, desc: 'Automated machine gun.' },
  cannonT: { name: 'Cannon Tower', icon: '💥', w: 1, d: 1, hp: 520, cost: { scrap: 90, ammo: 20 }, weapon: 'cannon', range: 200, defense: 26, dps: 42, desc: 'Lobs shells at anything hostile.' },
  laserT: { name: 'Laser Tower', icon: '🔆', w: 1, d: 1, hp: 420, cost: { crystal: 20, electronics: 20, scrap: 30 }, weapon: 'laser', range: 170, power: -2, defense: 34, dps: 58, tier: 3, desc: 'Continuous beam. Needs power.' },
  wall: { name: 'Scrap Wall', icon: '🧱', w: 1, d: 1, hp: 650, cost: { scrap: 15 }, desc: 'Blocks cars and bullets.' },
  depot: { name: 'Depot', icon: '📦', w: 1, d: 1, hp: 320, cost: { scrap: 40 }, storage: 350, desc: '+350 storage. Needed for transport routes.' },
  radio: { name: 'Radio Tower', icon: '📡', w: 1, d: 1, hp: 200, cost: { scrap: 30, electronics: 15 }, desc: 'Early warning of attacks and more walk-in recruits.' },
  market: { name: 'Trade Post', icon: '🏪', w: 1, d: 1, hp: 260, cost: { scrap: 40 }, desc: 'Lets you buy and sell at this base.' },
  autorig: { name: 'Auto-Rig', icon: '🤖', w: 1, d: 1, hp: 250, cost: { scrap: 30, electronics: 25 }, power: -2, tier: 2, desc: 'Robot arms: production buildings touching it need no workers. Needs power.' },
  bulldozed: { name: 'Bulldoze', icon: '🚜', w: 1, d: 1, hp: 0, cost: { scrap: 6 }, special: true, desc: 'Flatten a rough tile so you can build on it.' },
};

export const BUILD_ORDER = ['hq', 'shack', 'bunkhouse', 'mine', 'pump', 'well', 'farm', 'extractor', 'solar', 'generator', 'ammo', 'garage', 'turret', 'cannonT', 'laserT', 'wall', 'depot', 'radio', 'market', 'autorig', 'bulldozed'];

export const RANKS = ['Prospect', 'Driver', 'Road Captain', 'Lieutenant', 'Right Hand'];
export const RANK_REP = [0, 25, 50, 75, 92];

export function dayOf(time) { return Math.floor(time / DAY_LEN + 0.3) + 1; }
export function timeOfDay(time) { return (time / DAY_LEN + 0.3) % 1; }
export function clockString(time) {
  const t = timeOfDay(time) * 24;
  const h = Math.floor(t), m = Math.floor((t - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
