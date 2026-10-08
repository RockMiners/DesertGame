// Fairness director for real-time combat: attack tokens, mercy, difficulty, "main character" boosts.
export const DIFFICULTY = {
  chill: { name: 'Chill', taken: 0.55, dealt: 1.3, tokens: 2, aim: 1.6, turret: 0.6 },
  normal: { name: 'Normal', taken: 0.8, dealt: 1.12, tokens: 3, aim: 1.15, turret: 0.8 },
  brutal: { name: 'Brutal', taken: 1.1, dealt: 1.0, tokens: 5, aim: 0.9, turret: 1.0 },
};

export class Director {
  constructor(game, difficulty = 'normal') {
    this.game = game;
    this.setDifficulty(difficulty);
    this.tokens = new Set();
    this.t = 0;
  }
  setDifficulty(d) { this.diffKey = DIFFICULTY[d] ? d : 'normal'; this.diff = DIFFICULTY[this.diffKey]; }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const g = this.game;
    const p = g.player?.car;
    this.tokens.clear();
    if (!p || !p.alive) return;
    const attackers = g.cars.filter((c) => c.ai && c.alive && c.ai.target && (c.ai.target.isPlayer || c.ai.target.isRemotePlayer));
    attackers.sort((a, b) => a.body.pos.distanceTo(p.body.pos) - b.body.pos.distanceTo(p.body.pos));
    const n = this.diff.tokens + (p.stats.size > 2 ? 1 : 0);
    for (let i = 0; i < Math.min(n, attackers.length); i++) this.tokens.add(attackers[i].id);
  }

  hasToken(car) { return this.tokens.has(car.id); }
  playerTargetBias() { return this.tokens.size >= this.diff.tokens ? 1.6 : 1; }

  mercy() {
    const p = this.game.player?.car;
    if (!p) return 1;
    const f = p.hp / p.stats.hp;
    return f < 0.25 ? 0.6 : f < 0.5 ? 0.85 : 1;
  }
  accuracyMult() { return this.diff.aim / this.mercy(); }
  turretAccuracy() { return this.diff.turret * this.mercy(); }

  damageMult(target, source) {
    let m = 1;
    if (target.isPlayer) m *= this.diff.taken * this.mercy();
    if (source && (source.isPlayer || source.isRemotePlayer)) m *= this.diff.dealt;
    // allies fighting alongside the player get a morale boost — you are the main character
    const p = this.game.player?.car;
    if (source && source.ai && p && !this.game.hostile(source, p) && source.body.pos.distanceTo(p.body.pos) < 120) m *= 1.2;
    return m;
  }
}
