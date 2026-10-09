// App shell: boot, title screen, new game / continue / co-op, the main loop, saves, and glue between systems.
import * as THREE from 'three';
import { Game } from './game.js';
import { Sim } from './sim/index.js';
import { PlayerController } from './player.js';
import { Bridge } from './bridge.js';
import { Structures } from './world/structures.js';
import { Director } from './director.js';
import { UI, esc } from './ui/ui.js';
import { Audio } from './audio.js';
import { Net, NET_KIND } from './net/net.js';
import { artifactCaps, watchLobby } from './net/transports.js';
import { DEFAULT_DESIGN, CHASSIS } from './vehicle/parts.js';
import { timeOfDay, dayOf, DAY_LEN, TILE, STRUCTS } from './sim/defs.js';
import { HUB_SAFE_R } from './sim/constants.js';
import { GAME_TITLE, HISTORY, FACTION_DEFS } from './sim/lore.js';
import { lootText } from './world/pickups.js';
import { RES_INFO } from './world/biomes.js';
import { HELP_HTML } from './ui/menus.js';
import { portrait } from './ui/portrait.js';

const SAVE_KEY = 'dustbowl-save-v1';
const SETTINGS_KEY = 'dustbowl-settings-v1';

export class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = { quality: 1, volume: 0.7, music: 0.35, sens: 1, invertY: false, difficulty: 'normal', name: '', ...safeJSON(store.get(SETTINGS_KEY)) };
    this.audio = new Audio();
    this.mode = 'boot';
    this.menuOpen = false;
    this.trackedMission = null;
    this.waypoint = null;
    this.autosaveT = 120;
    this.deadT = 0;
    this.stuntCombo = 0;
    addEventListener('pointerdown', () => this.audio.init(), { once: false });
    addEventListener('keydown', () => this.audio.init(), { once: true });
  }

  // ---------- boot ----------
  async boot() {
    const params = new URLSearchParams(location.search);
    // a reload can carry instructions (new seed, continue, join) without touching the URL
    const handoff = safeJSON(session.get('dustbowl-boot'));
    session.set('dustbowl-boot', '');
    if (handoff) for (const [k, v] of Object.entries(handoff)) params.set(k, v);
    const saved = this.readSave();
    this.seed = +(params.get('seed') || saved?.seed || 1234);
    const quality = params.get('quality') ? +params.get('quality') : this.settings.quality;
    this.showLoading('Generating the wasteland…', 0.02);
    this.game = new Game(this.canvas, { quality });
    await this.game.init(this.seed, (m, p) => this.showLoading(m, p));
    this.world = this.game.world;
    this.origHeights = this.game.terrain.heights.slice();
    this.origColors = this.game.terrain.colors.slice();
    this.sim = new Sim(this.world);
    this.game.sim = this.sim;
    this.game.audio = this.audio;
    this.ui = new UI(this);
    this.game.ui = this.ui;
    this.game.diplomacy = { hostileTeams: (a, b) => this.sim.s ? this.sim.hostileTeams(a, b) : a !== b, pact: (a, b) => this.sim.s ? this.sim.pact(a, b) : null };
    this.game.director = new Director(this.game, this.settings.difficulty);
    this.game.onAttackFriendly = (team, car) => this.onAttackFriendly(team, car);
    this.player = new PlayerController(this.game);
    this.game.player = this.player;
    this.game.preStep = (dt) => { this.player.update(dt); this.net?.preStep(dt); };
    this.hookGameEvents();
    this.initCoop();
    this.hideLoading();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    if (params.get('autostart') === '1') this.startNew({ name: params.get('name') || 'Tester', color: '#ff7f50', difficulty: 'normal' });
    else if (params.get('continue') === '1' && saved) this.continueGame();
    else if (params.get('join')) {
      this.showTitle(params.get('join'));
      if (params.get('autojoin') === '1' && params.get('name')) this.doJoin(params.get('join'), params.get('name'));
    } else this.showTitle();
  }

  // Co-op availability: the hosted build always can; inside a claude.ai artifact it rides the room capability
  initCoop() {
    this.canHost = true;
    this.coopReady = Promise.resolve(true);
    // keep the world running for friends while the host's tab is in the background
    document.addEventListener('visibilitychange', () => this.onVisibility());
    if (NET_KIND !== 'room') return;
    this.canHost = null; // unknown until the artifact answers
    this.coopReady = artifactCaps().then(async (caps) => {
      this.caps = caps;
      if (!caps.room || !caps.db) { this.canHost = false; return false; }
      try { this.canHost = caps.user ? await caps.user.canEdit() : null; } catch { this.canHost = null; }
      return true;
    });
  }

  showLoading(msg, p) {
    let el = document.getElementById('loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'loading';
      el.innerHTML = `<h1 class="logo">${GAME_TITLE}</h1><div class="lbar"><i></i></div><p></p>`;
      document.body.appendChild(el);
    }
    el.querySelector('p').textContent = msg;
    el.querySelector('i').style.width = `${Math.round(p * 100)}%`;
  }
  hideLoading() { document.getElementById('loading')?.remove(); }

  // ---------- title screen ----------
  showTitle(joinCode = '') {
    this.mode = 'title';
    this.ui.show(false);
    const saved = this.readSave();
    const scr = this.ui.$('screen');
    scr.className = 'title';
    scr.innerHTML = `<div class="title-card"><h1 class="logo">${GAME_TITLE}</h1><p class="tag">A cartoon wasteland of petrol, factions and betrayal.</p>
      <div class="title-btns">
        <button data-act="new">🚗 New Game</button>
        ${saved ? `<button data-act="continue">▶ Continue <small>${esc(saved.name || '')} · Day ${saved.day || 1}</small></button>` : ''}
        <button data-act="join">🌐 Join a Friend</button>
        <button data-act="help" class="ghost">How to play</button>
      </div><div id="title-sub"></div><p class="muted small">WASD drive · mouse aim · click to fire · E interact · Esc menu</p></div>`;
    scr.classList.remove('hidden');
    scr.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      this.audio.init(); this.audio.play('click');
      const act = b.dataset.act;
      if (act === 'new') this.newGameForm();
      if (act === 'continue') this.continueGame();
      if (act === 'join') this.joinForm(joinCode);
      if (act === 'help') { this.ui.$('title-sub').innerHTML = HELP_HTML; }
      if (act === 'startNew') {
        const name = document.getElementById('ng-name').value.trim() || 'Stranger';
        this.settings.name = name;
        this.saveSettings();
        this.startNew({ name, color: document.getElementById('ng-color').value, difficulty: document.getElementById('ng-diff').value, seed: +document.getElementById('ng-seed').value || this.seed });
      }
      if (act === 'doJoin') this.doJoin(b.dataset.code || document.getElementById('jn-code').value, document.getElementById('jn-name').value.trim() || 'Friend');
    };
    if (joinCode) this.joinForm(joinCode);
  }

  newGameForm() {
    const leaders = FACTION_DEFS.map((f) => `<span class="chip" style="background:${f.color}" title="${esc(f.name)}"></span>`).join('');
    this.ui.$('title-sub').innerHTML = `<div class="form"><label>Your name <input id="ng-name" maxlength="20" value="${esc(this.settings.name || '')}" placeholder="Stranger"/></label>
      <label>Paint job <input id="ng-color" type="color" value="#ff7f50"/></label>
      <label>Difficulty <select id="ng-diff"><option value="chill">Chill — enjoy the ride</option><option value="normal" selected>Normal</option><option value="brutal">Brutal — the waste is cruel</option></select></label>
      <label>World seed <input id="ng-seed" type="number" value="${this.seed}"/></label>
      <div class="muted small">Seven factions ${leaders} already carve up the waste. Where you fit in is up to you.</div>
      <button data-act="startNew">Roll out ➜</button></div>`;
  }

  joinForm(code = '') {
    const room = NET_KIND === 'room';
    this.ui.$('title-sub').innerHTML = `<div class="form"><label>Your name <input id="jn-name" maxlength="20" value="${esc(this.settings.name || '')}"/></label>
      ${room ? '<div id="jn-games" class="games"><p class="muted small">Looking for open games…</p></div>' : ''}
      <label>${room ? 'Or type a' : 'Host\'s'} code <input id="jn-code" maxlength="8" value="${esc(code)}" placeholder="ABCDE" style="text-transform:uppercase"/></label><button data-act="doJoin">Join ➜</button>
      <p class="muted small">${room ? 'The host opens their game with Esc → Co-op → Open to friends. Their game then shows up here.' : 'Easiest: ask the host for their invite link (Esc → Co-op) and just open it.'} You'll join their crew and share their faction.</p></div>`;
    if (room) this.listGames();
  }

  async listGames() {
    this.stopLobby?.();
    const ok = await this.coopReady;
    const el = () => document.getElementById('jn-games');
    if (!ok) { if (el()) el().innerHTML = '<p class="warn">Co-op needs you to be signed in to claude.ai with access to this artifact.</p>'; return; }
    this.stopLobby = watchLobby(this.caps.room, (games) => {
      const box = el();
      if (!box) { this.stopLobby?.(); this.stopLobby = null; return; }
      if (!games) { box.innerHTML = '<p class="warn">This view can\'t use co-op. Sign in to claude.ai, and ask the owner to share the artifact with you by email (public links can\'t join).</p>'; return; }
      const list = games.filter((g) => !g.mine);
      box.innerHTML = list.length
        ? list.map((g) => `<button class="game-pick" data-act="doJoin" data-code="${esc(g.code)}">🚗 ${esc(g.host)}'s world <small>Day ${g.day} · ${g.n} driver${g.n === 1 ? '' : 's'}</small></button>`).join('')
        : '<p class="muted small">No open games yet. When a friend opens theirs it appears here.</p>';
    });
  }

  hideTitle() { const scr = this.ui.$('screen'); scr.classList.add('hidden'); scr.onclick = null; this.stopLobby?.(); this.stopLobby = null; }

  // ---------- starting ----------
  async startNew(opts) {
    if (opts.seed && opts.seed !== this.seed) { reboot({ seed: opts.seed, autostart: 1, name: opts.name }); return; }
    this.resetTerrain();
    this.settings.difficulty = opts.difficulty || 'normal';
    this.saveSettings();
    this.game.director.setDifficulty(this.settings.difficulty);
    this.playerName = opts.name;
    this.sim.newGame(this.seed, { groupName: `${opts.name}'s Crew`, paint: opts.color });
    this.sim.s.group.leaderName = opts.name;
    this.sim.cmd('setLeaderName', { name: opts.name });
    const design = { ...DEFAULT_DESIGN, paint: opts.color || DEFAULT_DESIGN.paint, name: 'Rustbucket' };
    this.startPlaying({ design, x: 0, z: 150, heading: 0 });
    this.intro();
  }

  intro() {
    const scr = this.ui.$('screen');
    scr.className = 'intro';
    const lines = HISTORY.slice(-6);
    scr.innerHTML = `<div class="intro-card"><h2>Year 41 After the Burn</h2>${lines.map((h, i) => `<p style="animation-delay:${i * 0.9}s"><b>${esc(h.title)}.</b> ${esc(h.text)}</p>`).join('')}<button data-act="go" style="animation-delay:${lines.length * 0.9}s">Start your engine</button></div>`;
    scr.classList.remove('hidden');
    this.setMenuOpen(true, 'intro');
    scr.onclick = (e) => {
      if (!e.target.closest('[data-act]')) return;
      scr.classList.add('hidden'); scr.onclick = null;
      this.setMenuOpen(false, 'intro');
      this.ui.banner('THE HUB', 'Press E inside the walls: trade, hire, upgrade', '#ffd166');
      setTimeout(() => this.tutorialOffer(), 2500);
    };
  }

  tutorialOffer() {
    const sim = this.sim;
    const m = sim.createMission({ giver: 'hub', type: 'tutorial', title: 'Scrap & Petrol', desc: 'Drive out of the Hub, scoop up 10 scrap from the junk piles in the dunes, then bring it to the Bazaar (press E in the Hub) and hand it over.', obj: { kind: 'deliver', res: 'scrap', amount: 10, baseId: null, x: 0, z: 0 }, reward: { caps: 60, items: { fuel: 15 } }, expires: sim.s.time + DAY_LEN * 5 });
    sim.offer({ from: 'hub', title: 'Welcome to the Hub, Sugar', text: `"You look like you've been driving on fumes and hope. Here's how it works: scrap's in the dunes, petrol's precious, and nobody shoots inside my walls. Bring me 10 scrap and I'll top you up. After that? Find a faction worth riding for — or start your own." — Auntie Tallow`, choices: [{ label: 'Sounds good', action: { type: 'accept', missionId: m.id } }, { label: 'I\'ll figure it out myself' }] });
  }

  startPlaying(car) {
    this.hideTitle();
    this.mode = 'play';
    this.ui.show(true);
    // world entities
    if (this.structures) { this.game.scene.remove(this.structures.group); }
    this.structures = new Structures(this.game, this.sim);
    this.game.structures = this.structures;
    for (const c of [...this.game.cars]) this.game.removeCar(c);
    if (this.bridge) this.bridge.disposed = true;
    this.bridge = new Bridge(this.game, this.sim);
    this.hookSimEvents();
    const pc = this.game.spawnCar({ id: 'player', name: this.playerName, design: car.design, team: this.sim.groupTeam(), x: car.x, z: car.z, heading: car.heading, isPlayer: true });
    if (car.hp !== undefined) { pc.hp = car.hp; pc.fuel = car.fuel; pc.ammo = car.ammo; pc.energy = car.energy; pc.cargo = { ...(car.cargo || {}) }; }
    pc.title = this.playerName;
    this.player.attach(pc);
    if (!this.headlight) {
      this.headlight = new THREE.SpotLight(0xfff1c1, 0, 140, 0.55, 0.6, 1.2);
      this.game.scene.add(this.headlight, this.headlight.target);
    }
    this.setMenuOpen(false, 'title'); // the title backdrop blocks input; release it however play starts
    this.lastTeam = this.sim.groupTeam();
  }

  // ---------- saves ----------
  readSave() { return safeJSON(store.get(SAVE_KEY)); }
  save() {
    if (this.net?.isClient || !this.sim.s) return;
    const c = this.player.car;
    const data = {
      v: 1, seed: this.seed, name: this.playerName, day: dayOf(this.sim.s.time), savedAt: Date.now(),
      sim: this.sim.serialize(),
      player: { design: c.design, hp: c.alive ? c.hp : c.stats.hp, fuel: c.fuel, ammo: c.ammo, energy: c.energy, cargo: c.cargo, x: c.body.pos.x, z: c.body.pos.z, heading: c.body.heading() },
      tracked: this.trackedMission, waypoint: this.waypoint, pickups: this.game.pickups.serialize(), difficulty: this.settings.difficulty,
    };
    if (!store.set(SAVE_KEY, JSON.stringify(data))) this.ui.toast('Could not save (browser storage unavailable or full).', 'bad');
  }
  continueGame() {
    const data = this.readSave();
    if (!data) return;
    if (data.seed !== this.seed) { reboot({ seed: data.seed, continue: 1 }); return; }
    this.resetTerrain();
    this.sim.load(data.sim);
    for (const e of this.sim.s.terrainEdits) this.game.terrain.flatten(...e);
    this.playerName = data.name;
    this.settings.difficulty = data.difficulty || this.settings.difficulty;
    this.game.director.setDifficulty(this.settings.difficulty);
    this.trackedMission = data.tracked;
    this.waypoint = data.waypoint;
    this.game.pickups.load(data.pickups);
    this.startPlaying(data.player);
    this.ui.banner(`Day ${dayOf(this.sim.s.time)}`, 'Welcome back to the waste');
  }
  loadSaved() { this.continueGame(); }
  resetTerrain() {
    const T = this.game.terrain;
    T.heights.set(this.origHeights);
    T.colors.set(this.origColors);
    for (let i = 0; i < this.game.terrainR.chunks.length; i++) T.dirtyChunks.add(i);
    this.game.terrainR.refreshDirty();
    for (const c of this.world.colliders.all) c.dead = false;
  }
  saveSettings() { store.set(SETTINGS_KEY, JSON.stringify(this.settings)); }
  applySettings() {
    this.audio.setVolume(this.settings.volume, this.settings.music);
    this.game.director.setDifficulty(this.settings.difficulty);
    this.game.fx.quality = this.settings.quality;
  }
  quitToTitle() { this.save(); reboot({}); }

  // ---------- co-op ----------
  async startHosting() {
    if (this.net || this.hosting) return;
    this.hosting = true;
    try {
      if (!(await this.coopReady)) { this.ui.toast('Co-op needs you to be signed in to claude.ai.', 'bad'); return; }
      if (this.canHost === false) { this.ui.toast('Only the owner or editors of this artifact can host.', 'bad'); return; }
      this.net = new Net(this);
      this.game.net = this.net;
      await this.net.host();
      this.ui.toast(NET_KIND === 'room' ? 'Co-op open! Friends will see your game under Join a Friend.' : 'Co-op open! Copy your invite link from this tab.', 'good');
    } catch (e) {
      console.warn('[net] host failed', e);
      this.ui.toast(`Co-op failed: ${esc(e.message || e.type || e)}`, 'bad');
      this.net?.close(); this.net = null; this.game.net = null;
    } finally { this.hosting = false; }
  }

  async doJoin(code, name) {
    code = String(code || '').toUpperCase().trim();
    if (!code) { this.ui.$('title-sub').querySelector('#jn-code')?.focus(); return; }
    if (this.joining) return;
    this.joining = true;
    this.playerName = name;
    this.settings.name = name; this.saveSettings();
    this.stopLobby?.(); this.stopLobby = null;
    this.ui.$('title-sub').innerHTML = '<p>Connecting… (loading the host\'s world can take a few seconds)</p>';
    if (!(await this.coopReady)) { this.ui.$('title-sub').innerHTML = '<p class="warn">Co-op needs you to be signed in to claude.ai with access to this artifact.</p>'; this.joining = false; return; }
    this.net = new Net(this);
    this.game.net = this.net;
    try {
      const welcome = await this.net.join(code, name);
      if (welcome.seed !== this.seed) { this.net.close(); reboot({ seed: welcome.seed, join: code, autojoin: 1, name }); return; }
      this.sim.newGame(welcome.seed, {});
      this.resetTerrain();
      this.net.applyJoinSections(welcome.sections);
      for (const e of this.sim.s.terrainEdits) this.game.terrain.flatten(...e);
      this.sim.isReplica = true;
      this.startPlaying({ design: { ...DEFAULT_DESIGN, paint: '#00bbf9', name: `${name}'s ride` }, x: 12, z: 150, heading: 0 });
      this.ui.banner('JOINED!', `You ride with ${esc(welcome.hostName || 'your friend')}`, '#00e5ff');
    } catch (e) {
      console.warn('[net] join failed', e);
      this.ui.$('title-sub').innerHTML = `<p class="warn">${esc(e.message || e.type || e)}</p><button data-act="join">Try again</button>`;
      this.net?.close(); this.net = null; this.game.net = null;
    } finally { this.joining = false; }
  }

  // ---------- host in a background tab ----------
  // Browsers stop animation frames in hidden tabs, which would freeze the world for everyone.
  // While hosting, a worker-driven timer keeps the simulation (not the rendering) going.
  onVisibility() {
    const want = document.hidden && this.net?.isHost && this.mode === 'play';
    if (want && !this.bgTicker) {
      this.bgLast = performance.now();
      this.bgTicker = makeTicker(() => this.bgTick(), 50);
    } else if (!want && this.bgTicker) {
      this.bgTicker.stop(); this.bgTicker = null;
      this.last = performance.now();
    }
  }

  bgTick() {
    if (!document.hidden || !this.net?.isHost || this.mode !== 'play') { this.onVisibility(); return; }
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.bgLast) / 1000);
    this.bgLast = now;
    if (dt <= 0) return;
    const g = this.game, sim = this.sim;
    // alone, a hidden game simply waits (as it always has); only friends keep it running
    if (!this.net.peers.size) { this.net.update(); return; }
    g.paused = false;
    sim.tick(dt);
    this.bridge.update(dt);
    g.director.update(dt);
    const pc = this.player.car;
    sim.cmd('playerPos', { x: pc.body.pos.x, z: pc.body.pos.z, name: this.playerName }, 'host');
    g.frame(dt, false);
    this.net.update();
  }
  onHostLost() { this.ui.toast('Lost connection to the host.', 'bad'); setTimeout(() => this.quitToTitle(), 3000); }

  // all player commands go through here (host executes, clients ask the host)
  async cmd(name, args) {
    if (this.net?.isClient) return this.net.request(name, args);
    const r = this.sim.cmd(name, args, 'host');
    return r;
  }

  // ---------- events ----------
  hookGameEvents() {
    const g = this.game;
    g.on('stunt', ({ air, spins, flips }) => {
      const parts = [];
      if (air > 1.5) parts.push(air > 3 ? 'MEGA AIR' : 'BIG AIR');
      if (spins) parts.push(`${spins * 360}° SPIN`);
      if (flips) parts.push(flips > 1 ? `${flips}x FLIP` : 'BACKFLIP');
      if (!parts.length) return;
      const caps = Math.round(air * 2 + spins * 6 + flips * 10);
      this.ui.stunt(parts.join(' + '), `${air.toFixed(1)}s · +${caps} caps`);
      this.audio.play('stunt');
      if (!this.net?.isClient) this.sim.s.group.wallet += caps;
      this.sim.noteStunt(air);
      if (flips + spins >= 2) this.sim.addDeed('racer', 0.2);
    });
    g.on('playerKill', (car, n, killer) => {
      // a co-op partner's kill: the group still gets the credit, only the shooter gets the fanfare
      if (killer && !killer.isPlayer) { if (!this.net?.isClient) this.creditKill(car, n); return; }
      const now = performance.now();
      this.killStreak = now - (this.lastKill || 0) < 5000 ? (this.killStreak || 1) + 1 : 1;
      this.lastKill = now;
      const words = ['WRECKED!', 'DOUBLE WRECK!', 'TRIPLE WRECK!', 'SCRAPYARD SPREE!', 'UNSTOPPABLE!'];
      this.ui.stunt(words[Math.min(words.length - 1, this.killStreak - 1)], esc(car.title || car.name));
      this.audio.play('stunt');
      if (this.net?.isClient) return;
      this.creditKill(car, n);
    });
    g.on('playerDied', (car, killer) => { if (car.isPlayer) this.onPlayerDeath(killer); });
    g.on('smash', (t) => { if (t === 'cactus' && Math.random() < 0.15) this.ui.toast('🌵 Sorry, cactus.', 'info', 'cactus'); });
    g.on('honk', () => {
      // honking in the Hub makes locals honk back
      for (const c of g.cars) if (c.traffic && c.body.pos.distanceTo(g.player.car.body.pos) < 40 && Math.random() < 0.5) setTimeout(() => this.audio.play('honk', c.body.pos), 300 + Math.random() * 500);
    });
    this.hookCollect();
  }

  creditKill(car, n) {
    const sim = this.sim;
    sim.noteKill(car.team, n);
    const f = sim.s.factions[car.team];
    if (f && !f.bandit) {
      sim.changeRep(f.id, n?.role === 'lieutenant' ? -10 : -5);
      for (const e of sim.enemies(f.id)) sim.changeRep(e.id, 2);
    }
    for (const m of Object.values(sim.s.missions)) if (m.status === 'active' && m.obj.kind === 'killNpc' && m.obj.npcId === car.npcId) this.ui.toast('Target eliminated!', 'good');
  }

  hookCollect() {
    const g = this.game;
    g.onCollect = (car, got, node) => {
      if (!car.isPlayer) return;
      this.audio.play('pickup');
      if (got.caps) { if (!this.net?.isClient) this.sim.s.group.wallet += got.caps; }
      const t = lootText(got);
      if (t) this.game.fx.floatText(car.body.pos.x, car.body.pos.y + 3, car.body.pos.z, t, '#ffe066');
      void node;
    };
  }

  hookSimEvents() {
    if (this._simHooked) return;
    this._simHooked = true;
    const sim = this.sim, ui = this.ui;
    const relay = (ev) => (...args) => { this.onSimEvent(ev, args.map(slim)); this.net?.event(ev, args.map(slim)); };
    for (const ev of ['chronicle', 'news', 'offer', 'missionComplete', 'missionFailed', 'rankUp', 'warning', 'notice', 'unlock', 'epithet', 'payday', 'unpaid', 'betrayedBy', 'checkpoint', 'carBuilt', 'recruited', 'giveItems', 'meteor', 'weather', 'teamChanged', 'nowHostile', 'coupPossible', 'missionUpdate']) sim.on(ev, relay(ev));
    void ui;
  }

  onSimEvent(ev, a) {
    const ui = this.ui, sim = this.sim;
    switch (ev) {
      case 'chronicle': ui.news(a[0]); if (a[0].importance >= 3) this.audio.play('offer'); break;
      case 'news': break;
      case 'offer': ui.offerDialog(sim.s.group.offers.find((o) => o.id === a[0].id) || a[0]); break;
      case 'missionComplete': {
        const m = a[0];
        ui.banner('JOB DONE!', `${esc(m.title)} · +${m.reward.caps || 0} caps`, '#06d6a0');
        this.audio.play('fanfare');
        // reward items arrive through the separate 'giveItems' event
        if (this.trackedMission === m.id) this.trackedMission = null;
        break;
      }
      case 'missionFailed': ui.toast(`❌ Mission failed: ${esc(a[0].title)} (${esc(a[1])})`, 'bad'); break;
      case 'missionUpdate': ui.toast(`🎯 ${esc(a[0].title)} — objective updated`, 'info', 'mu' + a[0].id); break;
      case 'rankUp': ui.banner('PROMOTED!', `You are now ${esc(a[0])} of the ${esc(a[1].short)}`, a[1].color); this.audio.play('fanfare'); break;
      case 'warning': ui.toast(`⚠️ ${esc(a[0])}`, 'bad'); this.audio.play('warn'); break;
      case 'notice': ui.toast(esc(a[0]), 'info'); break;
      case 'unlock': ui.banner('NEW PARTS UNLOCKED', esc(a[0]), '#c792ff'); this.audio.play('fanfare'); break;
      case 'epithet': ui.banner('A NEW TITLE', `They call you "${esc(a[0])}"`, '#ffd166'); break;
      case 'payday': ui.toast(`💸 Payday: ${a[0]} caps to ${a[1]} crew`, 'info'); break;
      case 'unpaid': ui.toast(`😠 ${a[0]} crew went unpaid this morning! Loyalty is dropping.`, 'bad'); this.audio.play('warn'); break;
      case 'betrayedBy': if (a[1]?.isPlayer) { ui.banner('BETRAYED!', `${esc(a[0].name)} deserted${a[2] ? ` to the ${esc(a[2].short)}` : ''}`, '#ff4d4d'); this.audio.play('warn'); } break;
      case 'checkpoint': ui.toast(`🏁 Checkpoint ${a[1]}/${a[2]}`, 'good', 'cp' + a[1]); this.audio.play('checkpoint'); break;
      case 'carBuilt': if (a[0].factionId === sim.s.group.factionId) ui.toast(`🔧 ${esc(a[1].name)}'s new car is ready at ${esc(a[0].name)}`, 'good'); break;
      case 'recruited': ui.toast(`👋 ${esc(a[0].name)} joined your crew`, 'good'); break;
      case 'giveItems': this.giveItems(a[0]); break;
      case 'meteor': ui.toast(`☄️ Starfall over ${esc(a[0].name)}! Crystals everywhere.`, 'good'); this.game.fx.shake += 0.3; break;
      case 'weather': if (a[0] === 'sandstorm') { this.sandstorm = a[1]; ui.banner('SANDSTORM', 'Visibility is dropping…', '#e9c46a'); } break;
      case 'teamChanged': this.onTeamChanged(); break;
      case 'nowHostile': { const f = sim.s.factions[a[0]]; if (f) ui.toast(`⚔️ The ${esc(f.short)} now treat you as an enemy.`, 'bad'); break; }
      case 'coupPossible': ui.toast(`👑 You are the ${esc(a[0].short)}'s Right Hand. A coup is possible (faction menu).`, 'good'); break;
    }
  }

  giveItems(items) {
    const car = this.player.car;
    const got = {};
    for (const [k, v] of Object.entries(items)) { const n = car.addCargo(k, v); if (n) got[k] = n; }
    const t = lootText(got);
    if (t) this.ui.toast(`🎁 ${t}`, 'good');
  }

  onTeamChanged() {
    const team = this.sim.groupTeam();
    const pc = this.player.car;
    if (pc) pc.team = team;
    for (const c of this.game.cars) if (c.isRemotePlayer) c.team = team;
    if (pc && this.lastTeam !== team) {
      this.lastTeam = team;
      const f = this.sim.s.factions[team];
      if (f && pc.design.paint !== f.color && this.sim.s.group.factionId) {
        // fly the colours
        const d = { ...pc.design, paint2: f.color };
        pc.setDesign(d);
      }
    }
  }
  onDesignChanged() { this.player.car.view?.build(); }

  onAttackFriendly(team, car) {
    if (!team || team === 'hub' || team === this.sim.groupTeam()) return;
    const f = this.sim.s.factions[team];
    if (!f || f.bandit) return;
    const now = this.game.time;
    if (now - (this._afT?.[team] || -99) < 3) return;
    (this._afT ||= {})[team] = now;
    if (this.net?.isClient) return;
    const rep = this.sim.s.group.rep[team] ?? 0;
    this.sim.changeRep(team, -12);
    if (rep > -35 && rep - 12 <= -35) {
      this.ui.banner('ACT OF WAR', `You opened fire on the ${esc(f.short)}`, '#ff4d4d');
      if (this.sim.s.group.factionId === team) { this.sim.cmd('leave'); this.sim.chronicle('player', { title: `Treachery in the ${f.short} Ranks`, text: `${this.sim.s.group.leaderName} turned their guns on their own faction, the ${f.name}.`, importance: 3 }); this.sim.addDeed('betrayer'); }
      const pf = this.sim.s.factions[this.sim.s.group.factionId];
      if (pf?.isPlayer && !this.sim.atWar(pf.id, f.id)) {
        const wasAlly = this.sim.pact(pf.id, f.id) === 'alliance';
        this.sim.setPact(pf.id, f.id, 'war');
        this.sim.chronicle(wasAlly ? 'betrayal' : 'war', { a: pf, b: f, byPlayer: true });
        if (wasAlly) this.sim.addDeed('betrayer');
      }
    } else if (rep > -35) this.ui.toast(`⚠️ You're shooting at the ${esc(f.short)}! Keep it up and it's war.`, 'warn', 'af' + team);
    void car;
  }

  // ---------- death & respawn ----------
  onPlayerDeath(killer) {
    this.deadT = 2.5;
    this.audio.play('die');
    this.killerName = killer ? (killer.title || killer.name) : 'the wasteland';
    // drop half the cargo where we died
    const car = this.player.car;
    const loot = {};
    for (const [k, v] of Object.entries(car.cargo)) { const n = Math.floor(v / 2); if (n) { loot[k] = n; car.takeCargo(k, n); } }
    if (Object.keys(loot).length) this.game.pickups.drop(car.body.pos.x, car.body.pos.z, loot, { life: 600 });
  }

  respawnPoint() {
    const s = this.sim.s;
    const p = s.players[this.net?.isClient ? this.net.myPid : 'host'];
    const sb = p?.sleepBase;
    const b = sb && sb !== 'hub' ? s.bases[sb] : null;
    if (b && (b.factionId === s.group.factionId || this.sim.pact(b.factionId, s.group.factionId) === 'alliance')) {
      const half = (b.size * TILE) / 2 + 12;
      return { x: b.x + half, z: b.z, name: b.name };
    }
    return { x: 0, z: 150, name: 'the Hub' };
  }

  showDeathScreen() {
    const scr = this.ui.$('screen');
    const rp = this.respawnPoint();
    scr.className = 'death';
    scr.innerHTML = `<div class="death-card"><h1>WRECKED!</h1><p>Taken out by <b>${esc(this.killerName)}</b>.</p><p class="muted">Half your cargo spilled where you crashed.</p><button data-act="respawn">Respawn at ${esc(rp.name)}</button></div>`;
    scr.classList.remove('hidden');
    this.setMenuOpen(true, 'death');
    scr.onclick = (e) => {
      if (!e.target.closest('[data-act]')) return;
      scr.classList.add('hidden'); scr.onclick = null;
      this.setMenuOpen(false, 'death');
      this.respawn(rp);
    };
  }

  respawn(rp) {
    const car = this.player.car;
    car.alive = true;
    car.hp = car.stats.hp;
    car.fuel = Math.max(car.fuel, car.stats.fuelCap * 0.5);
    car.ammo = Math.max(car.ammo, car.stats.ammoCap * 0.5);
    car.burn = 0;
    car.spawnProtect = 4;
    car.body.placeAt(rp.x, rp.z, this.game.terrain, Math.atan2(-rp.x, -rp.z));
    car.prevPos.copy(car.body.pos); car.prevQuat.copy(car.body.quat);
    this.game.chase.initialized = false;
  }

  async sleep(baseId) {
    if (baseId === 'hub' && !this.net?.isClient) this.sim.s.group.wallet -= 15;
    const r = await this.cmd('sleep', { baseId, pid: this.net?.isClient ? this.net.myPid : 'host' });
    if (r?.ok) {
      this.ui.banner('GOOD MORNING', r.msg, '#ffd166');
      const car = this.player.car;
      car.hp = car.stats.hp;
      car.energy = car.stats.energyCap;
      this.save();
    }
    return r;
  }

  startEscort(npcIds) {
    const sim = this.sim;
    const f = sim.s.factions[sim.s.group.factionId];
    if (!f) return;
    const sq = sim.createSquad(f.id, npcIds, { type: 'escort' }, { name: 'Your escort' });
    void sq;
  }

  setWaypoint(x, z) {
    this.waypoint = { x, z };
    const s = this.sim.s;
    // the waypoint behaves like a tracked pseudo-mission
    const id = 'waypoint';
    s.missions[id] = { id, title: 'Waypoint', status: 'active', giver: 'hub', reward: {}, penalty: {}, obj: { kind: 'waypoint', x, z }, desc: 'Your marker.' };
    this.trackedMission = id;
  }

  // ---------- interaction ----------
  interaction() {
    const car = this.player.car;
    if (!car || !car.alive || this.mode !== 'play') return null;
    const p = car.body.pos;
    const slow = car.body.speed() < 14;
    if (this.game.inSafeZone(p.x, p.z)) return slow ? { label: 'Visit the Hub (Bazaar, Garage, Cantina, Jobs, Inn)', act: () => this.ui.open('hub') } : null;
    const b = this.structures?.baseAt(p.x, p.z, 16);
    if (b && slow) {
      const s = this.sim.s;
      const own = b.factionId === s.group.factionId;
      const hostile = this.sim.hostileTeams(this.sim.groupTeam(), b.factionId);
      if (!hostile && !b.scav) return { label: own ? `Enter ${b.name} (build, storage, sleep)` : `Visit ${b.name} (${s.factions[b.factionId]?.short})`, act: () => this.ui.open('base', { baseId: b.id }) };
    }
    if (car.stats.bunk && slow) return { label: 'Sleep in your rig\'s bunks (skip the night anywhere)', act: () => this.sleepInRig() };
    return null;
  }

  async sleepInRig() {
    // rigs have bunks: skip the night anywhere (your respawn point stays where it was)
    const s = this.sim.s;
    const pid = this.net?.isClient ? this.net.myPid : 'host';
    await this.sleep(s.players[pid]?.sleepBase || null);
  }

  handleKeys() {
    const inp = this.game.input, ui = this.ui;
    if (inp.hit('Escape')) {
      if (ui.dialogQueue.length) return;
      if (ui.modal) ui.close(); else ui.open('pause', { tab: 'main' });
    }
    if (this.menuOpen && !ui.modal) return;
    if (ui.modal && !['map', 'journal', 'crew'].includes(ui.modal.name)) return;
    if (inp.hit('KeyM')) ui.toggle('map');
    if (inp.hit('KeyJ')) ui.toggle('journal');
    if (inp.hit('Tab')) ui.toggle('crew');
    if (ui.modal) return;
    if (inp.hit('KeyE')) { const it = this.interaction(); if (it) it.act(); }
    if (inp.hit('KeyG')) {
      const car = this.player.car, p = car.body.pos;
      const b = this.structures.baseAt(p.x, p.z, 16);
      if (this.game.inSafeZone(p.x, p.z)) ui.open('hub', { tab: 'garage' });
      else if (b && b.structs.some((x) => x.type === 'garage') && !this.sim.hostileTeams(this.sim.groupTeam(), b.factionId)) ui.open('base', { baseId: b.id, tab: 'garage' });
      else ui.toast('Find a garage: the Hub, or a friendly base with a Garage.', 'info', 'garage');
    }
    if (inp.hit('KeyB')) this.buildKey();
  }

  async buildKey() {
    const car = this.player.car, p = car.body.pos, sim = this.sim, s = sim.s;
    const b = this.structures.baseAt(p.x, p.z, 16);
    if (b && b.factionId === s.group.factionId && s.factions[b.factionId]?.isPlayer) { this.ui.open('base', { baseId: b.id, tab: 'build' }); return; }
    if (this.game.inSafeZone(p.x, p.z) || Math.hypot(p.x, p.z) < HUB_SAFE_R + 60) { this.ui.toast('No building in or right next to the Hub.', 'warn'); return; }
    const zone = this.game.terrain.zoneAt(p.x, p.z);
    const z = s.zones[zone.id];
    if (!z.claimable && z.owner !== s.group.factionId) { this.ui.toast(`${esc(zone.name)} belongs to the ${esc(s.factions[z.owner]?.short)}. Destroy all their bases here to make it claimable.`, 'warn'); return; }
    const pf = s.factions[s.group.factionId];
    if (!pf?.isPlayer) { this.ui.open('found', { x: p.x + car.body.fwd.x * 30, z: p.z + car.body.fwd.z * 30, zoneId: zone.id }); return; }
    if (!(await this.ui.ask(`Found a new base here in ${esc(zone.name)}? The HQ costs 80 scrap (bought for you if you're short).`, '⚑ Build it'))) return;
    const r = await this.cmd('newBase', { x: p.x + car.body.fwd.x * 30, z: p.z + car.body.fwd.z * 30 });
    this.ui.toast(esc(r.msg), r.ok ? 'good' : 'warn');
    if (r.ok) { this.audio.play('fanfare'); setTimeout(() => this.ui.open('base', { baseId: r.baseId, tab: 'build' }), 400); }
  }

  setMenuOpen(open, key = 'modal') {
    this.openSet = this.openSet || new Set();
    if (open) this.openSet.add(key); else this.openSet.delete(key);
    this.menuOpen = this.openSet.size > 0;
    this.game.uiBlocking = this.menuOpen;
    if (this.menuOpen) this.game.input.unlock();
    this.game.input.wantLock = !this.menuOpen;
  }

  // ---------- main loop ----------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dtReal = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.game, sim = this.sim;
    if (this.mode === 'title' || this.mode === 'boot') { this.titleFrame(dtReal); return; }
    if (this.mode !== 'play') return;
    const single = !this.net || (this.net.isHost && this.net.peers.size === 0);
    const paused = single && this.menuOpen && !(this.ui.modal && ['map', 'journal', 'crew'].includes(this.ui.modal.name) && false);
    g.paused = paused;
    const dt = paused ? 0 : dtReal;
    // sensitivity / invert
    const inp = g.input;
    inp.mouse.dx *= this.settings.sens; inp.mouse.dy *= this.settings.sens * (this.settings.invertY ? -1 : 1);
    this.handleKeys();
    if (!paused) {
      if (!this.net?.isClient) sim.tick(dt);
      this.bridge.update(dt);
      g.director.update(dt);
      // keep group players in the sim
      const pc = this.player.car;
      if (!this.net?.isClient) sim.cmd('playerPos', { x: pc.body.pos.x, z: pc.body.pos.z, name: this.playerName }, 'host');
      if (pc.team !== sim.groupTeam()) this.onTeamChanged();
    }
    g.frame(dtReal);
    const car = this.player.car;
    g.chase.update(dtReal, car, g.terrain, g.fx.shake, { aiming: inp.mouse.locked || inp.mouseDown(0) });
    g.sky.update(dtReal, timeOfDay(sim.s.time), car.body.pos);
    if (this.headlight) {
      const b = car.body, hl = this.headlight;
      hl.intensity = car.alive ? g.sky.nightness * 55 * Math.sqrt(car.stats.size) : 0;
      hl.position.copy(b.pos).addScaledVector(b.up, car.stats.chassis.hei + 0.4).addScaledVector(b.fwd, car.stats.chassis.len * 0.45);
      hl.target.position.copy(b.pos).addScaledVector(b.fwd, 40).addScaledVector(b.up, -4);
    }
    this.weather(dtReal);
    this.audio.setListener(g.camera);
    this.audio.updateEngine(car, !paused);
    const hostiles = g.cars.filter((c) => c.ai?.target === car).length;
    this.audio.updateMusic(Math.min(1, hostiles / 3), g.sky.nightness);
    this.net?.update(dtReal);
    this.ui.update(dtReal);
    // death
    if (!car.alive && this.deadT > 0) { this.deadT -= dtReal; if (this.deadT <= 0) this.showDeathScreen(); }
    // fuel warning
    if (car.stats.usesFuel && car.fuel <= 0) this.ui.toast('⛽ Out of petrol! Crawling on fumes. Pick up oil barrels or buy fuel.', 'warn', 'fuel');
    // autosave
    this.autosaveT -= dtReal;
    if (this.autosaveT <= 0) { this.autosaveT = 180; this.save(); }
    // clean waypoint when reached
    if (this.waypoint && Math.hypot(car.body.pos.x - this.waypoint.x, car.body.pos.z - this.waypoint.z) < 30) { this.waypoint = null; delete sim.s.missions.waypoint; this.ui.toast('📍 Waypoint reached', 'info'); }
  }

  weather(dt) {
    const g = this.game;
    const fog = g.scene.fog;
    let near = 250, far = 900;
    if (this.sandstorm > 0) {
      this.sandstorm -= dt;
      const k = Math.min(1, Math.min(this.sandstorm, 150 - this.sandstorm) / 10);
      near = 250 - 230 * k; far = 900 - 780 * k;
      fog.color.lerp(new THREE.Color(0xd9b382), k * 0.85);
      if (Math.random() < 0.6) { const p = g.player.car.body.pos; g.fx.dust(p.x + (Math.random() - 0.5) * 40, p.y + Math.random() * 6, p.z + (Math.random() - 0.5) * 40, 0xd9b382, 2.5); }
    }
    fog.near = near; fog.far = far;
    g.viewDist = Math.min(900, far + 50);
  }

  // title backdrop: orbit the Hub at golden hour with traffic
  titleFrame(dt) {
    const g = this.game;
    if (!g?.renderer) return;
    this.titleT = (this.titleT || 0) + dt;
    if (!this.structures && this.sim) {
      this.sim.newGame(this.seed, {});
      this.structures = new Structures(g, this.sim);
      g.structures = this.structures;
      this.bridge = new Bridge(g, this.sim);
      const dummy = g.spawnCar({ id: 'titlecam', design: DEFAULT_DESIGN, team: 'drifter', x: 0, z: 170, heading: 0, isPlayer: true });
      this.player.attach(dummy);
      dummy.view.setVisible(false);
      this.titleCar = dummy;
    }
    const a = this.titleT * 0.05;
    const cam = g.camera;
    cam.position.set(Math.cos(a) * 260, 70, Math.sin(a) * 260);
    cam.lookAt(0, 10, 0);
    g.sky.update(dt, 0.71, new THREE.Vector3(0, 0, 0));
    this.bridge?.updateTraffic();
    g.paused = false;
    g.uiBlocking = true;
    g.frame(dt);
    this.titleCar?.view.setVisible(false);
  }
}

function slim(v) {
  // event payloads are sent over the network; keep them small and cycle-free
  if (!v || typeof v !== 'object') return v;
  if (v.body) return { id: v.id, name: v.name };
  try { return JSON.parse(JSON.stringify(v)); } catch { return { id: v.id, name: v.name, short: v.short, color: v.color, title: v.title }; }
}
function safeJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
// storage can be missing or throw (private windows, sandboxed frames): never let it break the game
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
};
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};
function reboot(params) {
  session.set('dustbowl-boot', JSON.stringify(params));
  location.reload();
}
// A steady timer that keeps firing in background tabs (worker timers are not throttled like page timers)
function makeTicker(fn, ms) {
  let id = null, w = null;
  const fallback = () => { if (w) { w.terminate(); w = null; } if (id === null) id = setInterval(fn, ms); };
  try {
    const url = URL.createObjectURL(new Blob([`const i=setInterval(()=>postMessage(0),${ms});onmessage=()=>clearInterval(i);`], { type: 'text/javascript' }));
    w = new Worker(url);
    w.onmessage = fn;
    w.onerror = fallback;
  } catch { fallback(); }
  return { stop() { if (w) w.terminate(); if (id !== null) clearInterval(id); w = null; id = null; } };
}
export { RES_INFO, STRUCTS, portrait, CHASSIS };
