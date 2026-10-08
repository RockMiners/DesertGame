import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/worldgen.js';
import { Sim } from '../src/sim/index.js';
import { DAY_LEN } from '../src/sim/defs.js';

const world = generateWorld(1234);

test('strategic sim runs 20 days without errors and produces history', () => {
  const sim = new Sim(world);
  sim.newGame(1234, { groupName: 'Test' });
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const events = {};
  sim.on('storyEvent', (id) => (events[id] = (events[id] || 0) + 1));
  try {
    for (let t = 0; t < DAY_LEN * 20; t += 1) {
      sim.cmd('playerPos', { x: 0, z: 210 }, 'host');
      sim.tick(1);
    }
  } finally { console.error = origErr; }
  assert.deepEqual(errors, []);
  const s = sim.s;
  const alive = Object.values(s.factions).filter((f) => f.alive && !f.bandit);
  console.log('day', sim.day, 'factions alive', alive.map((f) => `${f.short}(${sim.members(f.id).length}m,${sim.factionBases(f.id).length}b,${Math.round(f.treasury)}c)`).join(' '));
  console.log('stats', JSON.stringify(s.stats), 'chronicle', s.chronicle.length, 'events', JSON.stringify(events));
  console.log('pacts', Object.entries(s.pacts).map(([k, p]) => `${k}:${p.type}`).join(' '));
  console.log('prices', Object.keys(s.market.stock).map((r) => `${r}=${s.market.hist[r].at(-1)}`).join(' '));
  for (const c of s.chronicle.slice(-25)) console.log(`  D${c.day} [${c.kind}] ${c.title} — ${c.text.slice(0, 110)}`);
  assert.ok(s.chronicle.length > 15);
  assert.ok(alive.length >= 3);
  const json = JSON.stringify(sim.serialize());
  console.log('save size KB', (json.length / 1024).toFixed(0));
});

test('player can found a faction, build, hire and quest', () => {
  const sim = new Sim(world);
  sim.newGame(99, {});
  sim.s.group.wallet = 5000;
  sim.s.group.leaderName = 'Tester';
  const zone = world.zones.find((z) => z.id === 'tumbleweed');
  let spot = null;
  for (let i = 0; i < 200 && !spot; i++) { const x = zone.cx + (i % 20 - 10) * 25, z = zone.cz + (Math.floor(i / 20) - 5) * 25; if (world.terrain.zoneAt(x, z).id === zone.id && Object.values(sim.s.bases).every((b) => Math.hypot(b.x - x, b.z - z) > 120)) spot = { x, z }; }
  let r = sim.cmd('found', { name: 'The Testers', ...spot });
  assert.ok(r.ok, r.msg);
  const b = sim.s.bases[r.baseId];
  r = sim.cmd('build', { baseId: b.id, type: 'shack', ...sim.findSpot(b, 'shack') });
  assert.ok(r.ok, r.msg);
  r = sim.cmd('build', { baseId: b.id, type: 'garage', ...sim.findSpot(b, 'garage') });
  assert.ok(r.ok, r.msg);
  const recruit = sim.s.recruitPool[0];
  r = sim.cmd('hire', { npcId: recruit });
  assert.ok(r.ok, r.msg);
  r = sim.cmd('giveDesign', { npcId: recruit, index: 0, baseId: b.id });
  assert.ok(r.ok, r.msg);
  r = sim.cmd('quest', { npcIds: [recruit], task: { type: 'scavenge', zoneId: 'tumbleweed' } });
  assert.ok(r.ok, r.msg);
  r = sim.cmd('saveBlueprint', { baseId: b.id, name: 'starter' });
  assert.ok(r.ok, r.msg);
  for (let t = 0; t < DAY_LEN; t += 1) sim.tick(1);
  assert.ok(sim.s.bases[b.id], 'base survives day 1');
});
