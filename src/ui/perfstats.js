// F3 performance readout: frame rate, frame-time spikes, render resolution and co-op timing.
// Measures wall-clock time between frames, so it shows what the player actually sees.
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

// The graphics card the browser is drawing with. "SwiftShader", "llvmpipe" or "Basic Render Driver" mean
// software rendering (hardware acceleration is off) and explain any amount of lag.
export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(name).replace(/^ANGLE \((.*)\)$/, '$1').replace(/Direct3D11 vs_5_0 ps_5_0, D3D11(-[\d.]+)?/, 'D3D11').slice(0, 90);
  } catch { return 'unknown'; }
}

 // Ask a throwaway context which GPU the browser will use, before the game creates its own
// (anti-aliasing can only be chosen at creation time).
export function probeGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

export const isSoftwareGpu = (name) => /swiftshader|llvmpipe|softpipe|basic render|software/i.test(name || '');

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
    if (r && !this.gpu) this.gpu = gpuName(r);
    const lines = [
      `${Math.round(1000 / avg)} fps   ${avg.toFixed(1)} ms avg   ${worst.toFixed(0)} ms worst`,
      `render ${c?.width}x${c?.height} (${mp.toFixed(1)} MP)  ratio ${r?.getPixelRatio().toFixed(2)}  fx ${(g?.fx?.quality ?? 1).toFixed(2)}`,
      `draw calls ${info?.calls ?? '?'}  cars ${g?.cars.length ?? 0}`,
      `gpu ${this.gpu || '?'}${isSoftwareGpu(this.gpu) ? '  <- SOFTWARE: no graphics card in use' : ''}`,
      `build ${BUILD}`,
    ];
    const net = this.app.net;
    if (net) {
      const ms = (v) => (v ? `${Math.round(v)} ms` : '…');
      if (net.isClient) lines.push(`co-op (${net.kind}) ping ${ms(net.rtt)}${net.route ? ' ' + net.route : ''}  showing host ${Math.round(net.hostClock.delay())} ms behind`);
      else {
        lines.push(`co-op (${net.kind}) host, ${net.peers.size} friend${net.peers.size === 1 ? '' : 's'}`);
        for (const p of net.peers.values()) lines.push(`  ${p.name}: ping ${ms(p.rtt)}${p.route ? ' ' + p.route : ''}`);
      }
    }
    this.el.textContent = lines.join('\n');
  }
}
