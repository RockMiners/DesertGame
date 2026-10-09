// Adaptive quality: watches frame time and trades resolution / particle density for a steady frame rate.

// Partial GPU upload of [start, start+count) array elements. Collapses to one span if ranges pile up
// (e.g. the object was not rendered for a while) so updateRanges never grows unbounded.
export function markRange(attr, start, count) {
  if (count <= 0) return; // bufferSubData treats length 0 as "to the end"
  const r = attr.updateRanges;
  if (r.length >= 24) {
    let lo = start, hi = start + count;
    for (const u of r) { if (u.start < lo) lo = u.start; if (u.start + u.count > hi) hi = u.start + u.count; }
    r.length = 1; r[0] = { start: lo, count: hi - lo };
  } else attr.addUpdateRange(start, count);
  attr.needsUpdate = true;
}

export class AdaptiveQuality {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.fx = opts.fx || null;
    this.basePR = renderer.getPixelRatio();
    this.prFloor = opts.prFloor ?? 0.55; // fraction of base pixel ratio
    this.fxFloor = opts.fxFloor ?? 0.4; // absolute fx quality floor
    this.downMs = opts.downMs ?? 22;
    this.upMs = opts.upMs ?? 15;
    this.interval = opts.interval ?? 1.5;
    this.holdUp = opts.holdUp ?? 4;
    this.prScale = 1; this.fxScale = 1;
    this.fxBase = this.fx ? this.fx.quality : 1;
    this._fxSet = this.fxBase; this._prSet = this.basePR;
    this.avg = 16.7; // ms, EMA
    this.minAvg = 1e9; // best sustained frame time seen ~ display refresh interval
    this.t = 0; this.good = 0; this.sinceUp = 99; this.upHold = this.holdUp;
    this.grace = opts.grace ?? 3; // ignore shader-compile hitches right after load
    this.trial = null; // a step down is kept only if it actually made frames faster
    this.downBlock = 0; this.downHold = 20;
    this._enabled = opts.enabled ?? true;
  }

  get enabled() { return this._enabled; }
  set enabled(v) {
    v = !!v;
    if (v === this._enabled) return;
    this._enabled = v;
    if (!v) { this.prScale = 1; this.fxScale = 1; this.apply(); }
    this.good = 0; this.t = 0;
  }

  update(dtReal) {
    // someone else (settings menu) changed fx quality or pixel ratio: adopt it as the new base
    // adopt both outside changes before re-applying: applying after only the first would put the old
    // pixel ratio back over a new one (a graphics-setting change alters both at once)
    let outside = false;
    if (this.fx && this.fx.quality !== this._fxSet) { this.fxBase = this.fx.quality; outside = true; }
    if (this.renderer.getPixelRatio() !== this._prSet) { this.basePR = this.renderer.getPixelRatio(); outside = true; }
    if (outside) this.apply();
    if (!this._enabled) return;
    if (!(dtReal > 0) || dtReal > 0.25 || (typeof document !== 'undefined' && document.hidden)) { this.good = 0; return; }
    if (this.grace > 0) { this.grace -= dtReal; return; }
    const ms = Math.min(50, dtReal * 1000);
    this.avg += (ms - this.avg) * 0.06;
    this.minAvg = Math.min(this.minAvg, this.avg);
    this.sinceUp += dtReal;
    // pinned at a ~60 Hz vsync cap counts as "fast enough" (frame time can never drop below the refresh interval)
    const upMs = Math.max(this.upMs, Math.min(17.5, this.minAvg) * 1.08);
    this.good = this.avg < upMs ? this.good + dtReal : 0;
    this.t += dtReal;
    if (this.t < this.interval) return;
    this.t = 0;
    this.downBlock = Math.max(0, this.downBlock - this.interval);
    if (this.trial) {
      const tr = this.trial;
      this.trial = null;
      if (this.avg > tr.before * 0.9) {
        // no faster at lower quality: the frame rate is capped (30 Hz power saving, a throttled frame)
        // or the CPU is the bottleneck. Put the quality back and stop trying for a while.
        this.prScale = tr.pr; this.fxScale = tr.fx; this.apply();
        this.downBlock = this.downHold; this.downHold = Math.min(240, this.downHold * 2);
        this.good = 0;
        return;
      }
    }
    if (this.avg > this.downMs) {
      if (this.downBlock > 0) return;
      if (this.prScale <= this.prFloor && this.fxScale <= this.fxFloorScale()) return;
      // dropping right after a raise means that level is too much: wait longer before trying again
      if (this.sinceUp < this.interval * 3) this.upHold = Math.min(60, this.upHold * 2);
      this.trial = { before: this.avg, pr: this.prScale, fx: this.fxScale };
      this.prScale = Math.max(this.prFloor, this.prScale * 0.85);
      this.fxScale = Math.max(this.fxFloorScale(), this.fxScale * 0.85);
      this.good = 0;
      this.apply();
    } else if (this.good >= this.upHold && (this.prScale < 1 || this.fxScale < 1)) {
      this.prScale = Math.min(1, this.prScale * 1.1);
      this.fxScale = Math.min(1, this.fxScale * 1.1);
      this.good = 0; this.sinceUp = 0;
      this.apply();
    }
  }

  fxFloorScale() { return this.fxBase > 0 ? Math.min(1, this.fxFloor / this.fxBase) : 1; }

  apply() {
    // quantise so tiny changes don't reallocate the drawing buffer
    const pr = this.prScale >= 1 ? this.basePR : Math.max(0.25, Math.round(this.basePR * this.prScale * 20) / 20);
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 1e-3) this.renderer.setPixelRatio(pr);
    this._prSet = this.renderer.getPixelRatio();
    if (this.fx) { this._fxSet = this.fxBase * this.fxScale; this.fx.quality = this._fxSet; }
  }
}
