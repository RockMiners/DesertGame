# Dustbowl Dynasties

A cute, cartoon-styled, post-apocalyptic car game that runs in the browser. You roll into **the Hub** in the middle of a procedurally shaped wasteland with a dented buggy and half a tank. Seven factions, each led by someone with a distinct personality, already hold the land. They wage wars, trade, betray each other and write history as you play. You decide where you fit in: join one, work your way up and seize it, or plant your own flag.

Everything is generated in code: terrain, models, music, sound effects and portraits. The game ships no asset files.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static build in dist/ (host anywhere)
npm run build:single # one self-contained HTML file in dist-single/
npm test             # headless simulation tests (Node 20+)
```

Use a desktop browser with WebGL2. A mouse and keyboard work best. Gamepads are supported for driving.

## Controls

| | |
|---|---|
| `W` `S` | throttle, brake and reverse (in the air: pitch for flips) |
| `A` `D` | steer (in the air: spin) |
| `Space` | handbrake, for drifting |
| `Shift` | nitro (needs Nitro Bottles) |
| `Q` / `E` | jump jets (if fitted) / roll in the air |
| Mouse | aim. Click the game to capture the mouse. If capture is blocked, you aim with the cursor and right-drag orbits the camera. |
| Left click / right click or `F` | fire guns / rear weapons (mines, oil slicks) |
| `E` | interact (the Hub, bases) |
| `M` `J` `Tab` | map, journal and chronicle, faction and crew |
| `G` `B` | garage, found a base or build |
| `R` `H` `C` | flip upright, honk, camera mode |
| `Esc` | pause, save, settings, co-op |

## What's in the game

**Driving.** The car physics is a custom raycast-suspension model running on the heightfield. It is tuned for dunes: the dunes have gentle windward ramps and steep crests, so you get real air. Landings squash the car, and you earn stunt bonuses for big air, spins and flips. You can drift with the handbrake, use nitro, and fit jump jets. Surface matters. Slicks are fast on salt and slide in sand, tracks climb anything, and heavy rigs dig into soft ground.

**Eleven biomes in 19 zones.** Golden dunes, salt flats, red-rock canyons with mesas and choke points, oil fields with tar pits, toxic bog, ruined cities, oases with lakes, ash wastes with lava, crystal mesas, glassed craters, and the Hub. Each zone has its own resources (scrap, petrol, ammo, water, grub, chems, circuits, crystal). The outer ring is richer, and the strongest factions hold it.

**Car designer.** There are 7 chassis, from Dune Buggy to War Truck, Juggernaut and the town-sized Land Ark. Add 6 engines (including electric and fusion), 5 wheel types, 5 armour grades, 9 weapons (MG, shotgun, cannon, homing rockets, flamethrower, laser, tesla coil, mines, oil slick) and 14 utilities (solar panels, batteries, shields, repair drone, jump jets, radar, ram plate, magnet and more). The tradeoffs are real:
- Mass slows acceleration and costs fuel.
- Size reduces handling and makes the car sink in sand.
- Energy weapons need batteries.
- Flamers burn your petrol.

Rigs have bunks, so you can sleep anywhere. You can save designs and hand them to your crew, and their base garage builds the car.

**Combat.** You get projectile weapons with lead and arcs, splash damage, knockback and burning. Ramming damage depends on mass. Props can be destroyed, and barrels explode. The game shows hit markers, damage numbers and screen shake, plus kill streak call-outs. A fairness director limits how many enemies can shoot you at once. It also adds mercy when you're nearly wrecked and sets difficulty from Chill to Brutal. Allies fighting near you get a morale boost.

**The strategic simulation** runs all the time, whether or not you're nearby:
- **Factions** have leaders with personality traits: aggression, honour, greed, cunning, ambition, caution, zeal and paranoia. These drive every decision.
- **Bases** sit on a tile grid. Production needs workers or powered Auto-Rigs. Every member needs a bed. Turrets defend, and terrain gives a defence bonus.
- **Economy.** The Hub market prices follow supply and demand. Factions run supply convoys and trade caravans, and you can raid either. Faction trade posts sell cheap whatever that faction has too much of. When two factions produce the same thing and prices slide, greedy leaders go to war over the market.
- **War.** Warbands march, besiege and raze bases. A zone with no bases left becomes claimable. Within about 400 m of a player, warbands and convoys become real AI cars driving in formation, and a base's garrison rolls out as one patrol when you come within about 260 m. Everywhere else they stay abstract (battles still resolve, and terrain still matters), so the open desert has room to breathe.
- **Diplomacy.** Relations drift. Factions form alliances against shared enemies, sign truces when weary, demand tribute, and betray allies.

**The Storyteller** paces events by tension and draws them "from a hat". Six premade story arcs run first:
- the Saints' oil crusade
- Lil' Spanner's gambit against Mama Rustclaw
- Doc Neon's death ray
- the seed vault ultimatum
- the Hub's failing well
- the Dominion purge

Repeatable events follow: the Great Betrayal, coups, faction sunderings, defections, assassination contracts, duels, bounty hunters, oil booms, meteor showers, sandstorms, droughts, market crashes, plagues, treasure caravans, mercenaries, Old-World bunkers that unlock parts, and peace summits you can sabotage. Procedural arcs take over as the premade ones run out: rivalries, gold rushes, and new warlords who rise with generated names, personalities and lore. Many events come to you as choices.

**The Chronicle** writes the lore as it happens. "The Fall of Fort Rattle", "The Great Betrayal", "The Coup at Bastion Shiny" and similar entries are recorded day by day after the premade history. Your deeds earn you titles such as "the Backstabber" or "Dune-Dancer".

**Your own faction.** Claim an unowned zone with `B`. Build lodgings, mines, pumps, wells, greenhouses, solar, generators, ammo works, garages, turrets, walls, depots, radio towers and trade posts. Bulldoze rough ground to build on it. Hire drivers at the cantina, pay their daily wages, and give them quests: scavenge, patrol, raid, guard, trade runs, or escort you. Set up convoy routes between bases. Save base layouts as blueprints for your crew to rebuild elsewhere. Run diplomacy, including betraying your allies. Unpaid or unhappy crew desert, and some steal from you on the way out.

**Progression.** You can join a faction and climb its ranks. At Right Hand you can attempt a coup and take the whole faction. Unlock part tiers by rank, by buying schematics, or by finding bunkers.

**Day and night, respawning, fuel and ammo.** Days last 12 real minutes. Your car has headlights, and night has stars and moonlight. You respawn where you last slept, or in the Hub if you have no base. Petrol and ammo run out, and you get stranded on fumes if you're careless.

**Co-op, hosted by a player.** Press `Esc` → Co-op → *Open this game to friends*. Friends join your group and share your faction, wallet and world. The host's browser runs the whole simulation; there is no game server. There are two ways to play together:

- **The hosted build (recommended).** The [Pages workflow](.github/workflows/pages.yml) publishes the game to `https://rockminers.github.io/DesertGame/` on every push (one-time setup: *Settings → Pages → Source: **GitHub Actions***. Not "Deploy from a branch": that publishes the unbuilt source, which can't run in a browser). The host copies their **invite link** from the Co-op tab; a friend opens it, types a name and presses Join (or presses *Join a Friend* and types the 5-letter code). A friend's car and cargo are remembered in their own browser for that host's world, so rejoining picks up where they left off. Browsers connect peer-to-peer over WebRTC (PeerJS); the public PeerJS broker only introduces them.
- **Inside the claude.ai artifact.** Artifacts can't open WebRTC connections, so co-op rides the artifact's `room` and `db` capabilities instead. The host must own (or be able to edit) the artifact. Friends open the same artifact link, press *Join a Friend*, and pick the host's game from the list. Everyone must be signed in to claude.ai and have the artifact shared with them. Updates are a little slower than a direct connection.

How it stays smooth: friends receive compact snapshots of only the cars near them (base-36 packed, ~60 bytes per car, 20 Hz peer-to-peer or 12 Hz in the artifact) and replay them about 0.1–0.2 s in the past with Hermite interpolation and a steered playback clock, so jitter and lost packets don't show. The slow world state (factions, bases, missions, chronicle) is split into sections that are re-sent only when they change. Damage is decided on the machine that owns the shooter. For testing on one machine, `?net=local` connects tabs through a BroadcastChannel.

## Code layout

```
src/
  app.js            boot, title, main loop, saves, interaction, co-op glue
  game.js           rendering + physical world: cars, collisions, damage, aim
  bridge.js         sim <-> physical world (materialize squads & garrisons)
  director.js       combat fairness (attack tokens, mercy, difficulty)
  player.js         input -> car controls, stunts
  audio.js          synthesized SFX, engine and generative music
  world/            terrain + biomes, worldgen, bases/Hub structures, pickups
  vehicle/          part catalogue & stats, raycast physics, car entity
  combat/           weapons, projectiles, beams, mines, slicks
  ai/driver.js      tactical driving AI (orbit/joust/ram/siege/follow)
  render/           toon materials & outlines, procedural models, sky, FX, tracks
  sim/              strategic sim: factions, economy, strategy AI, storyteller,
                    chronicle, missions, player commands, lore
  ui/               HUD, menus, garage designer, base builder, portraits
  net/net.js        co-op: host-authoritative snapshots, interpolation, damage routing
  net/protocol.js   wire format: packed car records, world-state sections
  net/transports.js PeerJS (WebRTC), BroadcastChannel, and the artifact room + db
test/               headless sim tests (20 simulated days, faction founding)
```

## Known limitations

- Desktop only. There are no touch controls.
- The world is one 3 km map. Content is procedural, but the map doesn't grow.
- In co-op, the host's world is authoritative and the game never pauses while friends are connected. Pickups are per-player, so two players can both grab the same pile. Beams and tesla arcs are only drawn on the shooter's screen.
- PeerJS needs its public broker to be reachable to set up a connection. Some corporate networks block it; very strict NATs may also need a TURN relay.
- The host should keep the game tab open. A background tab keeps simulating (a worker timer drives it), but browsers may still slow it down after a while.
- Balance is a first pass. The Iron Dominion tends to snowball if nobody stops it, which is arguably the point.
