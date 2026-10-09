// F3 performance readout: frame rate, frame-time spikes, render resolution and co-op timing.
// Measures wall-clock time between frames, so it shows what the player actually sees.
export class PerfStats {
  constructor(app) {
    this.app = app;
    this.times = [];
    this.t = 0;
    this.el = document.createElement('div');
    this.el.id = 'perfstats';
    this.el.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:20;pointer-events:none;font:12px/1.35 ui-monospace,Consolas,monospace;color:#e8ffe8;background:rgba(0,0,0,.62);padding:4px 10px;border-radius:8px;white-space:pre;display:none';
    document.body.appendChild(this.el);
    addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); this.toggle(); } });
    this.setVisible(!!app.settings.showStats);
  }

  toggle() {
    this.setVisible(!this.visible);
    this.app.settings.showStats = this.visible;
    this.app.saveSettings();
  }

  setVisible(v) { this.visible = v; this.el.style.display = v ? 'block' : 'none'; this.times.length = 0; this.last = 0; }

  frame() {
    if (!this.visible) return;
    // raw time between frames (the game loop clamps its own dt, which would hide big hitches)
    const now = performance.now();
    const ms = this.last ? now - this.last : 16.7;
    this.last = now;
    const dtReal = ms / 1000;
    this.times.push(ms);
    if (this.times.length > 240) this.times.shift();
    this.t += dtReal;
    if (this.t < 0.25) return;
    this.t = 0;
    const ts = this.times, n = ts.length;
    if (!n) return;
    const avg = ts.reduce((a, b) => a + b, 0) / n;
    const worst = [...ts].sort((a, b) => b - a)[Math.floor(n * 0.01)] || avg;
    const g = this.app.game, r = g?.renderer;
    const c = r?.domElement;
    const mp = c ? (c.width * c.height) / 1e6 : 0;
    const info = r?.info?.render;
    const lines = [
      `${Math.round(1000 / avg)} fps   ${avg.toFixed(1)} ms avg   ${worst.toFixed(0)} ms worst`,
      `render ${c?.width}x${c?.height} (${mp.toFixed(1)} MP)  ratio ${r?.getPixelRatio().toFixed(2)}  fx ${(g?.fx?.quality ?? 1).toFixed(2)}`,
      `draw calls ${info?.calls ?? '?'}  cars ${g?.cars.length ?? 0}`,
    ];
    const net = this.app.net;
    if (net) {
      const delay = net.isClient ? `${Math.round(net.hostClock.delay())} ms behind host` : `${net.peers.size} friend${net.peers.size === 1 ? '' : 's'}`;
      lines.push(`co-op ${net.kind} ${net.isHost ? 'host' : 'friend'}  ${delay}`);
    }
    this.el.textContent = lines.join('\n');
  }
}
