// Local player controller: input -> car controls, camera orbit, aiming, stunts.
import { clamp } from './core/math.js';

export class PlayerController {
  constructor(game) {
    this.game = game;
    this.car = null;
    this.flipCd = 0;
    this.stuntSpin = 0;
    this.stuntPitch = 0;
    this.lastHeading = 0;
    this.lastPitch = 0;
  }

  attach(car) {
    this.car = car;
    car.isPlayer = true;
    this.game.chase.initialized = false;
  }

  update(dt) {
    const g = this.game, inp = g.input, car = this.car;
    if (!car) return;
    const ctl = car.body.controls;
    if (!car.alive || g.uiBlocking) {
      ctl.throttle = 0; ctl.steer = 0; ctl.boost = 0; ctl.handbrake = car.alive ? 1 : 0;
      car.triggers[0] = car.triggers[1] = false;
      g.chase.orbit(inp.mouse.dx, inp.mouse.dy);
      return;
    }
    const pad = inp.pollGamepad();
    let thr = (inp.anyDown('KeyW', 'ArrowUp') ? 1 : 0) - (inp.anyDown('KeyS', 'ArrowDown') ? 1 : 0);
    let steer = (inp.anyDown('KeyD', 'ArrowRight') ? 1 : 0) - (inp.anyDown('KeyA', 'ArrowLeft') ? 1 : 0);
    let hb = inp.down('Space') ? 1 : 0;
    let boost = inp.anyDown('ShiftLeft', 'ShiftRight') ? 1 : 0;
    let fire0 = inp.mouseDown(0), fire1 = inp.mouseDown(2) && inp.mouse.locked;
    if (inp.down('KeyF')) fire1 = true;
    if (pad) {
      const ax = (i) => (Math.abs(pad.axes[i] || 0) > 0.15 ? pad.axes[i] : 0);
      const bt = (i) => pad.buttons[i]?.value || 0;
      if (Math.abs(ax(0)) > 0) steer = ax(0);
      const t = bt(7) - bt(6);
      if (Math.abs(t) > 0.05) thr = t;
      if (bt(0) > 0.5) hb = 1;
      if (bt(1) > 0.5 || bt(10) > 0.5) boost = 1;
      if (bt(5) > 0.5) fire0 = true;
      if (bt(4) > 0.5) fire1 = true;
      g.chase.orbit(ax(2) * 14, ax(3) * 10);
      if (pad.buttons[3]?.pressed && this.flipCd <= 0) this.flip();
    }
    // smooth keyboard steering a touch so it feels analog
    this.steerS = this.steerS ?? 0;
    this.steerS += clamp(steer - this.steerS, -dt * 7, dt * 7);
    ctl.throttle = thr;
    ctl.steer = Math.abs(steer) > 0.95 || Math.abs(steer) < 0.05 ? this.steerS : steer;
    ctl.handbrake = hb;
    ctl.boost = boost && car.stats.flags.nitro && car.nitro > 0.02 ? 1 : 0;
    ctl.pitch = thr; // in the air W/S pitch the nose
    ctl.roll = (inp.down('KeyE') ? 1 : 0) - (inp.down('KeyQ') && !car.stats.flags.jump ? 1 : 0);
    car.triggers[0] = fire0;
    car.triggers[1] = fire1;
    // camera
    g.chase.orbit(inp.mouse.dx, inp.mouse.dy);
    if (inp.hit('KeyC')) g.chase.mode = (g.chase.mode + 1) % 3;
    if (inp.mouse.wheel) g.chase.dist = clamp(g.chase.dist + inp.mouse.wheel * 1.2, 5, 20);
    // jump jets
    if (inp.hit('KeyQ') && car.stats.flags.jump && car.jumpCd <= 0 && car.energy >= 15) {
      car.energy -= 15;
      car.jumpCd = 1.2;
      car.body.vel.y += 11 + 3 / Math.sqrt(car.stats.size);
      car.body.vel.addScaledVector(car.body.fwd, 3);
      for (let i = 0; i < 10; i++) g.fx.flame(car.body.pos.x, car.body.pos.y, car.body.pos.z, (Math.random() - 0.5) * 6, -8, (Math.random() - 0.5) * 6);
      g.audio?.play('jump', car.body.pos, true);
    }
    this.flipCd = Math.max(0, this.flipCd - dt);
    if (inp.hit('KeyR') && this.flipCd <= 0) this.flip();
    if (car.body.flipTimer > 3) this.flip();
    if (inp.hit('KeyH')) { g.audio?.play('honk', car.body.pos, true); g.emit('honk', car); }
    // stunts: track airtime spins and flips
    const b = car.body;
    const heading = b.heading();
    if (b.groundedWheels === 0) {
      let dh = heading - this.lastHeading;
      if (dh > Math.PI) dh -= Math.PI * 2; if (dh < -Math.PI) dh += Math.PI * 2;
      this.stuntSpin += dh;
      const pitchRate = b.angVel.dot(b.right);
      this.stuntPitch += pitchRate * dt;
    } else if (b.airTime === 0 && (this.stuntSpin || this.stuntPitch)) {
      this.stuntSpin = 0; this.stuntPitch = 0;
    }
    this.lastHeading = heading;
    for (const e of b.events) {
      if (e.type === 'land' && e.airTime > 1.0 && b.up.y > 0.6) {
        const spins = Math.floor(Math.abs(this.stuntSpin) / (Math.PI * 1.7));
        const flips = Math.floor(Math.abs(this.stuntPitch) / (Math.PI * 1.7));
        g.emit('stunt', { air: e.airTime, spins, flips });
        this.stuntSpin = 0; this.stuntPitch = 0;
      }
    }
    // aiming
    g.computeAim(car);
    if (window.app?._forceAim) { const f = window.app._forceAim; car.aimPoint.set(f.x, f.y, f.z); }
    car.aimTurrets(dt);
  }

  flip() {
    const car = this.car;
    if (car.body.up.y > 0.7 && car.body.speed() > 3) return;
    car.body.flipUpright(this.game.terrain);
    this.flipCd = 2.5;
    this.game.audio?.play('boing', car.body.pos, true);
  }
}
