// Visual representation of a car: body, turrets, instanced wheels, lights, squash & stretch.
import * as THREE from 'three';
import { carGeometry, weaponGeometry, wheelGeometry, vcMat } from './models.js';
import { outlineGeometry, outlineMat } from './toon.js';

const _m = new THREE.Matrix4(), _rootM = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0);

export class WheelPool {
  constructor(scene, cap = 800) {
    const geo = wheelGeometry();
    this.mesh = new THREE.InstancedMesh(geo, vcMat(), cap);
    this.ol = new THREE.InstancedMesh(outlineGeometry(geo), outlineMat(0.06), cap);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false; this.ol.frustumCulled = false;
    this.mesh.count = 0; this.ol.count = 0;
    this.cap = cap;
    scene.add(this.mesh, this.ol);
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(matrix) {
    if (this.n >= this.cap) return;
    this.mesh.setMatrixAt(this.n, matrix);
    this.ol.setMatrixAt(this.n, matrix);
    this.n++;
  }
  end() {
    this.mesh.count = this.n; this.ol.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true; this.ol.instanceMatrix.needsUpdate = true;
  }
}

let _coneGeo = null;
function lightConeGeo() {
  if (_coneGeo) return _coneGeo;
  _coneGeo = new THREE.ConeGeometry(3.2, 14, 12, 1, true);
  _coneGeo.translate(0, -7, 0);
  _coneGeo.rotateX(-Math.PI / 2);
  return _coneGeo;
}
const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });

let _shieldGeo = null;
const shieldMat = new THREE.MeshBasicMaterial({ color: 0x9be7ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });

export class CarView {
  constructor(scene, car) {
    this.scene = scene;
    this.car = car;
    this.root = new THREE.Group();
    this.bounce = new THREE.Group();
    this.root.add(this.bounce);
    scene.add(this.root);
    this.squash = 0; this.squashVel = 0;
    this.build();
  }

  build() {
    const car = this.car;
    this.bounce.clear();
    const geo = carGeometry(car.design, car.stats);
    const thick = 0.045 * Math.sqrt(car.stats.size);
    this.body = new THREE.Mesh(geo, vcMat());
    this.body.castShadow = true; this.body.receiveShadow = true;
    this.bodyOl = new THREE.Mesh(outlineGeometry(geo), outlineMat(thick));
    this.bounce.add(this.body, this.bodyOl);
    this.turrets = [];
    const sc = Math.min(2.2, 0.85 + car.stats.size * 0.25);
    for (const w of car.weapons) {
      const mount = car.stats.mounts[w.mount];
      const yawG = new THREE.Group();
      yawG.position.set(...mount.pos);
      const pitchG = new THREE.Group();
      yawG.add(pitchG);
      const wg = weaponGeometry(w.def.id, sc);
      const m = new THREE.Mesh(wg, vcMat());
      m.castShadow = true;
      const ol = new THREE.Mesh(outlineGeometry(wg), outlineMat(0.04));
      pitchG.add(m, ol);
      if (mount.kind === 'rear') yawG.rotation.y = Math.PI;
      this.bounce.add(yawG);
      this.turrets.push({ w, yawG, pitchG, recoil: 0 });
    }
    this.cones = [];
    const ch = car.stats.chassis;
    for (const sx of [-1, 1]) {
      const c = new THREE.Mesh(lightConeGeo(), coneMat);
      c.position.set(sx * ch.wid * 0.3, 0.5, ch.len / 2);
      c.scale.setScalar(Math.sqrt(car.stats.size));
      c.visible = false;
      this.bounce.add(c);
      this.cones.push(c);
    }
    if (!_shieldGeo) _shieldGeo = new THREE.SphereGeometry(1, 16, 12);
    this.shield = new THREE.Mesh(_shieldGeo, shieldMat);
    this.shield.scale.set(ch.wid * 0.85, ch.hei * 1.1, ch.len * 0.65);
    this.shield.position.y = ch.hei * 0.4;
    this.shield.visible = false;
    this.bounce.add(this.shield);
    this.flash = 0;
  }

  setVisible(v) { this.root.visible = v; }

  update(dt, wheelPool, night, interpPos, interpQuat) {
    const car = this.car;
    const b = car.body;
    this.root.position.copy(interpPos || b.pos);
    this.root.quaternion.copy(interpQuat || b.quat);
    // squash & stretch spring
    for (const e of b.events) if (e.type === 'land') this.squashVel -= Math.min(6, e.speed * 0.35);
    this.squashVel += (-this.squash * 90 - this.squashVel * 9) * dt;
    this.squash += this.squashVel * dt;
    const sq = Math.max(-0.35, Math.min(0.35, this.squash));
    this.bounce.scale.set(1 - sq * 0.4, 1 + sq, 1 - sq * 0.4);
    // body lean from suspension
    const lean = b.steerAngle * Math.min(1, b.speed() / 20) * 0.12;
    this.bounce.rotation.z = lean;
    this.bounce.position.y = car.boostVisual ? Math.sin(performance.now() * 0.05) * 0.03 : 0;
    // turrets
    for (const t of this.turrets) {
      t.yawG.rotation.y = t.w.def.kinds && t.w.kind === 'rear' ? Math.PI : t.w.yaw;
      t.pitchG.rotation.x = -t.w.pitch;
      t.recoil = Math.max(0, t.recoil - dt * 6);
      t.pitchG.position.z = -t.recoil * 0.25;
      if (t.w.justFired) { t.recoil = 1; t.w.justFired = false; }
    }
    // wheels
    if (!car.design || car.design.wheels !== 'tracks') {
      const R = b.wheelR, W = car.stats.chassis.wheelW;
      const hover = car.design.wheels === 'hover';
      _rootM.compose(this.root.position, this.root.quaternion, _one);
      if (!hover) for (const w of b.wheels) {
        const ext = w.contact ? b.rest + R - w.compression : b.rest + R;
        _v.copy(w.local); _v.y -= ext - R;
        _v.multiply(this.bounce.scale);
        _q.setFromAxisAngle(AXIS_Y, w.steer ? -b.steerAngle : 0);
        _q2.setFromAxisAngle(AXIS_X, w.spin);
        _q.multiply(_q2);
        _s.set(W, R, R);
        _m.compose(_v, _q, _s);
        _m.premultiply(_rootM);
        wheelPool.push(_m);
      }
    }
    for (const c of this.cones) c.visible = night > 0.5 && car.alive;
    this.shield.visible = car.shieldFlash > 0;
    if (this.shield.visible) shieldMat.opacity = 0.1 + car.shieldFlash * 0.3;
    // hit flash: tint body material emissive briefly
    if (car.hitFlash > 0) {
      if (!this.flashMat) { this.flashMat = vcMat().clone(); this.flashMat.emissive = new THREE.Color(0xffffff); }
      this.flashMat.emissiveIntensity = car.hitFlash * 0.45;
      this.body.material = this.flashMat;
    } else this.body.material = vcMat();
  }

  dispose() {
    this.scene.remove(this.root);
    if (this.flashMat) this.flashMat.dispose();
  }
}
