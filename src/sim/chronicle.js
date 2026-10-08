// The living chronicle: turns sim events into lore entries with flavourful titles.
import { Sim } from './sim.js';
import { RES_INFO } from '../world/biomes.js';

const P = Sim.prototype;

const ADJ = ['Burning', 'Silent', 'Long', 'Red', 'Broken', 'Bitter', 'Howling', 'Golden', 'Rusted', 'Last', 'Black', 'Glass', 'Crooked', 'Thirsty', 'Shattered'];
const NOUN = ['Night', 'Dawn', 'Road', 'Wells', 'Gate', 'Dunes', 'Hour', 'Feast', 'Tears', 'Engines', 'Bargain', 'Flag', 'Storm', 'Promise', 'Toll'];

function place(sim, ctx) {
  if (ctx.b) return ctx.b.name;
  if (ctx.z) return ctx.z.name;
  return 'the wastes';
}
const N = (f) => (f ? f.name : 'someone');
const pick = (sim, arr) => sim.rng.pick(arr);

P.writeChronicle = function (kind, ctx) {
  const L = (f) => this.leaderName(f);
  const zoneName = (b) => (b ? this.zoneDef(b.zoneId)?.name : '');
  const R = (r) => (r ? RES_INFO[r].name.toLowerCase() : '');
  let title, text, importance = 1, tags = [kind];
  const fac = [];
  switch (kind) {
    case 'war': {
      const { a, b, market, res } = ctx;
      fac.push(a.id, b.id);
      title = pick(this, [`${a.short} Declares War on ${b.short}`, `The ${a.short}-${b.short} War Begins`, `Drums Over ${this.zoneDef(this.capital(b.id)?.zoneId || '')?.name || 'the Waste'}`]);
      text = market && res
        ? pick(this, [`${L(a)} looked at the falling price of ${R(res)} and decided the market had one seller too many. The ${a.name} declared war on the ${b.name}.`, `"There is only room for one ${R(res)} baron in this desert," said ${L(a)}. The ${b.name} were not consulted.`])
        : pick(this, [`${L(a)} of the ${a.name} declared war on the ${b.name}. "${pick(this, a.quotes.length ? a.quotes : ['Enough talk.'])}"`, `Old grudges boiled over. The ${a.name} are at war with the ${b.name}.`]);
      importance = 2;
      break;
    }
    case 'march': {
      const { f, b, other, sq, market } = ctx;
      fac.push(f.id, other?.id);
      title = `${f.short} March on ${b.name}`;
      text = `A ${f.short} warband of ${sq.members.length} cars rolled out toward ${b.name} in ${zoneName(b)}${market ? ', eyes on the pumps' : ''}.`;
      importance = 0;
      break;
    }
    case 'baseFell': {
      const { b, f, by, byGroup } = ctx;
      fac.push(b.factionId, by?.id);
      const who = byGroup ? (this.s.group.factionId ? this.faction(this.s.group.factionId)?.name : this.s.group.name) : by ? by.name : 'unknown raiders';
      title = pick(this, [`The Fall of ${b.name}`, `${b.name} Burns`, `The ${pick(this, ADJ)} ${pick(this, NOUN)} of ${b.name}`]);
      text = `${b.name}, ${f ? `a ${f.short} stronghold` : 'a fortified camp'} in ${zoneName(b)}, was razed by ${who}.${b.capital ? ` It was their capital. ${f ? L(f) : 'The leader'} will not forget.` : ''}`;
      importance = b.capital ? 3 : 2;
      if (byGroup) tags.push('player');
      break;
    }
    case 'claim': {
      const { f, z, conquest } = ctx;
      fac.push(f.id);
      title = conquest ? `${f.short} Seize ${z.name}` : `${f.short} Plant a Flag in ${z.name}`;
      text = conquest ? `With the old defenders gone, the ${f.name} raised their colours over ${z.name}.` : `${f.name} claimed ${z.name}, building a new outpost on its ${z.biome === 'dunes' ? 'shifting sands' : 'rough ground'}.`;
      importance = 1;
      if (f.isPlayer) { tags.push('player'); importance = 2; }
      break;
    }
    case 'outpost': {
      const { f, b, z } = ctx;
      fac.push(f.id);
      title = `${b.name} Founded`;
      text = `The ${f.short} expanded their hold on ${z.name} with a new outpost, ${b.name}.`;
      importance = 0;
      break;
    }
    case 'siegeFailed': {
      const { sq, b, f, def } = ctx;
      fac.push(f?.id, def?.id);
      title = `The Siege of ${b.name} Breaks`;
      text = `${f ? f.short : 'Raiders'} threw themselves at ${b.name} and broke. The ${def ? def.short : 'defenders'} still hold.`;
      importance = b.capital ? 1 : 0;
      void sq;
      break;
    }
    case 'truce': {
      const { a, b } = ctx;
      fac.push(a.id, b.id);
      title = `Truce Between ${a.short} and ${b.short}`;
      text = `Exhausted and short on petrol, ${L(a)} sent a white flag to ${L(b)}. The guns are quiet. For now.`;
      importance = 1;
      break;
    }
    case 'alliance': {
      const { a, b, name } = ctx;
      fac.push(a.id, b.id);
      title = `${name || 'An Alliance'} Is Signed`;
      text = `${L(a)} and ${L(b)} shook hands over a barrel of good petrol. The ${a.short} and the ${b.short} are allies — "${name}".`;
      importance = 2;
      break;
    }
    case 'betrayal': {
      const { a, b, pactName, target, byPlayer } = ctx;
      fac.push(a.id, b.id);
      title = pick(this, [`The Great Betrayal`, `The Knife at ${target ? target.name : 'Dawn'}`, `The Breaking of ${pactName || 'the Pact'}`, `${a.short} Treachery`]);
      if (this.s.chronicle.some((c) => c.title === 'The Great Betrayal')) title = `The ${pick(this, ADJ)} Betrayal of ${target ? target.name : b.short}`;
      text = byPlayer
        ? `${a.isPlayer ? 'You' : L(a)} tore up ${pactName || 'the pact'} and turned on ${b.isPlayer ? 'you' : `the ${b.name}`}. The wasteland will tell this story for years.`
        : `${L(a)} smiled, signed one more contract, and sent the ${a.short} against their own allies, the ${b.name}.${target ? ` ${target.name} was the first to burn.` : ''} ${pactName ? `${pactName} is ash.` : ''}`;
      importance = 3;
      tags.push('betrayal');
      break;
    }
    case 'succession': {
      const { f, old, heir, cause } = ctx;
      fac.push(f.id);
      title = `${old} Is Dead`;
      text = `${old} of the ${f.name} ${cause?.byGroup ? 'fell to your guns' : cause?.coup ? 'was overthrown' : 'died in the waste'}. ${heir.title || 'The new boss'} ${heir.name} now leads, and the ${f.short} are ${f.archetype === 'Warmonger' || f.archetype === 'Conqueror' ? 'hungry for war' : f.archetype === 'Merchant' ? 'counting coins' : f.archetype === 'Protector' ? 'closing ranks' : 'unpredictable'}.`;
      importance = 3;
      break;
    }
    case 'coup': {
      const { f, old, heir } = ctx;
      fac.push(f.id);
      title = pick(this, [`The Coup at ${this.capital(f.id)?.name || f.short}`, `${heir.name} Takes the Wheel`, `Night of Long Wrenches`]);
      text = `${heir.name}, tired of taking orders, rallied the ${f.short} garage crews and dragged ${old} out of the command chair. ${f.name} has a new ${heir.title}. ${heir.name} is a ${f.archetype.toLowerCase()}.`;
      importance = 3;
      break;
    }
    case 'collapse': {
      const { f } = ctx;
      fac.push(f.id);
      title = `The End of the ${f.name}`;
      text = `With no walls left and no one left to pay, the ${f.name} scattered into the dunes. Some will turn up at the Hub looking for work. Most will not.`;
      importance = 3;
      break;
    }
    case 'exiled': {
      const { f } = ctx;
      title = `The ${f.short} in Exile`;
      text = `Homeless but not beaten, the ${f.name} roam the waste looking for a place to start over.`;
      importance = 1;
      break;
    }
    case 'defection': {
      const { from, to, n, count } = ctx;
      fac.push(from?.id, to?.id);
      title = `${n ? n.name : 'Drivers'} Defect${n ? 's' : ''} to the ${to ? to.short : 'Hub'}`;
      text = `${count > 1 ? `${count} drivers led by ${n.name}` : n.name} slipped away from the ${from.name} in the night${to ? ` and joined the ${to.name}` : ''}, taking their cars and every secret they knew.`;
      importance = count > 2 ? 2 : 1;
      if (to?.isPlayer) tags.push('player');
      break;
    }
    case 'recruitBetrayal': {
      const { n, to, stole } = ctx;
      title = `${n.name} Betrays Us`;
      text = `${n.name} was unpaid, unhappy and unwatched. They ${stole ? `stole ${stole} from our stores and ` : ''}drove off to ${to ? `join the ${to.name}` : 'parts unknown'}.`;
      importance = 2;
      tags.push('player', 'betrayal');
      break;
    }
    case 'event': {
      ({ title, text } = ctx);
      importance = ctx.importance ?? 1;
      if (ctx.tags) tags.push(...ctx.tags);
      if (ctx.factions) fac.push(...ctx.factions);
      break;
    }
    case 'player': {
      ({ title, text } = ctx);
      importance = ctx.importance ?? 2;
      tags.push('player');
      break;
    }
    case 'founded': {
      const { f } = ctx;
      title = `The Founding of the ${f.name}`;
      text = `${this.s.group.leaderName || 'A stranger from the Hub'} raised a new banner: the ${f.name}. "${f.motto}" Nobody took them seriously. Yet.`;
      importance = 3;
      tags.push('player');
      break;
    }
    case 'joined': {
      const { f } = ctx;
      title = `A Driver Joins the ${f.short}`;
      text = `${this.s.group.leaderName || 'The stranger'} swore to ride with the ${f.name} under ${L(f)}.`;
      importance = 1;
      tags.push('player');
      break;
    }
    default:
      return null;
  }
  return { title, text, importance, tags, factions: fac.filter(Boolean) };
};

// Epithets: the group earns titles from deeds, which NPCs and the chronicle then use.
P.addDeed = function (kind, n = 1) {
  const g = this.s.group;
  g.deeds[kind] = (g.deeds[kind] || 0) + n;
  const THRESH = { betrayer: 1, conqueror: 3, slayer: 50, trader: 5000, savior: 4, racer: 5 };
  const NAMES = {
    betrayer: ['the Backstabber', 'the Two-Faced', 'Knife-in-the-Dark'], conqueror: ['the Conqueror', 'Flag-Planter', 'Zone-Eater'],
    slayer: ['the Wrecker', 'Scrapmaker', 'Boom-Bringer'], trader: ['Goldtooth', 'the Merchant Prince'], savior: ['Shield of the Waste', 'the Kind'], racer: ['Dune-Dancer', 'the Comet'],
  };
  const t = THRESH[kind];
  if (t && g.deeds[kind] >= t && !g.epithets.some((e) => e.kind === kind)) {
    const name = this.rng.pick(NAMES[kind]);
    g.epithets.push({ kind, name, day: this.day });
    this.chronicle('player', { title: `They Call You "${name}"`, text: `Word spreads along the trade roads. Drivers who used to ignore you now call you ${name}.`, importance: 2 });
    this.emit('epithet', name);
  }
};

P.playerTitle = function () {
  const g = this.s.group;
  const e = g.epithets[g.epithets.length - 1];
  return `${g.leaderName || 'Stranger'}${e ? ' ' + e.name : ''}`;
};
