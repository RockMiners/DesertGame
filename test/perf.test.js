import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality } from '../src/render/perf.js';

function run(frameMs, seconds = 120) {
  const renderer = { pr: 1.75, getPixelRatio() { return this.pr; }, setPixelRatio(v) { this.pr = v; } };
  const fx = { quality: 1 };
  const aq = new AdaptiveQuality(renderer, { fx });
  let low = 0;
  for (let t = 0; t < seconds;) {
    const ms = frameMs(renderer.pr / 1.75, fx.quality);
    aq.update(ms / 1000);
    t += ms / 1000;
    if (t > seconds / 2 && renderer.pr < 1.7) low += ms / 1000;
  }
  return { pr: renderer.pr, fx: fx.quality, lowShare: low / (seconds / 2) };
}

test('a 30 fps cap does not drive resolution down for nothing', () => {
  const r = run(() => 33.4);
  assert.ok(r.lowShare < 0.25, `spent ${(r.lowShare * 100).toFixed(0)}% of the second minute below full resolution`);
  assert.ok(r.pr > 1.7 && r.fx > 0.95, JSON.stringify(r));
});

test('a GPU-bound machine still gets a lower resolution that helps', () => {
  const r = run((prScale) => 8 + 26 * prScale * prScale); // 34 ms at full resolution
  assert.ok(r.pr < 1.5, JSON.stringify(r));
});
