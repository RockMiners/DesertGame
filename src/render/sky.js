// Sky dome, sun/moon, stars, clouds, fog and lighting driven by time of day.
import * as THREE from 'three';
import { lerp, smoothstep, RNG } from '../core/math.js';
import { toonMat } from './toon.js';

// time: 0 = midnight, 0.25 = 6:00, 0.5 = noon, 0.75 = 18:00
const KEYS = [
  { t: 0.0, top: 0x0b1638, hor: 0x283a6e, sun: 0x6f7fb8, sunI: 0.35, hemi: 0.45, fog: 0x1c2850 },
  { t: 0.2, top: 0x16224d, hor: 0x3b4a80, sun: 0x8090c8, sunI: 0.35, hemi: 0.5, fog: 0x2a3866 },
  { t: 0.26, top: 0x5b7fc4, hor: 0xffb38a, sun: 0xffb27a, sunI: 1.4, hemi: 0.8, fog: 0xf0b9a0 },
  { t: 0.34, top: 0x4fa3e6, hor: 0xc9ecff, sun: 0xfff1d6, sunI: 2.6, hemi: 1.15, fog: 0xcdeaf7 },
  { t: 0.5, top: 0x3d9be9, hor: 0xc4ebff, sun: 0xffffff, sunI: 2.9, hemi: 1.25, fog: 0xc9e9f7 },
  { t: 0.68, top: 0x4b98dc, hor: 0xd4ecf6, sun: 0xfff0d0, sunI: 2.5, hemi: 1.1, fog: 0xd0e6ef },
  { t: 0.75, top: 0x3e4fa0, hor: 0xff8a65, sun: 0xff9a5a, sunI: 1.4, hemi: 0.75, fog: 0xe89a7e },
  { t: 0.8, top: 0x1d2a5c, hor: 0x4a3f7a, sun: 0x8a80c0, sunI: 0.4, hemi: 0.5, fog: 0x2f3466 },
  { t: 1.0, top: 0x0b1638, hor: 0x283a6e, sun: 0x6f7fb8, sunI: 0.35, hemi: 0.45, fog: 0x1c2850 },
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function sample(t) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const mix = (x, y) => _c1.set(x).lerp(_c2.set(y), k).getHex();
  return { top: mix(a.top, b.top), hor: mix(a.hor, b.hor), sun: mix(a.sun, b.sun), fog: mix(a.fog, b.fog), sunI: lerp(a.sunI, b.sunI, k), hemi: lerp(a.hemi, b.hemi, k) };
}

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.uniforms = { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, night: { value: 0 } };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){ float h = clamp(vDir.y,0.0,1.0); vec3 c = mix(hor, top, pow(h, 0.55));
          float sd = max(dot(normalize(vDir), sunDir), 0.0);
          c += sunCol * (smoothstep(0.9975,0.999,sd)*1.2 + pow(sd, 18.0)*0.25);
          vec3 md = -sunDir; float m = max(dot(normalize(vDir), md), 0.0);
          c += vec3(0.9,0.95,1.0) * smoothstep(0.9985,0.9992,m) * night;
          vec3 g = floor(vDir*220.0); float s = hash(g); c += vec3(step(0.996, s)) * night * smoothstep(0.0,0.3,h) * (0.6+0.4*sin(s*80.0));
          if (vDir.y < 0.0) c = hor;
          gl_FragColor = vec4(c,1.0); }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0xd9a066, 1.1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0xc9e9f7, 250, 900);

    // puffy clouds
    this.clouds = new THREE.Group();
    const rng = new RNG(77);
    const cloudMat = toonMat(0xffffff, { noCache: true });
    this.cloudMat = cloudMat;
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Group();
      const n = rng.int(3, 6);
      for (let k = 0; k < n; k++) {
        const s = rng.range(18, 34);
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), cloudMat);
        m.position.set(k * 22 - n * 11 + rng.range(-6, 6), rng.range(-4, 6), rng.range(-10, 10));
        m.scale.y = 0.6;
        c.add(m);
      }
      c.position.set(rng.range(-1800, 1800), rng.range(230, 330), rng.range(-1800, 1800));
      c.userData.speed = rng.range(2, 5);
      this.clouds.add(c);
    }
    scene.add(this.clouds);
    this.state = sample(0.4);
    this.sunDir = new THREE.Vector3();
    this.nightness = 0;
  }

  update(dt, timeOfDay, focus) {
    const s = sample(timeOfDay);
    this.state = s;
    const ang = (timeOfDay - 0.25) * Math.PI * 2; // sunrise at horizon
    this.sunDir.set(Math.cos(ang) * 0.75, Math.sin(ang), 0.45).normalize();
    const isNight = this.sunDir.y < 0.02;
    this.nightness = 1 - smoothstep(-0.12, 0.12, this.sunDir.y);
    const lightDir = isNight ? this.sunDir.clone().negate() : this.sunDir;
    this.uniforms.top.value.set(s.top);
    this.uniforms.hor.value.set(s.hor);
    this.uniforms.sunDir.value.copy(this.sunDir);
    this.uniforms.sunCol.value.set(s.sun);
    this.uniforms.night.value = this.nightness;
    this.hemi.intensity = s.hemi;
    this.hemi.color.set(s.top).lerp(_c1.set(0xffffff), 0.55);
    this.hemi.groundColor.set(0xd9a066).lerp(_c1.set(0x222244), this.nightness * 0.8);
    this.sun.color.set(s.sun);
    this.sun.intensity = s.sunI;
    this.scene.fog.color.set(s.fog);
    // shadow camera follows focus, snapped to texels to avoid shimmering
    const snap = 190 / 2048;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + lightDir.x * 300, focus.y + Math.max(0.15, lightDir.y) * 300, fz + lightDir.z * 300);
    this.dome.position.copy(focus);
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > focus.x + 2000) c.position.x -= 4000;
      if (c.position.x < focus.x - 2000) c.position.x += 4000;
    }
    this.cloudMat.color.set(0xffffff).lerp(_c1.set(s.hor), 0.35).multiplyScalar(1 - this.nightness * 0.6);
  }
}
