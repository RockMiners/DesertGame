// Fully synthesized audio: engine, weapons, explosions, cute UI blips and a generative desert soundtrack.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.musicVol = 0.35;
    this.last = {};
    this.listener = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 6;
    this.master = c.createGain(); this.master.gain.value = this.volume;
    this.sfx = c.createGain(); this.sfx.gain.value = 1;
    this.mus = c.createGain(); this.mus.gain.value = this.musicVol;
    this.sfx.connect(this.comp); this.mus.connect(this.comp);
    this.comp.connect(this.master); this.master.connect(c.destination);
    const len = c.sampleRate * 1.5;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startEngine();
    this.startMusic();
  }

  setVolume(v, m) {
    this.volume = v; this.musicVol = m;
    if (this.master) this.master.gain.value = v;
    if (this.mus) this.mus.gain.value = m;
  }

  // ---- primitives ----
  env(g, t, a, peak, dec, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(sustain, t + a + dec);
  }
  tone(type, f0, f1, dur, vol, out, t = this.ctx.currentTime, attack = 0.005) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, attack, vol, dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + attack + 0.05);
  }
  burst(dur, vol, filterType, f0, f1, out, t = this.ctx.currentTime, q = 1) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = filterType; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  spatial(pos, loud) {
    const c = this.ctx;
    const out = c.createGain();
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    let vol = 1;
    if (pos && this.listener && !loud) {
      const L = this.listener;
      const dx = pos.x - L.pos.x, dy = pos.y - L.pos.y, dz = pos.z - L.pos.z;
      const d = Math.hypot(dx, dy, dz);
      vol = 1 / (1 + d * d / 900);
      if (pan) { const right = dx * L.right.x + dz * L.right.z; pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(10, d))); }
    }
    out.gain.value = vol;
    if (pan) { out.connect(pan); pan.connect(this.sfx); } else out.connect(this.sfx);
    return { out, vol };
  }

  play(name, pos, loud = false) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const gap = { mg: 0.045, shotgun: 0.08, laser: 0.12, explosion: 0.05, crash: 0.08, smash: 0.06, flame: 0.09, zap: 0.06, land: 0.15 }[name] ?? 0.03;
    if (this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    const { out, vol } = this.spatial(pos, loud);
    if (vol < 0.02) return;
    const t = now;
    switch (name) {
      case 'mg': this.burst(0.06, 0.5, 'bandpass', 1800, 900, out, t, 1.2); this.tone('square', 220, 90, 0.04, 0.12, out, t); break;
      case 'shotgun': this.burst(0.18, 0.8, 'lowpass', 2400, 300, out, t); this.tone('sine', 140, 50, 0.15, 0.5, out, t); break;
      case 'cannon': this.burst(0.35, 0.9, 'lowpass', 1200, 80, out, t); this.tone('sine', 120, 35, 0.35, 0.9, out, t); break;
      case 'rocket': this.burst(0.4, 0.4, 'bandpass', 600, 2200, out, t, 2); break;
      case 'flame': this.burst(0.12, 0.25, 'lowpass', 900, 500, out, t); break;
      case 'laser': this.tone('sawtooth', 920, 860, 0.13, 0.12, out, t); this.tone('sine', 1840, 1700, 0.13, 0.08, out, t); break;
      case 'zap': for (let i = 0; i < 3; i++) this.tone('square', 1200 + Math.random() * 1800, 300, 0.05, 0.12, out, t + i * 0.025); break;
      case 'explosion': this.burst(0.7, 1.0, 'lowpass', 1500, 60, out, t); this.tone('sine', 90, 30, 0.5, 0.9, out, t); break;
      case 'bigexplosion': this.burst(1.3, 1.2, 'lowpass', 1800, 40, out, t); this.tone('sine', 70, 25, 0.9, 1.0, out, t); this.burst(0.3, 0.6, 'highpass', 3000, 1500, out, t + 0.05); break;
      case 'crash': this.burst(0.22, 0.7, 'bandpass', 900, 400, out, t, 0.8); this.tone('square', 300, 140, 0.12, 0.15, out, t); break;
      case 'smash': this.burst(0.18, 0.5, 'bandpass', 600, 1500, out, t, 1.5); break;
      case 'clunk': this.tone('square', 160, 80, 0.08, 0.3, out, t); break;
      case 'splat': this.burst(0.2, 0.4, 'lowpass', 500, 200, out, t); break;
      case 'honk': this.tone('square', 440, 440, 0.11, 0.22, out, t, 0.01); this.tone('square', 554, 554, 0.11, 0.18, out, t, 0.01); this.tone('square', 440, 440, 0.13, 0.22, out, t + 0.16, 0.01); this.tone('square', 554, 554, 0.13, 0.18, out, t + 0.16, 0.01); break;
      case 'boing': this.tone('sine', 180, 620, 0.18, 0.4, out, t); this.tone('sine', 620, 300, 0.2, 0.3, out, t + 0.18); break;
      case 'land': this.tone('sine', 110, 45, 0.18, 0.6, out, t); this.burst(0.15, 0.25, 'lowpass', 600, 150, out, t); break;
      case 'jump': this.burst(0.35, 0.5, 'bandpass', 400, 1800, out, t, 1.5); break;
      case 'pickup': [660, 880, 1320].forEach((f, i) => this.tone('triangle', f, f, 0.09, 0.25, out, t + i * 0.06)); break;
      case 'cash': this.tone('sine', 1320, 1320, 0.12, 0.25, out, t); this.tone('sine', 1760, 1760, 0.2, 0.2, out, t + 0.07); break;
      case 'click': this.tone('triangle', 900, 700, 0.03, 0.12, out, t); break;
      case 'offer': [523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.18, out, t + i * 0.09)); break;
      case 'accept': this.tone('triangle', 523, 523, 0.1, 0.25, out, t); this.tone('triangle', 784, 784, 0.18, 0.25, out, t + 0.09); break;
      case 'build': this.tone('square', 220, 180, 0.06, 0.2, out, t); this.tone('square', 260, 200, 0.06, 0.2, out, t + 0.12); this.burst(0.08, 0.3, 'highpass', 2000, 2000, out, t + 0.12); break;
      case 'repair': for (let i = 0; i < 4; i++) this.burst(0.03, 0.3, 'bandpass', 3000, 3000, out, t + i * 0.05, 3); break;
      case 'fanfare': [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, i === 3 ? 0.5 : 0.14, 0.18, out, t + i * 0.13)); break;
      case 'stunt': [784, 988, 1175, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.08, 0.2, out, t + i * 0.05)); break;
      case 'warn': this.tone('square', 880, 880, 0.12, 0.15, out, t); this.tone('square', 660, 660, 0.15, 0.15, out, t + 0.15); break;
      case 'die': this.tone('sawtooth', 400, 60, 1.0, 0.3, out, t); break;
      case 'checkpoint': this.tone('triangle', 988, 1318, 0.15, 0.3, out, t); break;
      default: this.tone('sine', 440, 440, 0.05, 0.1, out, t);
    }
  }

  // ---- engine loop for the player's car ----
  startEngine() {
    const c = this.ctx;
    this.eng = { o1: c.createOscillator(), o2: c.createOscillator(), f: c.createBiquadFilter(), g: c.createGain(), ng: c.createGain(), ns: c.createBufferSource(), nf: c.createBiquadFilter() };
    const e = this.eng;
    e.o1.type = 'sawtooth'; e.o2.type = 'square';
    e.f.type = 'lowpass'; e.f.frequency.value = 600; e.f.Q.value = 2;
    e.g.gain.value = 0;
    e.o1.connect(e.f); e.o2.connect(e.f); e.f.connect(e.g); e.g.connect(this.sfx);
    e.ns.buffer = this.noise; e.ns.loop = true;
    e.nf.type = 'bandpass'; e.nf.frequency.value = 1200; e.nf.Q.value = 0.6;
    e.ng.gain.value = 0;
    e.ns.connect(e.nf); e.nf.connect(e.ng); e.ng.connect(this.sfx);
    e.o1.start(); e.o2.start(); e.ns.start();
    this.gear = 1;
  }

  updateEngine(car, active) {
    if (!this.ctx || !this.eng) return;
    const e = this.eng, t = this.ctx.currentTime;
    if (!car || !active || !car.alive) { e.g.gain.setTargetAtTime(0, t, 0.1); e.ng.gain.setTargetAtTime(0, t, 0.1); return; }
    const spd = car.body.speed();
    const top = Math.max(10, car.stats.topSpeed);
    const gears = 5;
    const v = Math.min(1, spd / top);
    const gearF = v * gears;
    const rpm = car.body.groundedWheels === 0 ? Math.min(1, 0.4 + Math.abs(car.controls.throttle) * 0.6) : 0.25 + (gearF - Math.floor(gearF)) * 0.75 * (v > 0.98 ? 0 : 1) + (v > 0.98 ? 0.75 : 0);
    const pitch = car.stats.engine.pitch || 1;
    const electric = car.stats.usesEnergy || car.stats.engine.energy < 0;
    const base = (electric ? 180 : 45) * pitch * (car.stats.size > 2 ? 0.7 : 1);
    const f = base * (0.8 + rpm * 1.8) * (car.boostVisual ? 1.15 : 1);
    e.o1.frequency.setTargetAtTime(f, t, 0.04);
    e.o2.frequency.setTargetAtTime(f * (electric ? 2.01 : 0.5), t, 0.04);
    e.o1.type = electric ? 'sine' : 'sawtooth';
    e.f.frequency.setTargetAtTime(300 + rpm * 1400 + Math.abs(car.controls.throttle) * 600, t, 0.05);
    e.g.gain.setTargetAtTime(0.05 + Math.abs(car.controls.throttle) * 0.07 + (car.boostVisual ? 0.05 : 0), t, 0.05);
    const slip = car.body.groundedWheels ? car.body.slip : 0;
    e.ng.gain.setTargetAtTime(Math.min(0.25, slip * 0.4 + (spd > 5 ? 0.015 : 0)), t, 0.05);
    e.nf.frequency.setTargetAtTime(slip > 0.3 ? 2200 : 700, t, 0.1);
  }

  // ---- generative soundtrack ----
  startMusic() {
    const c = this.ctx;
    this.musT = c.currentTime + 0.5;
    this.musStep = 0;
    this.intensity = 0;
    this.night = 0;
    const drone = c.createOscillator(); drone.type = 'triangle'; drone.frequency.value = 55;
    const dg = c.createGain(); dg.gain.value = 0.05;
    const df = c.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 220;
    drone.connect(df); df.connect(dg); dg.connect(this.mus); drone.start();
    this.drone = { o: drone, g: dg };
  }

  updateMusic(intensity, night) {
    if (!this.ctx || !this.drone) return;
    this.intensity += (intensity - this.intensity) * 0.02;
    this.night = night;
    const c = this.ctx;
    const bpm = 88 + this.intensity * 40;
    const step = 60 / bpm / 2;
    const scale = [0, 3, 5, 7, 10, 12, 15, 17];
    while (this.musT < c.currentTime + 0.25) {
      const t = this.musT, s = this.musStep;
      const bar = Math.floor(s / 16) % 4;
      const root = [57, 57, 53, 55][bar];
      // plucked melody
      if (s % 2 === 0 && Math.random() < (night > 0.5 ? 0.35 : 0.6)) {
        const n = root + scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
        const f = 440 * Math.pow(2, (n - 69) / 12);
        this.tone('triangle', f, f * 0.998, 0.35, 0.09, this.mus, t, 0.003);
        this.tone('sine', f * 2, f * 2, 0.15, 0.03, this.mus, t, 0.003);
      }
      // bass
      if (s % 8 === 0) { const f = 440 * Math.pow(2, (root - 12 - 69) / 12); this.tone('triangle', f, f, 0.5, 0.12, this.mus, t, 0.01); }
      // shaker
      if (s % 2 === 1 && night < 0.5) this.burst(0.04, 0.03, 'highpass', 6000, 6000, this.mus, t);
      // combat drums
      if (this.intensity > 0.3) {
        if (s % 4 === 0) this.tone('sine', 110, 40, 0.2, 0.3 * this.intensity, this.mus, t);
        if (s % 8 === 4) this.burst(0.12, 0.15 * this.intensity, 'bandpass', 1800, 900, this.mus, t);
      }
      this.musT += step;
      this.musStep++;
    }
    this.drone.o.frequency.setTargetAtTime(55 * (this.musStep % 128 < 64 ? 1 : 0.94), c.currentTime, 2);
  }

  setListener(cam) {
    if (!this.listener) this.listener = { pos: { x: 0, y: 0, z: 0 }, right: { x: 1, z: 0 } };
    this.listener.pos = cam.position;
    const e = cam.matrixWorld.elements;
    this.listener.right = { x: e[0], z: e[2] };
  }
}
