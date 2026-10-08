// Procedural cartoon portraits for leaders and recruits.
import { RNG } from '../core/math.js';

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a1665e', '#7fd18b', '#b9a3e3'];
const HAIR = ['#2b1d14', '#6b4423', '#d9a441', '#c0392b', '#ecf0f1', '#8e44ad', '#16a085', '#f39c12'];
const cache = new Map();

export function portrait(seed, bg = '#ffd166', size = 96, opts = {}) {
  const key = `${seed}|${bg}|${size}|${opts.glow ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const r = new RNG(seed >>> 0 || 1);
  const s = size / 100;
  x.scale(s, s);
  // background
  x.fillStyle = bg; x.fillRect(0, 0, 100, 100);
  x.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(r.range(0, 100), r.range(0, 100), r.range(6, 18), 0, 7); x.fill(); }
  const skin = opts.glow ? '#9cff7a' : r.pick(SKIN);
  const hair = r.pick(HAIR);
  const outline = '#2b1d14';
  x.lineWidth = 3; x.strokeStyle = outline;
  // shoulders
  x.fillStyle = r.pick(['#3a3a44', '#6b4f3a', '#264653', '#8d99ae', '#e76f51']);
  x.beginPath(); x.ellipse(50, 108, 40, 30, 0, 0, Math.PI * 2); x.fill(); x.stroke();
  // head
  const hw = r.range(25, 32), hh = r.range(28, 34);
  x.fillStyle = skin;
  x.beginPath(); x.ellipse(50, 52, hw, hh, 0, 0, Math.PI * 2); x.fill(); x.stroke();
  // ears
  x.beginPath(); x.ellipse(50 - hw, 54, 5, 8, 0, 0, 7); x.fill(); x.stroke();
  x.beginPath(); x.ellipse(50 + hw, 54, 5, 8, 0, 0, 7); x.fill(); x.stroke();
  // hair / hat
  const top = r.int(0, 5);
  x.fillStyle = hair;
  if (top === 0) { x.beginPath(); x.ellipse(50, 30, hw * 0.95, 14, 0, Math.PI, 0); x.fill(); x.stroke(); }
  else if (top === 1) { for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(44 + i * 3, 30); x.lineTo(50 + i * 3, 4 + Math.abs(i) * 4); x.lineTo(56 + i * 3, 30); x.fill(); x.stroke(); } }
  else if (top === 2) { x.fillStyle = r.pick(['#e63946', '#3a86ff', '#ffd166', '#2a9d8f']); x.beginPath(); x.ellipse(50, 30, hw + 3, 12, 0, Math.PI, 0); x.fill(); x.stroke(); x.fillRect(50 - hw - 6, 28, hw * 2 + 12, 6); x.strokeRect(50 - hw - 6, 28, hw * 2 + 12, 6); }
  else if (top === 3) { x.fillStyle = '#8d99ae'; x.beginPath(); x.ellipse(50, 34, hw + 2, 18, 0, Math.PI, 0); x.fill(); x.stroke(); x.fillStyle = '#c0392b'; x.fillRect(46, 14, 8, 6); }
  else if (top === 4) { x.beginPath(); x.ellipse(50, 28, hw * 0.8, 10, 0, Math.PI, 0); x.fill(); x.stroke(); x.beginPath(); x.ellipse(50 + hw * 0.7, 40, 8, 18, 0.3, 0, 7); x.fill(); x.stroke(); }
  // goggles or eyes
  const eyeY = r.range(48, 54);
  if (r.chance(0.35)) {
    x.fillStyle = '#3a3a44'; x.fillRect(50 - hw, eyeY - 4, hw * 2, 6);
    for (const ex of [38, 62]) { x.fillStyle = r.pick(['#7fd3ef', '#ffd166', '#ff8fab']); x.beginPath(); x.arc(ex, eyeY, 9, 0, 7); x.fill(); x.stroke(); x.fillStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.arc(ex - 3, eyeY - 3, 3, 0, 7); x.fill(); }
  } else {
    for (const ex of [40, 60]) { x.fillStyle = '#fff'; x.beginPath(); x.ellipse(ex, eyeY, 6, 7, 0, 0, 7); x.fill(); x.stroke(); x.fillStyle = outline; x.beginPath(); x.arc(ex + r.range(-1.5, 1.5), eyeY + 1, 3, 0, 7); x.fill(); }
    if (r.chance(0.3)) { x.fillStyle = '#2b1d14'; x.fillRect(53, eyeY - 8, 14, 13); }
  }
  // brows
  x.lineWidth = 3.5;
  const angry = r.next() * 6 - 3;
  x.beginPath(); x.moveTo(34, eyeY - 10 + angry); x.lineTo(46, eyeY - 10 - angry); x.stroke();
  x.beginPath(); x.moveTo(54, eyeY - 10 - angry); x.lineTo(66, eyeY - 10 + angry); x.stroke();
  // nose
  x.lineWidth = 3; x.fillStyle = skin;
  x.beginPath(); x.ellipse(50, eyeY + 9, 5, 4, 0, 0, 7); x.fill(); x.stroke();
  // mouth
  const m = r.int(0, 3);
  x.beginPath();
  if (m === 0) { x.arc(50, eyeY + 15, 9, 0.2, Math.PI - 0.2); x.stroke(); }
  else if (m === 1) { x.moveTo(41, eyeY + 20); x.lineTo(59, eyeY + 19); x.stroke(); }
  else if (m === 2) { x.fillStyle = '#7a2e2e'; x.ellipse(50, eyeY + 20, 7, 5, 0, 0, 7); x.fill(); x.stroke(); }
  else { x.arc(50, eyeY + 15, 9, 0.2, Math.PI - 0.2); x.stroke(); x.fillStyle = '#fff'; x.fillRect(46, eyeY + 18, 4, 4); }
  // beard / scar / bandana
  const extra = r.int(0, 4);
  if (extra === 0) { x.fillStyle = hair; x.beginPath(); x.ellipse(50, eyeY + 26, hw * 0.8, 10, 0, 0, Math.PI); x.fill(); x.stroke(); }
  else if (extra === 1) { x.strokeStyle = '#a33'; x.beginPath(); x.moveTo(62, eyeY - 4); x.lineTo(70, eyeY + 10); x.stroke(); }
  else if (extra === 2) { x.fillStyle = r.pick(['#e63946', '#3a86ff', '#2a9d8f']); x.beginPath(); x.moveTo(50 - hw, eyeY + 12); x.lineTo(50 + hw, eyeY + 12); x.lineTo(50, eyeY + 34); x.closePath(); x.fill(); x.stroke(); }
  // frame
  x.lineWidth = 6; x.strokeStyle = outline; x.strokeRect(0, 0, 100, 100);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
