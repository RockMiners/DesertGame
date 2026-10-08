// Premade lore: zones, factions, leaders, history and name generators.
import { RNG } from '../core/math.js';

export const GAME_TITLE = 'Dustbowl Dynasties';
export const START_YEAR = 41; // years After the Burn (A.B.)

// ring: 0 hub, 1 inner, 2 outer. slot = angle index on the ring.
export const ZONE_DEFS = [
  { id: 'hub', name: 'The Hub', biome: 'hub', ring: 0, slot: 0, owner: null },
  // inner ring (6 slots, 60° apart) – modest riches, mostly wild
  { id: 'tumbleweed', name: 'Tumbleweed Flats', biome: 'dunes', ring: 1, slot: 0, owner: null },
  { id: 'brinewater', name: 'Brinewater Pans', biome: 'saltflats', ring: 1, slot: 1, owner: null },
  { id: 'greenhollow', name: 'Greenhollow Oasis', biome: 'oasis', ring: 1, slot: 2, owner: 'choir' },
  { id: 'rattlesnake', name: 'Rattlesnake Dunes', biome: 'dunes', ring: 1, slot: 3, owner: 'rats' },
  { id: 'suburbia', name: 'Old Suburbia', biome: 'ruins', ring: 1, slot: 4, owner: 'rats' },
  { id: 'bustedmesa', name: 'Busted Mesa', biome: 'canyon', ring: 1, slot: 5, owner: null },
  // outer ring (12 slots, 30° apart) – rich and dangerous
  { id: 'gusher', name: 'Gusher Gulch', biome: 'oilfield', ring: 2, slot: 0, owner: 'saints' },
  { id: 'blackwell', name: 'Blackwell Fields', biome: 'oilfield', ring: 2, slot: 1, owner: null },
  { id: 'tarpit', name: 'Tarpit Basin', biome: 'oilfield', ring: 2, slot: 2, owner: 'barons' },
  { id: 'whitesalt', name: 'Whitesalt Expanse', biome: 'saltflats', ring: 2, slot: 3, owner: 'barons' },
  { id: 'lotus', name: 'Lotus Springs', biome: 'oasis', ring: 2, slot: 4, owner: 'choir' },
  { id: 'greaterg', name: 'The Great Erg', biome: 'dunes', ring: 2, slot: 5, owner: 'rustclaw' },
  { id: 'rustcity', name: 'Rust City', biome: 'ruins', ring: 2, slot: 6, owner: 'rustclaw' },
  { id: 'redmaw', name: 'Red Maw Canyon', biome: 'canyon', ring: 2, slot: 7, owner: 'dominion' },
  { id: 'cinder', name: 'Cinder Reach', biome: 'ashlands', ring: 2, slot: 8, owner: 'dominion' },
  { id: 'glittering', name: 'The Glittering', biome: 'crystal', ring: 2, slot: 9, owner: 'dominion' },
  { id: 'glasssea', name: 'The Glass Sea', biome: 'glass', ring: 2, slot: 10, owner: 'glowkin' },
  { id: 'glowmire', name: 'Glowmire', biome: 'toxic', ring: 2, slot: 11, owner: 'glowkin' },
];

// traits 0..1: aggression, greed, honor, caution, ambition, cunning, zeal, paranoia
export const FACTION_DEFS = [
  {
    id: 'dominion', name: 'Iron Dominion', short: 'Dominion', color: '#5b7db1', accent: '#d64545', home: 'cinder',
    strength: 10, carStyle: 'heavy', motto: 'Order outlasts everything.',
    leader: { name: 'Volga Hardplate', title: 'General', traits: { aggression: 0.6, greed: 0.4, honor: 0.6, caution: 0.55, ambition: 0.95, cunning: 0.6, zeal: 0.5, paranoia: 0.8 } },
    lore: 'When the Sky Burned, a garrison sealed itself inside the mountain at Cinder Reach. Twenty years later the blast doors opened and out rolled tanks, a rulebook and a General who had never once lost an argument. The Dominion believes the wasteland is just a mess waiting for paperwork.',
    quotes: ['Discipline is a weapon that never runs dry.', 'Every zone on that map will fly our flag. It is simply a matter of scheduling.', 'Trust is a supply line. Cut it, and you starve.'],
  },
  {
    id: 'saints', name: 'Chrome Saints', short: 'Saints', color: '#e8b923', accent: '#ffffff', home: 'gusher',
    strength: 8, carStyle: 'muscle', motto: 'Witness the Combustion!',
    leader: { name: 'Mother Gasket', title: 'High Priestess', traits: { aggression: 0.75, greed: 0.3, honor: 0.75, caution: 0.3, ambition: 0.6, cunning: 0.3, zeal: 0.95, paranoia: 0.3 } },
    lore: 'The Church of the Eternal Engine teaches that the V8 is the heartbeat of a sleeping god and petrol is its blood. Mother Gasket heard the god speak through a backfiring pumpjack at Gusher Gulch. Her faithful paint their cars chrome, pray at the wells, and consider anyone else selling oil a heretic.',
    quotes: ['Witness me! WITNESS THE COMBUSTION!', 'The Engine provides. The Engine also runs over.', 'Oil is holy. Holy things are not for sale... except by us.'],
  },
  {
    id: 'glowkin', name: 'The Glowkin', short: 'Glowkin', color: '#7cff4f', accent: '#b04dff', home: 'glowmire',
    strength: 7, carStyle: 'tech', motto: 'Glow up or go down.',
    leader: { name: 'Doc Neon', title: 'Professor', traits: { aggression: 0.45, greed: 0.5, honor: 0.25, caution: 0.4, ambition: 0.7, cunning: 0.95, zeal: 0.4, paranoia: 0.5 } },
    lore: 'Scavengers who drank from the Glowmire and, against all odds, got better. They glow faintly at night and tinker with the old world\'s forbidden science: lasers, tesla coils, hover pads. Doc Neon runs the place like a laboratory where the experiments occasionally declare war.',
    quotes: ['Fascinating! Let\'s see what happens if I betray you.', 'Science is just organised mischief.', 'Crystal is the future. Your future, specifically, is optional.'],
  },
  {
    id: 'barons', name: 'Brine Barons', short: 'Barons', color: '#2ec4b6', accent: '#f7f7f2', home: 'whitesalt',
    strength: 6, carStyle: 'fast', motto: 'Everything has a price.',
    leader: { name: 'Augustus Brackwater', title: 'Baron', traits: { aggression: 0.3, greed: 0.95, honor: 0.2, caution: 0.8, ambition: 0.65, cunning: 0.85, zeal: 0.2, paranoia: 0.6 } },
    lore: 'Salt keeps meat from rotting, and the Barons keep the salt. From their glittering flats they run caravans, lend money and buy loyalty by the barrel. Brackwater has never fired a gun himself. He doesn\'t need to: he owns the debts of the people who do. Lately he has bought pumps in Tarpit Basin, and the Saints have noticed.',
    quotes: ['Peace is simply war with better margins.', 'Loyalty? Splendid. How much?', 'I never break a contract. I merely outgrow it.'],
  },
  {
    id: 'rustclaw', name: 'Rustclaw Raiders', short: 'Rustclaw', color: '#d9572b', accent: '#2b2b2b', home: 'rustcity',
    strength: 6, carStyle: 'spiky', motto: 'What\'s yours is ours.',
    leader: { name: 'Mama Rustclaw', title: 'Big', traits: { aggression: 0.9, greed: 0.7, honor: 0.4, caution: 0.2, ambition: 0.5, cunning: 0.4, zeal: 0.6, paranoia: 0.3 } },
    lore: 'A hundred little gangs, stitched together by one enormous woman with a wrench. Rustclaw raid anything that moves and most things that don\'t. Mama treats every raider as one of her kids, which means she will both die for you and smack you with a muffler.',
    quotes: ['Mama\'s hungry, kids. Go get dinner.', 'If it\'s bolted down, bring a bigger wrench.', 'Nobody touches my babies. Except me.'],
  },
  {
    id: 'choir', name: 'Verdant Choir', short: 'Choir', color: '#8ac926', accent: '#ff8fab', home: 'lotus',
    strength: 4, carStyle: 'solar', motto: 'Grow back stronger.',
    leader: { name: 'Fern Whistledown', title: 'Elder', traits: { aggression: 0.1, greed: 0.2, honor: 0.95, caution: 0.8, ambition: 0.2, cunning: 0.4, zeal: 0.7, paranoia: 0.2 } },
    lore: 'Gardeners who sing to their crops and drive solar vans painted with flowers. They guard the last seed vault and believe the desert can bloom again. They want peace. The Rustclaw burned Greenhollow four years ago; the Choir replanted it in a season and has not forgotten.',
    quotes: ['Every seed is a promise.', 'We prefer to sing. Please don\'t make us shout.', 'Roots run deeper than tyre tracks.'],
  },
  {
    id: 'rats', name: 'Dust Rats', short: 'Rats', color: '#c9a227', accent: '#6b4f2a', home: 'suburbia',
    strength: 2, carStyle: 'scrappy', motto: 'Finders keepers.',
    leader: { name: 'Lil\' Spanner', title: 'Boss', traits: { aggression: 0.4, greed: 0.8, honor: 0.1, caution: 0.85, ambition: 0.85, cunning: 0.7, zeal: 0.3, paranoia: 0.65 } },
    lore: 'Kids who grew up in the shadow of the Hub\'s walls and learned that the Old World left a lot lying around. Their boss is fourteen, has three teeth missing and an alarming head for business. They pay tribute to Rustclaw, but only because nobody has offered them a better deal. Yet.',
    quotes: ['Finders keepers, losers weepers!', 'I\'m not a traitor. I\'m an entrepreneur.', 'You want loyalty? Get a dog. A cheap one.'],
  },
];

export const BANDITS = { id: 'scavvers', name: 'Scavvers', short: 'Scavvers', color: '#6d6875', accent: '#3d3a40' };

// Initial relations (symmetric)
export const INITIAL_RELATIONS = [
  ['saints', 'barons', -35], ['dominion', 'glowkin', -40], ['rustclaw', 'choir', -45], ['rustclaw', 'rats', 30],
  ['choir', 'barons', 30], ['dominion', 'barons', 40], ['glowkin', 'choir', 15], ['saints', 'rustclaw', -5],
  ['dominion', 'rats', -20], ['saints', 'glowkin', -15], ['barons', 'rats', 10], ['dominion', 'choir', 5],
  ['glowkin', 'rustclaw', -10], ['saints', 'choir', 10], ['dominion', 'rustclaw', -25], ['saints', 'dominion', -10],
];
export const INITIAL_ALLIANCES = [['dominion', 'barons', 'The Salt-Iron Accord'], ['rustclaw', 'rats', 'The Rust Tithe']];
export const INITIAL_WARS = [['rustclaw', 'choir']];

export const HUB_NPCS = {
  mayor: { name: 'Auntie Tallow', role: 'Mayor of the Hub' },
  mechanic: { name: 'Wrench Wendy', role: 'Garage' },
  trader: { name: 'Penny Pinch', role: 'Bazaar' },
  barkeep: { name: 'Sully Two-Mugs', role: 'The Leaky Radiator (cantina)' },
};

export const HISTORY = [
  { year: 0, title: 'The Sky Burned', text: 'The old world ended in one long afternoon of light. When the dust came down, the sea had become sand and the cities had become hills.' },
  { year: 3, title: 'The Long Thirst', text: 'Survivors learned the only two laws left: water is life, and petrol is freedom. Wheels became legs, and cars became homes.' },
  { year: 12, title: 'The Founding of the Hub', text: 'A woman named Tallow found the last clean well in the middle of the waste. Traders built walls around it and swore the Hub Accord: no blood is spilled inside these walls. The Accord has held for 29 years.' },
  { year: 21, title: 'The Doors of Cinder Reach', text: 'The blast doors of an old-world bunker swung open and the Iron Dominion rolled out in perfect formation, armed with tanks and an extremely long list of rules.' },
  { year: 26, title: 'The First Combustion', text: 'A pumpjack at Gusher Gulch backfired at sunrise and a young mechanic called Gasket heard a god in it. The Chrome Saints were born before the smoke cleared.' },
  { year: 30, title: 'The Glowmire Exodus', text: 'A plague swept the eastern camps. Those who fled into the glowing bog were given up for dead. They came back faintly luminous, and very, very clever.' },
  { year: 34, title: 'The Salt-Iron Accord', text: 'Baron Brackwater signed a supply pact with General Hardplate: salt and caravans for protection. Neither side read the other\'s fine print.' },
  { year: 37, title: 'The Burning of Greenhollow', text: 'Rustclaw raiders put Greenhollow Oasis to the torch. The Verdant Choir replanted it in a single season, singing the whole time. They are still at war.' },
  { year: 41, title: 'A Stranger Arrives', text: 'A lone driver rolls into the Hub with a dented buggy, half a tank, and no faction. Nobody pays them much attention. That is about to change.' },
];

// --- Name generators ---
const FIRST = ['Dusty', 'Sprocket', 'Tess', 'Gus', 'Moxie', 'Pip', 'Rizzo', 'Boomer', 'Tilly', 'Rusty', 'Juniper', 'Clutch', 'Dot', 'Ziggy', 'Nails', 'Bolt', 'Pepper', 'Scooter', 'Hank', 'Marigold', 'Vex', 'Kip', 'Lulu', 'Brick', 'Fizz', 'Mags', 'Otis', 'Pearl', 'Rook', 'Sable', 'Tank', 'Ursa', 'Vinnie', 'Wren', 'Yuri', 'Zelda', 'Axle', 'Buzz', 'Cog', 'Dixie', 'Echo', 'Flint', 'Gigi', 'Hops', 'Ivy', 'Jinx', 'Knox', 'Lark', 'Mo', 'Nova', 'Ozzy', 'Piston', 'Quill', 'Roo', 'Sunny', 'Tinker', 'Velvet', 'Waldo', 'Yara', 'Zip', 'Bea', 'Chuck', 'Dolly', 'Ernie', 'Fern', 'Goose', 'Harley', 'Inez', 'June', 'Kettle', 'Lefty', 'Minnie', 'Ned', 'Olive', 'Patch', 'Rosie', 'Stubbs', 'Toots', 'Vera', 'Winnie'];
const NICK = ['Gearbox', 'Two-Tires', 'the Kid', 'Burnout', 'Sandwich', 'Halfpipe', 'Crankshaft', 'Tumbleweed', 'Sparkplug', 'Muffler', 'Lugnut', 'Hubcap', 'Rustbucket', 'Cactus', 'Skidmark', 'Nitro', 'Grease', 'Scrapper', 'Rattlecan', 'Diesel', 'Fender', 'Dustdevil', 'Rimshot', 'Jumpstart', 'Pothole', 'Lockjaw', 'Sidewinder', 'Wheelie', 'Bumper', 'Doughnut', 'Gravel', 'Pistonhead', 'Radiator', 'Turbo', 'Chrome', 'Junkyard', 'Revs', 'Hotwire', 'Dipstick', 'Pinstripe'];
const LAST = ['McGee', 'Oilcan', 'Brakewell', 'Sandoval', 'Rattigan', 'Dunmore', 'Cogsworth', 'Tankersly', 'Fumes', 'Gritt', 'Lugwrench', 'Bolt', 'Dustin', 'Scrapwell', 'Holloway', 'Pitstop', 'Grimsby', 'Ratchet', 'Saltmarsh', 'Hayseed'];

export function genDriverName(rng) {
  const f = rng.pick(FIRST);
  const r = rng.next();
  if (r < 0.4) return `${f} "${rng.pick(NICK)}" ${rng.pick(LAST)}`;
  if (r < 0.75) return `${f} ${rng.pick(NICK)}`;
  return `${f} ${rng.pick(LAST)}`;
}
export function shortName(name) {
  const m = name.match(/"([^"]+)"/);
  if (m) return m[1];
  return name.split(' ')[0];
}

const FADJ = ['Rust', 'Chrome', 'Dust', 'Iron', 'Ember', 'Scorpion', 'Vulture', 'Thunder', 'Grease', 'Ashen', 'Hollow', 'Neon', 'Gilded', 'Broken', 'Howling', 'Sun', 'Bone', 'Nitro', 'Tumble', 'Cobalt', 'Wild', 'Crimson', 'Copper', 'Static', 'Sandstorm', 'Midnight', 'Jackal', 'Mirage', 'Cactus', 'Burnt'];
const FNOUN = ['Kings', 'Riders', 'Pack', 'Clan', 'Syndicate', 'Brotherhood', 'Sisters', 'Collective', 'Horde', 'Union', 'Legion', 'Wolves', 'Jackals', 'Covenant', 'Tribe', 'Crew', 'Cartel', 'Order', 'Caravan', 'Saints', 'Rovers', 'Wardens', 'Prophets', 'Mob'];
const TITLES = ['Warlord', 'Queen', 'Boss', 'Prophet', 'Chief', 'Captain', 'Big', 'Old', 'Mad', 'Lady', 'Sir', 'Doc', 'Saint', 'Duke', 'Marshal'];
const COLORS = ['#ff595e', '#ffca3a', '#1982c4', '#6a4c93', '#ff924c', '#52a675', '#f15bb5', '#00bbf9', '#9b5de5', '#fee440', '#e76f51', '#2a9d8f', '#b5838d', '#f4a261'];

export const ARCHETYPES = {
  Warmonger: { aggression: 0.9, greed: 0.5, honor: 0.4, caution: 0.2, ambition: 0.7, cunning: 0.3, zeal: 0.6, paranoia: 0.3 },
  Merchant: { aggression: 0.25, greed: 0.9, honor: 0.4, caution: 0.7, ambition: 0.5, cunning: 0.8, zeal: 0.2, paranoia: 0.5 },
  Zealot: { aggression: 0.7, greed: 0.2, honor: 0.7, caution: 0.3, ambition: 0.6, cunning: 0.3, zeal: 0.95, paranoia: 0.4 },
  Schemer: { aggression: 0.4, greed: 0.6, honor: 0.1, caution: 0.6, ambition: 0.8, cunning: 0.95, zeal: 0.3, paranoia: 0.7 },
  Protector: { aggression: 0.2, greed: 0.3, honor: 0.9, caution: 0.8, ambition: 0.3, cunning: 0.5, zeal: 0.6, paranoia: 0.3 },
  Opportunist: { aggression: 0.5, greed: 0.8, honor: 0.2, caution: 0.6, ambition: 0.7, cunning: 0.7, zeal: 0.2, paranoia: 0.5 },
  Conqueror: { aggression: 0.75, greed: 0.5, honor: 0.55, caution: 0.45, ambition: 0.95, cunning: 0.6, zeal: 0.5, paranoia: 0.6 },
  Madcap: { aggression: 0.7, greed: 0.5, honor: 0.3, caution: 0.1, ambition: 0.6, cunning: 0.4, zeal: 0.9, paranoia: 0.2 },
};
export const ARCHETYPE_QUOTES = {
  Warmonger: ['Engines hot, guns hotter!', 'Peace is what happens between my wars.', 'I didn\'t come all this way to talk.'],
  Merchant: ['Let\'s keep this civil and profitable.', 'Bullets are expensive. Deals are cheap.', 'I\'ll buy your loyalty. Name a price.'],
  Zealot: ['The faithful never retreat!', 'My cause is righteous and my bumper is reinforced.', 'Burn bright, die loud.'],
  Schemer: ['Every friend is just an enemy with good timing.', 'Oh, I have a plan. I always have a plan.', 'Smile. It confuses them.'],
  Protector: ['Nobody hurts my people.', 'We hold the line. Always.', 'I\'d rather build walls than graves.'],
  Opportunist: ['Whoever\'s winning, I\'m with them.', 'Chaos is a ladder. Also a trade route.', 'Nothing personal. It\'s just salvage.'],
  Conqueror: ['The map is too small for two of us.', 'Every flag I plant is a promise.', 'Kneel, or be driven over.'],
  Madcap: ['WHEEEEEE!', 'Rules are just suggestions written by losers.', 'Let\'s see how fast this thing explodes!'],
};

export function genFaction(rng, usedNames = new Set()) {
  let name;
  for (let k = 0; k < 20; k++) {
    name = `${rng.chance(0.6) ? 'The ' : ''}${rng.pick(FADJ)} ${rng.pick(FNOUN)}`;
    if (!usedNames.has(name)) break;
  }
  const archetype = rng.pick(Object.keys(ARCHETYPES));
  const base = ARCHETYPES[archetype];
  const traits = {};
  for (const k in base) traits[k] = Math.min(1, Math.max(0, base[k] + rng.range(-0.15, 0.15)));
  const leaderName = genDriverName(rng).replace(/ ".*" /, ' ');
  const short = name.replace(/^The /, '').split(' ').pop();
  return {
    name, short, archetype,
    color: rng.pick(COLORS), accent: rng.pick(['#ffffff', '#222222', '#ffd166', '#06d6a0']),
    leader: { name: leaderName, title: rng.pick(TITLES), traits },
    motto: rng.pick(ARCHETYPE_QUOTES[archetype]),
    quotes: ARCHETYPE_QUOTES[archetype],
    carStyle: rng.pick(['spiky', 'muscle', 'fast', 'heavy', 'scrappy', 'tech']),
  };
}

export function archetypeOf(traits) {
  let best = 'Opportunist', bestD = Infinity;
  for (const [k, t] of Object.entries(ARCHETYPES)) {
    let d = 0;
    for (const key in t) d += (t[key] - (traits[key] ?? 0.5)) ** 2;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

export const BASE_NAME_PARTS = {
  pre: ['Fort', 'Camp', 'Outpost', 'Rig', 'Den', 'Station', 'Bastion', 'Hold', 'Yard', 'Nest', 'Depot', 'Lookout'],
  post: ['Rattle', 'Sundown', 'Dusty', 'Gearwhistle', 'Lastchance', 'Highrock', 'Bentwheel', 'Saltlick', 'Ironside', 'Muffler', 'Skyhook', 'Cactus', 'Bonepile', 'Hubcap', 'Shiny', 'Sparks', 'Tinroof', 'Redline'],
};
export function genBaseName(rng) {
  return `${rng.pick(BASE_NAME_PARTS.pre)} ${rng.pick(BASE_NAME_PARTS.post)}`;
}

export const EPITHETS = {
  betrayer: ['the Backstabber', 'the Two-Faced', 'Knife-in-the-Dark', 'the Turncoat'],
  conqueror: ['the Conqueror', 'Flag-Planter', 'the Unstoppable', 'Zone-Eater'],
  slayer: ['the Wrecker', 'Scrapmaker', 'the Reaper of Rigs', 'Boom-Bringer'],
  trader: ['Goldtooth', 'the Merchant Prince', 'Fat-Wallet', 'the Haggler'],
  savior: ['the Kind', 'Shield of the Waste', 'Oasis-Keeper', 'the Generous'],
  racer: ['Lightning', 'Dune-Dancer', 'the Comet', 'Hot-Wheels'],
};

export function makeRng(seed, salt) { return new RNG((seed * 2654435761 + salt * 97) >>> 0); }
