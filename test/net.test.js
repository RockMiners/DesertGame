import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/world/worldgen.js';
import { Sim } from '../src/sim/index.js';
import { DAY_LEN } from '../src/sim/defs.js';
import { packCar, unpackCar, packFast, unpackFast, packSquads, SECTIONS, buildSection, applySection, pushSample, sampleAt, FLAG } from '../src/net/protocol.js';
import { Clock } from '../src/net/net.js';

function fakeCar(x = 0, z = 0) {
  return {
    alive: true, hp: 180, triggers: [true, false], boostVisual: false, isPlayer: false, traffic: false, vip: false,
    weapons: [{ kind: 'turret', yaw: 0.5, pitch: -0.1 }],
    body: { pos: new THREE.Vector3(x, 3.25, z), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1), vel: new THREE.Vector3(20, 0, -3), controls: { steer: -0.4, throttle: 1 } },
  };
}

test('car records survive the compact wire format', () => {
  const c = fakeCar(-812.34, 455.67);
  const r = unpackCar(packCar(42, c));
  assert.equal(r.nid, 42);
  assert.ok(Math.abs(r.p[0] - c.body.pos.x) < 0.06 && Math.abs(r.p[2] - c.body.pos.z) < 0.06);
  assert.ok(Math.abs(r.q[1] - c.body.quat.y) < 0.001 && Math.abs(r.q[3] - c.body.quat.w) < 0.001);
  assert.equal(r.v[0], 20);
  assert.equal(r.hp, 180);
  assert.ok(r.f & FLAG.alive && r.f & FLAG.fire0 && !(r.f & FLAG.fire1));
  assert.ok(Math.abs(r.wy - 0.5) < 0.01 && Math.abs(r.st + 0.4) < 0.01);
  // a busy scene still fits the artifact's 4 KiB presence budget
  const recs = []; for (let i = 0; i < 40; i++) recs.push(packCar(i + 100, fakeCar(Math.random() * 3000 - 1500, Math.random() * 3000 - 1500)));
  const snap = packFast(12345.6, 987654, recs, packSquads([{ id: 'sq12', x: 10, z: -20, tx: 300, tz: 400 }]), 1234);
  assert.ok(snap.length < 3600, `40 cars took ${snap.length} bytes`);
  const back = unpackFast(snap);
  assert.equal(back.cars.length, 40);
  assert.equal(back.squads.sq12.tx, 300);
  assert.equal(back.gt, 12345.6);
  assert.equal(back.wallet, 1234);
});

test('world sections rebuild an identical game state on the client', () => {
  const world = generateWorld(1234);
  const host = new Sim(world);
  host.newGame(1234, { groupName: 'Host' });
  for (let t = 0; t < DAY_LEN * 3; t += 2) { host.cmd('playerPos', { x: 0, z: 210 }, 'host'); host.tick(2); }
  const client = new Sim(world);
  client.newGame(1234, {});
  let bytes = 0;
  for (const k of SECTIONS) { const json = JSON.stringify(buildSection(host, k)); bytes += json.length; applySection(client, k, JSON.parse(json)); }
  assert.ok(bytes < 200000, `sections are ${bytes} bytes`);
  const s = host.s, c = client.s;
  assert.equal(c.group.wallet, s.group.wallet);
  assert.deepEqual(Object.keys(c.bases).sort(), Object.keys(s.bases).sort());
  assert.deepEqual(Object.keys(c.factions).sort(), Object.keys(s.factions).sort());
  for (const f of Object.values(s.factions)) if (f.alive) assert.equal(c.factions[f.id].memberCount, host.members(f.id).length);
  assert.deepEqual(c.market, s.market);
  assert.deepEqual(c.zones, s.zones);
  for (const f of Object.values(s.factions)) if (f.leaderId && s.npcs[f.leaderId]?.alive) assert.ok(c.npcs[f.leaderId], `leader ${f.leaderId} kept`);
  // every section stays far below the 256 KiB db document limit
  for (const k of SECTIONS) assert.ok(JSON.stringify(buildSection(host, k)).length < 120000, k);
});

// Replays a car driving a curve through a lossy, jittery link and checks the client-side motion is smooth.
function replay({ hz, jitter, loss }) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const truth = (t) => ({ x: Math.sin(t * 0.4) * 200, z: t * 18, vx: Math.cos(t * 0.4) * 80, vz: 18 });
  const car = { body: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3() } };
  const clock = new Clock();
  const arrivals = [];
  for (let t = 0; t < 12; t += 1 / hz) {
    if (rnd() < loss) continue;
    arrivals.push({ at: t * 1000 + 30 + rnd() * jitter, t: t * 1000 + 5e6, tr: truth(t) });
  }
  arrivals.sort((a, b) => a.at - b.at);
  const realNow = performance.now;
  let fake = 0;
  performance.now = () => fake;
  const speeds = [];
  let prev = null, i = 0, maxErr = 0;
  try {
    for (fake = 0; fake < 12000; fake += 1000 / 60) {
      while (i < arrivals.length && arrivals[i].at <= fake) {
        const a = arrivals[i++];
        clock.see(a.t);
        pushSample(car, a.t, { p: [a.tr.x, 3, a.tr.z], q: [0, 0, 0, 1], v: [a.tr.vx, 0, a.tr.vz] });
      }
      if (!sampleAt(car, clock.now(fake))) continue;
      if (fake > 2000) {
        const p = car.body.pos;
        if (prev) speeds.push(Math.hypot(p.x - prev.x, p.z - prev.z) * 60);
        const shown = (clock.now(fake) - 5e6) / 1000;
        const tr = truth(shown);
        maxErr = Math.max(maxErr, Math.hypot(tr.x - p.x, tr.z - p.z));
      }
      prev = car.body.pos.clone();
    }
  } finally { performance.now = realNow; }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const worstStep = Math.max(...speeds.slice(1).map((v, k) => Math.abs(v - speeds[k])));
  return { mean, worstStep, maxErr, delay: clock.delay() };
}

test('replicas move smoothly over a jittery, lossy link', () => {
  for (const cfg of [{ hz: 20, jitter: 40, loss: 0.02 }, { hz: 12, jitter: 90, loss: 0.05 }]) {
    const r = replay(cfg);
    console.log('interp', JSON.stringify(cfg), 'worst step', r.worstStep.toFixed(1), 'max err', r.maxErr.toFixed(2), 'delay', r.delay.toFixed(0));
    // true speed is 18-82 m/s; a 60 fps frame-to-frame speed jump above 25 m/s reads as a visible hitch
    assert.ok(r.worstStep < 6, `${JSON.stringify(cfg)} worst frame-to-frame speed change ${r.worstStep.toFixed(1)} m/s`);
    assert.ok(r.maxErr < 3, `${JSON.stringify(cfg)} drifted ${r.maxErr.toFixed(2)} m from the true path`);
    assert.ok(r.delay < 260, `${JSON.stringify(cfg)} interpolation delay ${r.delay.toFixed(0)} ms`);
  }
});
