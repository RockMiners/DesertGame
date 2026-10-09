import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/worldgen.js';
import { Sim } from '../src/sim/index.js';
import { DAY_LEN, HUB_QUIET_R } from '../src/sim/defs.js';

const world = generateWorld(1234);

test('world stays readable: few squads, quiet Hub roads, convoys travel in groups', () => {
  const sim = new Sim(world);
  sim.newGame(1234, { groupName: 'Density' });
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const lonely = [], scavNearHub = [];
  sim.on('squadCreated', (sq) => {
    const f = sim.s.factions[sq.factionId];
    // the player's own route haulers are single trucks by design; AI convoys and caravans must ride as a group
    if ((sq.task.type === 'convoy' || sq.task.type === 'trade') && !f?.isPlayer && sim.members(sq.factionId).length >= 4 && sq.members.length < 2) lonely.push(`${sq.name} (${sq.members.length})`);
    if (sq.factionId === 'scavvers' && sq.task.type === 'roam' && Math.hypot(sq.x, sq.z) < HUB_QUIET_R) scavNearHub.push(`${sq.name || sq.id} at ${Math.round(Math.hypot(sq.x, sq.z))}m`);
  });
  let maxSquads = 0, maxRoam = 0, nearSum = 0, samples = 0;
  const dt = 2;
  try {
    for (let t = 0; t < DAY_LEN * 10; t += dt) {
      sim.cmd('playerPos', { x: 0, z: 210 }, 'host');
      sim.tick(dt);
      const squads = Object.values(sim.s.squads);
      maxSquads = Math.max(maxSquads, squads.length);
      maxRoam = Math.max(maxRoam, squads.filter((q) => q.factionId === 'scavvers' && q.task.type === 'roam').length);
      nearSum += squads.filter((q) => Math.hypot(q.x, q.z) < 650).length;
      samples++;
    }
  } finally { console.error = origErr; }
  const avgNear = nearSum / samples;
  console.log('day', sim.day, 'max squads', maxSquads, 'max scav roamers', maxRoam, 'avg squads near Hub', avgNear.toFixed(2));
  assert.deepEqual(errors, []);
  assert.ok(maxSquads <= 14, `too many simultaneous squads: ${maxSquads}`);
  assert.ok(avgNear <= 2, `Hub roads too busy: ${avgNear.toFixed(2)} squads on average within 650m`);
  assert.deepEqual(lonely, [], 'convoys/caravans sent without an escort');
  assert.deepEqual(scavNearHub, [], 'scavvers spawned near the Hub');
  assert.ok(maxRoam <= 4, `too many scavver gangs: ${maxRoam}`);
});
