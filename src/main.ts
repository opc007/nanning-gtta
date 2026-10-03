import * as THREE from 'three';
import { DEFAULT_CITY, type City } from './world/City';
import { generateNanningCity, type NanningCity } from './nanning/layout';
import { SHOPS, STALLS } from './nanning/data';
import { displayShopName, shopNameModeFrom } from './nanning/shopNames';
import { NanningSession } from './session/nanningSession';
import { buildCharacter } from './characters/buildCharacter';
import { PROTAGONIST } from './characters/protagonist';
import { InteriorView } from './render/InteriorView';
import { stepPlayer, type PlayerWorld } from './player/PlayerController';
import { PLAYER } from './player/params';
import { footprintOverlaps, type Aabb3 } from './systems/Collision';

import { StreamedWorld } from './world/StreamedWorld';
import { SceneEnv } from './render/Scene';
import { CityAssets } from './render/Assets';
import { Player } from './entities/Player';
import { FollowCamera, CAR_CAM, FOOT_CAM, STREET_CAM, INTERIOR_CAM, type ChaseConfine } from './systems/FollowCamera';
import { Vehicles } from './systems/Vehicles';
import { Pedestrians } from './systems/Pedestrians';
import { Debris } from './systems/Debris';
import { World } from './ecs/World';
import { HUD, type Mode } from './ui/HUD';
import { showSplash } from './ui/Splash';
import { Menu } from './ui/Menu';
import { Controls } from './core/Controls';
import { GameLoop } from './core/GameLoop';
import { loadOptions, saveOptions, qualityPixelRatio, type GameOptions } from './core/options';
import { lerp, angleLerp, starsFromHeat, daylightFactor } from './core/math';
import { Radio } from './audio/Radio';
import { Sfx } from './audio/Sfx';
import { toMph, type VehicleInput } from './vehicles/VehicleModel';

/** Touch UI + lower quality on coarse-pointer devices; `?touch=1|0` forces it. */
function isTouchDevice(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

const FOOT_RADIUS = PLAYER.radius;
const ENTER_DISTANCE = 6; // generous so curbside parked cars are easy to get into
const ENGINE_HEAR = 28; // on foot, how far a parked car's idle is audible
const STEP_DISTANCE = 1.7; // metres of travel between footstep sounds
let footAccum = 0;

let dayLength = 1440; // 1 real second = 1 game minute (overridden by options)
let timeOfDay = 0; // [0,1), 0 = midnight (the base game's night look)

const container = document.getElementById('app')!;
const touch = isTouchDevice();
const options = loadOptions();
dayLength = options.dayLength;

// New Game picks a seed and reloads with ?seed=; the world is built from it so
// the same seed always regenerates the same city (determinism).
const urlParams = new URLSearchParams(location.search);
const seedParam = Number(urlParams.get('seed'));
const worldSeed = Number.isFinite(seedParam) && urlParams.get('seed') !== null ? seedParam : DEFAULT_CITY.seed;
// The menu has no mode selector — modes (e.g. delivery/racing) are triggered in-game from
// free-roam activities, not chosen at boot. ?mode= still sets the boot mode for testing.
const gameMode = urlParams.get('mode') ?? 'explore';
// `?stream=1` runs the unbounded streamed world (R007); default is the finite city.
const streaming = urlParams.get('stream') === '1';
/** Close-up of the protagonist. Used by the hero screenshot, not by play. */
const heroShot = urlParams.get('hero') === '1';
// `?hud=0` hides every DOM overlay so screenshots show the scene.
if (urlParams.get('hud') === '0') {
  const style = document.createElement('style');
  style.textContent = '#app > div{visibility:hidden !important}';
  document.head.appendChild(style);
}
let heat = 0;
const config = { ...DEFAULT_CITY, seed: worldSeed };
const assets = new CityAssets(config.seed);

// In stream mode the world is built around the player on demand: each loaded
// chunk becomes a Group of building/prop/streetlight meshes, added when the
// chunk loads and removed when it unloads. Collision + lights read the live
// StreamedWorld via its City facade.
let streamedWorld: StreamedWorld | null = null;
let city: City;
let nanning: NanningCity | null = null;
// Real shop names stay unless `?names=fictional` (or VITE_SHOP_NAMES) is set.
// Applied before the street is generated so signs, prompts, and the layout agree.
{
  const viteNames = (import.meta.env as { VITE_SHOP_NAMES?: string }).VITE_SHOP_NAMES;
  const nameMode = shopNameModeFrom(location.search, viteNames);
  if (nameMode === 'fictional') {
    for (const s of SHOPS) s.name = displayShopName(s.id, s.name, nameMode);
    for (const s of STALLS) s.name = displayShopName(s.id, s.name, nameMode);
  }
}
if (streaming) {
  const chunkGroups = new Map<string, THREE.Group>();
  streamedWorld = new StreamedWorld(config, {
    add: (cx, cz, data) => {
      const g = new THREE.Group();
      data.buildings.forEach((b, i) => g.add(assets.makeBuilding(b, i)));
      if (data.props.length) g.add(assets.makeProps(data.props));
      data.streetlights.forEach((s) => g.add(assets.makeStreetlight(s)));
      chunkGroups.set(`${cx}:${cz}`, g);
      env.scene.add(g);
    },
    remove: (cx, cz) => {
      const k = `${cx}:${cz}`;
      const g = chunkGroups.get(k);
      // TODO(R007 follow-up): pool/dispose chunk geometry. For now we only detach
      // (materials are shared via the asset cache; geometry GC's with the Group).
      if (g) {
        env.scene.remove(g);
        chunkGroups.delete(k);
      }
    },
  });
  city = streamedWorld.asCity();
} else {
  // Nanning: a composed street, not a procedural grid. `?stream=1` falls back
  // to the base generator because the composed layout is finite by design.
  nanning = generateNanningCity(config.seed);
  city = nanning;
}

// Nanning opens at ~19:00: the 夜市 lanterns and shopfront neon are the whole
// point of the map, and you can't judge any of it in the dark.
// `?t=` pins the clock (0.45 is flat daylight) so material shots aren't dusk.
if (nanning) {
  const tParam = Number(urlParams.get('t'));
  timeOfDay = urlParams.get('t') !== null && Number.isFinite(tParam) ? Math.min(0.999, Math.max(0, tParam)) : 0.79;
}

const env = new SceneEnv(container, city, {
  ...(touch ? { maxPixelRatio: 1.5, shadowMapSize: 1024 } : {}),
  streaming,
});

let session: NanningSession | null = null;

if (streamedWorld) {
  // env.scene now exists; load the initial ring around spawn (fires the hooks).
  streamedWorld.update(city.center.x, city.center.z);
} else {
  if (!nanning) city.buildings.forEach((b, i) => env.scene.add(assets.makeBuilding(b, i)));
  city.streetlights.forEach((s) => env.scene.add(assets.makeStreetlight(s)));
  if (!nanning) env.scene.add(assets.makeProps(city.props));

}

const avatarRig = buildCharacter(PROTAGONIST);
const avatar = avatarRig.group;
env.scene.add(avatar);
// `?hero=1` is a portrait camera. A small fill keeps the coat and face readable
// at night without changing the street's own lighting.
const heroFill = heroShot ? new THREE.PointLight(0xfff1e2, 14, 7, 1.6) : null;
if (heroFill) env.scene.add(heroFill);

// Debug handle. Cheap to keep, and the headless smoke test asserts against it —
// which is the only reliable way to tell "the scene is empty" apart from "the
// scene is dark but fine".
(globalThis as unknown as Record<string, unknown>).__nn = {
  get scene() { return env.scene; },
  get camera() { return env.camera; },
  get city() { return city; },
  get player() { return player; },
  get district() { return session?.district ?? null; },
  get shops() { return session?.shops ?? null; },
  get loop() { return loop; },
};

// Sfx is constructed here so the street session can blip on a purchase. The
// audio context itself still resumes on the first gesture.
const sfx = new Sfx();

// The street session is built after the scene exists. `completeMission` is a
// function declaration, so the payout callback can close over it.
let interiors: InteriorView | null = null;
if (nanning) {
  interiors = new InteriorView(env.scene);
  // Interior orbit sits close to walls; the old 0.5 m near plane clips the doorway.
  env.camera.near = 0.12;
  env.camera.updateProjectionMatrix();
}
if (nanning) {
  session = new NanningSession({
    scene: env.scene,
    city: nanning,
    container,
    seed: config.seed,
    touch,
    timeOfDay,
    onHeat: (amount) => {
      heat = Math.min(100, heat + amount);
    },
    onPayout: (payout) => completeMission(payout),
    onBlip: () => sfx.footstep(),
  });
}

// Warm glow that rides the active actor so the night street reads up close.
const lamp = new THREE.PointLight(0xffd9a8, 60, 40, 2);
env.scene.add(lamp);

// A handful of real point lights hop to the streetlights nearest the player,
// so lamps actually cast pools of light without paying for 81 live lights.
const STREETLIGHT_POOL = 6;
const streetlightPool = Array.from({ length: STREETLIGHT_POOL }, () => {
  const l = new THREE.PointLight(0xffcf9a, 45, 28, 1.6);
  env.scene.add(l);
  return l;
});

// Twin headlight spots on the car you're driving; dark while on foot.
const headlights = [0, 1].map(() => {
  const light = new THREE.SpotLight(0xfff2d0, 0, 42, 0.62, 0.5, 1.1);
  const target = new THREE.Object3D();
  light.target = target;
  env.scene.add(light, target);
  return { light, target };
});

// One shared ECS World holds all dynamic entities (cars, pedestrians, debris),
// and one shared Debris pool serves both car wrecks and pedestrian gibs.
const world = new World();
const debris = new Debris(env.scene, world);
// Stream mode (MVP): no ambient traffic/peds yet — they spawn player-relative in
// a follow-up (Phase C). The player car still spawns at the origin intersection.
// On the food street the only cars are the background lanes past the barriers.
// `?stream=1` keeps the upstream world with no ambient traffic (unchanged).
const trafficCount = streaming ? 0 : nanning ? 8 : touch ? 24 : 40;
const vehicles = new Vehicles(env.scene, city, world, debris, trafficCount);
const peds = new Pedestrians(env.scene, city, world, debris, streaming ? 0 : touch ? 28 : 60);
const hud = new HUD(container, city, touch, streaming);

let touchRoot: HTMLElement | undefined;
if (touch) {
  touchRoot = document.createElement('div');
  container.appendChild(touchRoot);
}
const controls = new Controls(touchRoot);
const follow = new FollowCamera(env.camera);
follow.setGrid(city.grid); // the chase camera needs the world collider grid to know what blocks it
follow.setSoftBlockers(session?.camBlockers ?? []);
const player = new Player();

// The radio streams one track at a time from a CDN-hosted manifest, so the
// (large) music library is never bundled. It loads asynchronously and stays
// silent until the first user gesture (browser autoplay policy).
let radio: Radio | null = null;
let radioPrimed = false;
let radioCarIndex: number | null = null; // which car's radio is currently loaded
let audioGestured = false;
const markGesture = (): void => {
  audioGestured = true;
  sfx.start(); // create/resume the audio context within the gesture
  primeRadio(); // iOS only lets the <audio> element start from inside a gesture
};
addEventListener('keydown', markGesture);
addEventListener('pointerdown', markGesture);
addEventListener('touchend', markGesture); // some iOS taps surface here, not pointerdown
// A backgrounded tab suspends the context; resume whenever we're focused again.
// This is also why audio "came back after alt-tab" — make it reliable, not luck.
addEventListener('focus', () => sfx.start());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sfx.start();
});

/**
 * Kick the radio off. MUST be reachable from a user-gesture call stack: iOS
 * Safari refuses HTMLAudioElement.play() outside one, so priming from the game
 * loop left the radio silent until the player tapped the radio button. Called
 * from markGesture and retried each gesture until the manifest has loaded.
 */
function primeRadio(): void {
  if (!radio || radioPrimed || mode !== 'driving') return;
  const i = vehicles.playerIndex ?? 0;
  radio.enterCar(i);
  radioCarIndex = i;
  radioPrimed = true;
}

interface RadioManifest {
  baseUrl: string;
  stations: { name: string; tracks: { title: string; file: string }[] }[];
}

/**
 * The upstream manifest streams MP3s from the gta7 author's GitHub Release. That
 * is someone else's bandwidth to spend and someone else's link to break, so it
 * is off unless we ship our own audio. `?radio=1` forces it on for local
 * comparison; `?radio=0` (the default here) leaves the car silent apart from
 * the synthesized engine, which is the part that matters anyway.
 *
 * TODO: a synthesized 邕州 radio — 五声音阶 loops generated in WebAudio, so
 * there is no asset to host and nothing to go down.
 */
const RADIO_ENABLED = new URLSearchParams(location.search).get('radio') === '1';
if (RADIO_ENABLED) {
  fetch('radio.json')
    .then((r) => (r.ok ? (r.json() as Promise<RadioManifest>) : null))
    .then((data) => {
      if (!data?.stations?.length) return;
      radio = new Radio(
        data.stations.map((s) => ({
          name: s.name,
          tracks: s.tracks.map((t) => ({ title: t.title, url: data.baseUrl + t.file })),
        })),
      );
      if (audioGestured) primeRadio();
    })
    .catch(() => {});
}

let mode: Mode = nanning ? 'foot' : 'driving';
// The first car is spawned as the player's. On the food street you start on
// foot beside it, so it has to be enterable (nearest() ignores playerIndex).
if (mode === 'foot') vehicles.exit();
player.x = city.center.x;
player.z = city.center.z;
// Face south, down the street toward the night market. Forward is (cos h, -sin h).
if (nanning) player.heading = -Math.PI / 2;
follow.snapBehind(player.heading, player.x, player.z, player.y, nanning ? STREET_CAM : FOOT_CAM);

const MAX_HEALTH = 100;
const HIT_SPEED = 3; // m/s a car must exceed to injure a pedestrian
const DAMAGE_PER_SPEED = 5; // health lost per m/s of impact
const KNOCKBACK = 1.6;
const WASTED_TIME = 3; // seconds the WASTED screen holds before respawn

let health = MAX_HEALTH;
let wasted = false;
let wastedTimer = 0;
let pedContact = false; // were we in contact with a car last frame (edge-trigger)

// Wanted system: "heat" rises with crimes and decays after a grace period;
// it maps to 0–5 stars, and each star is one chasing police car.
const CRIME_HEAT = 16; // heat added per pedestrian you personally run over
const HEAT_GRACE = 4; // seconds OUT OF POLICE SIGHT before heat starts to cool
const HEAT_DECAY = 11; // heat lost per second once cooling
let stars = 0;
let sinceUnseen = 0; // seconds since a cop last had line of sight (the "get away" timer)
let wantedCooling = false; // true while stars are cooling off (HUD flashes them)
let prevRunOver = 0;

// Busted: a chasing cop pins you slow for long enough → arrested, game resets.
const BUST_RADIUS = 7; // a cop this close...
const BUST_SPEED = 5; // ...while you're slower than this (m/s)...
const BUST_FILL_TIME = 1.8; // ...for this long → BUSTED
const BUSTED_TIME = 3; // seconds the BUSTED screen holds before respawn
let busted = false;
let bustedTimer = 0;
let bustFill = 0;

const clampToCity = (p: { x: number; z: number }): void => {
  const b = city.half - 2;
  p.x = Math.max(-b, Math.min(b, p.x));
  p.z = Math.max(-b, Math.min(b, p.z));
};

function toggleVehicle(): void {
  if (mode === 'driving') {
    const pose = vehicles.playerPose()!;
    // Step out to the left of the car.
    const x = pose.x - Math.sin(pose.heading) * 2.4;
    const z = pose.z - Math.cos(pose.heading) * 2.4;
    vehicles.exit();
    mode = 'foot';
    player.teleport(x, z, pose.heading);
    follow.snapBehind(pose.heading, x, z, 0, STREET_CAM);
    sfx.exitCar();
  } else {
    const i = vehicles.nearest(player.x, player.z, ENTER_DISTANCE);
    if (i >= 0) {
      vehicles.enter(i);
      mode = 'driving';
      radio?.enterCar(i);
      radioCarIndex = i;
      radioPrimed = true;
      sfx.enterCar();
    }
  }
}

function drivingInput(): VehicleInput {
  const m = controls.move();
  return {
    throttle: m.y, // forward
    steer: -m.x, // +1 = left, so right stick (+x) steers right
    handbrake: controls.handbrake(),
  };
}

let furniture: Aabb3[] = [];
let insideShop = false;
/** Open air of the shop the player is standing in. Keeps the eye off the street facade. */
let shopAir: ChaseConfine | null = null;

const footWorld: PlayerWorld = {
  query(x, z, radius, out) {
    let n = nanning ? nanning.heightGrid.query(x, z, radius, out) : 0;
    for (let i = 0; i < furniture.length; i++) {
      const box = furniture[i];
      if (!footprintOverlaps(x, z, radius, box)) continue;
      out[n++] = box;
    }
    return n;
  },
};

const camBlocks: Aabb3[] = [];

function updateFoot(dt: number): void {
  if (interiors && nanning) {
    const streamed = interiors.update(nanning, player.x, player.z, touch);
    furniture = streamed.colliders;
    insideShop = streamed.inside !== null;
    const shell = streamed.inside;
    if (shell) {
      // Collision walls are 0.28 m. Stay far enough inside that the near
      // plane (0.12) and the eye pad never touch them, including the door jambs.
      const m = 0.62;
      shopAir = {
        minX: shell.cx - shell.depth / 2 + m,
        maxX: shell.cx + shell.depth / 2 - m,
        minZ: shell.cz - shell.width / 2 + m,
        maxZ: shell.cz + shell.width / 2 - m,
        minY: 0.4,
        maxY: 2.45,
      };
    } else {
      shopAir = null;
    }
  } else {
    furniture = [];
    insideShop = false;
    shopAir = null;
  }

  const m = controls.move(true);
  const events = stepPlayer(
    player.sim,
    {
      moveX: m.x,
      moveY: m.y,
      camYaw: follow.moveYaw,
      sprint: controls.sprint(true),
      walkMod: controls.walkMod(),
      crouchPressed: controls.crouchPressed(),
      jumpPressed: controls.jumpPressed(),
      jumpHeld: controls.jumpHeld(),
    },
    footWorld,
    dt,
    { speedMul: 1, carry: 'none', satiety: session?.shops.wallet.satiety ?? 80 },
  );
  // Grab is wired (G / right click / Y) and intentionally does nothing until props exist.
  controls.grabPressed();

  for (const ev of events) {
    if (ev.kind === 'fallDamage') {
      health -= ev.amount;
      if (health <= 0) enterWasted();
    }
  }

  // Streamed cities have no height boxes. Keep the old flat push-out there.
  if (!nanning) {
    const fixed = city.grid.resolve(player.x, player.z, FOOT_RADIUS);
    player.x = fixed.x;
    player.z = fixed.z;
    player.y = 0;
    player.sim.vy = 0;
    player.sim.grounded = true;
  }
  if (session) {
    const offStall = session.resolveStalls(player.x, player.z, FOOT_RADIUS);
    player.x = offStall.x;
    player.z = offStall.z;
    // Keep the slice on the street. The cross roads past the barriers are scenery.
    player.x = Math.max(-42, Math.min(42, player.x));
  }
  // Don't walk through cars (parked or otherwise).
  const offCar = vehicles.resolveActor(player.x, player.z, FOOT_RADIUS);
  player.x = offCar.x;
  player.z = offCar.z;
  clampToCity(player);
}

function enterWasted(): void {
  wasted = true;
  wastedTimer = WASTED_TIME;
  health = 0;
}

function respawn(): void {
  wasted = false;
  busted = false;
  bustFill = 0;
  health = MAX_HEALTH;
  pedContact = false;
  heat = 0; // getting WASTED/BUSTED clears your wanted level
  sinceUnseen = 0;
  wantedCooling = false;
  mode = 'foot';
  player.teleport(city.center.x, city.center.z + 6, nanning ? -Math.PI / 2 : 0);
  follow.snapBehind(player.heading, player.x, player.z, 0, STREET_CAM);
}

function enterBusted(): void {
  busted = true;
  bustedTimer = BUSTED_TIME;
  bustFill = 0;
}

/** A chasing cop pinning you slow fills the bust meter; sustained → BUSTED. */
function updateBusted(dt: number): void {
  const t = chaseTarget();
  const speed = mode === 'driving' ? Math.abs(vehicles.playerForwardSpeed()) : player.speed;
  const pinned = vehicles.nearestPoliceDistance(t.x, t.z) < BUST_RADIUS && speed < BUST_SPEED;
  bustFill = pinned ? bustFill + dt : Math.max(0, bustFill - 2 * dt); // fills slow, clears fast
  if (bustFill >= BUST_FILL_TIME) enterBusted();
}

/** Active player pose + velocity the police intercept (the car, or the avatar on foot). */
function chaseTarget(): { x: number; z: number; vx: number; vz: number } {
  const pose = vehicles.playerPose();
  if (mode === 'driving' && pose) {
    const v = vehicles.playerVelocity();
    return { x: pose.x, z: pose.z, vx: v.vx, vz: v.vz };
  }
  return {
    x: player.x,
    z: player.z,
    vx: Math.cos(player.heading) * player.speed,
    vz: -Math.sin(player.heading) * player.speed,
  };
}

/**
 * Crimes raise heat → wanted stars → police. You "get away" GTA-style: once no
 * cop has line of sight to you (broke LOS behind a building, or outran their
 * sight range), the heat cools after a short grace and the stars drop.
 */
function updateWanted(dt: number): void {
  const over = peds.runOverCount;
  const t = chaseTarget();
  const seen = stars > 0 && vehicles.anyPoliceSeesTarget(t.x, t.z, city.colliders);
  if (over > prevRunOver) {
    sfx.gib();
    heat = Math.min(100, heat + (over - prevRunOver) * CRIME_HEAT);
    sinceUnseen = 0;
  } else if (seen) {
    sinceUnseen = 0; // they have eyes on you — wanted holds
  } else {
    sinceUnseen += dt;
    if (sinceUnseen > HEAT_GRACE) heat = Math.max(0, heat - HEAT_DECAY * dt);
  }
  prevRunOver = over;
  wantedCooling = stars > 0 && !seen && sinceUnseen > HEAT_GRACE;
  stars = starsFromHeat(heat);
  vehicles.setWanted(stars, t, city);
}

/** While on foot, take damage from cars that hit us; trigger WASTED at zero. */
function checkPedestrianDamage(): void {
  // Exclude police: a cop catching you on foot triggers BUSTED (arrest), it
  // doesn't run you over. Ordinary traffic can still flatten you.
  const hit = vehicles.pedestrianImpact(player.x, player.z, false, false);
  const contact = !!hit && hit.speed > HIT_SPEED;
  if (contact && !pedContact) {
    health -= hit!.speed * DAMAGE_PER_SPEED;
    player.x += hit!.nx * KNOCKBACK;
    player.z += hit!.nz * KNOCKBACK;
    if (health <= 0) enterWasted();
  }
  pedContact = contact;
}

// Any car (including the one you're driving) moving fast enough flattens peds.
const runOverQuery = (x: number, z: number) => vehicles.pedestrianImpact(x, z, true);
// Pedestrians (like the player on foot) get pushed out of cars they'd clip.
const resolveCars = (x: number, z: number, r: number) => vehicles.resolveActor(x, z, r);

/** Sound the car wrecks from this step; a wrecked player car means WASTED. */
function flushCarWrecks(): void {
  const n = vehicles.consumeExplosions();
  for (let k = 0; k < Math.min(n, 3); k++) sfx.explosion();
  if (vehicles.consumePlayerWreck() && !wasted) enterWasted();
}

function update(dt: number): void {
  player.savePrev();
  timeOfDay = (timeOfDay + dt / dayLength) % 1;

  // Stream the world around the active position (car when driving, else avatar).
  if (streamedWorld) {
    const p = vehicles.playerPose();
    const sx = mode === 'driving' && p ? p.x : player.x;
    const sz = mode === 'driving' && p ? p.z : player.z;
    streamedWorld.update(sx, sz);
  }

  if (wasted || busted) {
    if (wasted) wastedTimer -= dt;
    else bustedTimer -= dt;
    vehicles.update(city, dt, null, null);
    flushCarWrecks();
    peds.update(city, dt, runOverQuery, null, resolveCars);
    debris.update(dt); // shared pool, advanced once per frame
    if ((wasted && wastedTimer <= 0) || (busted && bustedTimer <= 0)) respawn();
    controls.endFrame();
    return;
  }

  // E opens or closes a shop. F is the only key that enters or leaves a car.
  if (mode === 'foot' && controls.interactPressed()) session?.interact(true);
  if (controls.mountPressed()) toggleVehicle();

  updateWanted(dt);
  const chase = stars > 0 ? chaseTarget() : null;

  if (mode === 'driving') {
    if (controls.resetPressed()) vehicles.resetPlayer(city);
    vehicles.update(city, dt, drivingInput(), null, chase);
    flushCarWrecks();
  } else {
    vehicles.update(city, dt, null, { x: player.x, z: player.z }, chase);
    flushCarWrecks();
    updateFoot(dt);
    checkPedestrianDamage();

    // Punch: whatever's in front of you. A 骑楼 shopfront takes the hit and
    // starts losing integrity; otherwise it's a pedestrian.
    if (controls.attackPressed()) {
      const dirX = Math.cos(player.heading);
      const dirZ = -Math.sin(player.heading);
      const hitShop = session?.punch(player.x, player.z, dirX, dirZ) ?? false;
      if (!hitShop) peds.punch(player.x, player.z, dirX, dirZ);
    }

    // Footsteps cadence with travel distance (faster when sprinting).
    if (player.speed > 0.1) {
      footAccum += player.speed * dt;
      if (footAccum >= STEP_DISTANCE) {
        footAccum = 0;
        sfx.footstep();
      }
    } else {
      footAccum = STEP_DISTANCE; // first move triggers a step promptly
    }
  }

  if (radio) {
    const step = controls.radioStep();
    if (step !== 0) radio.step(step);
  }

  updateBusted(dt);
  // Pedestrians fear the CAR only (not the player on foot): proximity, or a fast
  // car on a vector to hit them. Threat carries velocity for the vector trigger.
  peds.update(city, dt, runOverQuery, mode === 'driving' ? chaseTarget() : null, resolveCars);
  debris.update(dt); // shared pool, advanced once per frame
  controls.endFrame();
}

function updateStreetlightPool(ax: number, az: number): void {
  const sl = city.streetlights;
  if (sl.length === 0) return;
  // Nearest-first each call (the streamed set changes as chunks load/unload, so
  // we can't keep a persistent index array).
  const d2 = (i: number): number => (sl[i].x - ax) ** 2 + (sl[i].z - az) ** 2;
  const order = sl.map((_, i) => i).sort((a, b) => d2(a) - d2(b));
  for (let i = 0; i < streetlightPool.length; i++) {
    const s = sl[order[Math.min(i, order.length - 1)]];
    streetlightPool[i].position.set(s.x, 4.8, s.z);
  }
}

function updateHeadlights(pose: { x: number; z: number; heading: number } | null): void {
  if (!pose) {
    for (const h of headlights) h.light.intensity = 0;
    return;
  }
  const fx = Math.cos(pose.heading);
  const fz = -Math.sin(pose.heading);
  const rx = Math.sin(pose.heading);
  const rz = Math.cos(pose.heading);
  for (let i = 0; i < headlights.length; i++) {
    const side = i === 0 ? -0.6 : 0.6;
    const h = headlights[i];
    h.light.position.set(pose.x + fx * 2 + rx * side, 0.7, pose.z + fz * 2 + rz * side);
    h.target.position.set(pose.x + fx * 16, 0.1, pose.z + fz * 16);
    h.light.intensity = 90;
  }
}

function render(alpha: number, frameDt: number): void {
  // Interpolate every moving thing between its previous and current physics
  // step so motion stays smooth regardless of how steps line up with frames.
  vehicles.render(alpha);
  peds.render(alpha);
  debris.render(alpha); // shared pool, drawn once per frame

  const ax = lerp(player.px, player.x, alpha);
  const ay = lerp(player.py, player.y, alpha);
  const az = lerp(player.pz, player.z, alpha);
  const ah = angleLerp(player.ph, player.heading, alpha);
  avatar.position.set(ax, ay, az);
  avatar.rotation.y = ah;
  avatar.visible = mode === 'foot';
  avatarRig.update(mode === 'foot' ? player.speed : 0, frameDt, {
    state: player.state === 'air' ? 'air' : player.state,
    stateTime: player.sim.stateTime,
    vy: player.vy,
  });
  const head = avatarRig.limbs.head;
  if (head) head.visible = !(mode === 'foot' && follow.eyeDistance < 0.85);

  const carPose = vehicles.playerPoseInterp(alpha);
  const active =
    mode === 'driving' && carPose ? carPose : { x: ax, z: az, heading: ah, speed: player.speed };
  env.follow(active.x, active.z); // streamed ground/shadow/sun ride the player (no-op when finite)
  lamp.position.set(active.x, 3.5, active.z);
  updateStreetlightPool(active.x, active.z);
  updateHeadlights(mode === 'driving' && carPose ? carPose : null);

  // Camera leads by the actual velocity vector so the car stays centred mid-powerslide
  // (world velocity diverges from heading); on foot, velocity is along facing.
  let camVx: number;
  let camVz: number;
  if (mode === 'driving' && carPose) {
    const v = vehicles.playerVelocity();
    camVx = v.vx;
    camVz = v.vz;
  } else {
    camVx = Math.cos(ah) * player.speed;
    camVz = -Math.sin(ah) * player.speed;
  }
  if (mode === 'foot' && nanning && !heroShot) {
    const look = controls.consumeLook(frameDt);
    follow.pointerLocked = document.pointerLockElement != null;
    let nBlocks = nanning.heightGrid.query(ax, az, 14, camBlocks);
    for (let i = 0; i < furniture.length; i++) {
      const box = furniture[i];
      if (!box.camBlock) continue;
      camBlocks[nBlocks++] = box;
    }
    follow.updateOnFoot(
      ax,
      ay,
      az,
      ah,
      insideShop ? INTERIOR_CAM : STREET_CAM,
      frameDt,
      look.x,
      look.y,
      camBlocks,
      nBlocks,
      shopAir,
    );
  } else {
    controls.consumeLook(frameDt);
    follow.update(active.x, active.z, active.heading, mode === 'driving' ? CAR_CAM : FOOT_CAM, frameDt, camVx, camVz);
  }
  // `?hero=1` frames the protagonist for a close-up. The chase cam runs first
  // so the rest of the frame is normal; this only overrides the final pose.
  if (heroShot && mode === 'foot') {
    env.camera.position.set(ax + 1.15, 1.12, az + 1.0);
    env.camera.lookAt(ax, 0.9, az);
    heroFill?.position.set(ax + 0.85, 1.55, az + 0.65);
  }

  const speedMph = mode === 'driving' ? toMph(vehicles.playerForwardSpeed()) : toMph(player.speed);
  // The health bar reads car integrity while driving, avatar health on foot.
  const shownHealth = mode === 'driving' ? vehicles.playerCarHealth() : health;
  hud.update(speedMph, mode, active, vehicles.positions(), shownHealth, wasted);
  hud.setRunOverCount(peds.runOverCount);
  hud.setCarName(mode === 'driving' ? vehicles.playerCarName() : null);
  // Radio readout is a dashboard thing — only show it while driving (the audio
  // itself still fades out with distance as you walk away).
  hud.setRadio(mode === 'driving' ? (radio ? radio.label() : '📻 OFF') : '');
  hud.setWanted(stars, wantedCooling);
  hud.setClock(timeOfDay);
  hud.setBusted(busted);

  if (session) {
    session.tick(frameDt, timeOfDay, player.x, player.z, mode === 'foot', heat, follow.yaw, env.scene, daylightFactor(timeOfDay));
    session.render(env.camera);
    const nearCar = mode === 'foot' && vehicles.nearest(player.x, player.z, ENTER_DISTANCE) >= 0;
    session.hud.setMountHint(nearCar);
    const sprinting = mode === 'foot' && controls.sprint(true) && player.speed > 0.4;
    session.hud.setStamina(player.stamina, player.sim.staminaMax, sprinting || player.stamina < player.sim.staminaMax, frameDt);
  }

  const driving = mode === 'driving';
  if (driving) {
    sfx.setEngine(Math.abs(vehicles.playerForwardSpeed()) / vehicles.playerMaxSpeed(), 1);
    sfx.setScreech(Math.max(0, (vehicles.playerLateralSpeed() - 2) / 8));
    if (radio) radio.updateProximity(true, 0);
  } else {
    sfx.setScreech(0);
    // The car you left keeps idling and playing; both fade as you walk off.
    const dist =
      radioCarIndex !== null
        ? Math.hypot(player.x - vehicles.carPosition(radioCarIndex).x, player.z - vehicles.carPosition(radioCarIndex).z)
        : Infinity;
    const near = Math.max(0, 1 - dist / ENGINE_HEAR);
    sfx.setEngine(0, near * 0.6); // idle, quieter than under throttle
    if (radio) radio.updateProximity(false, dist);
  }

  env.setTimeOfDay(timeOfDay);
  const daylight = daylightFactor(timeOfDay);
  assets.setDaylight(daylight); // window/lamp lights off + glassy by day
  session?.applyDaylight(daylight);
  env.render();

  // Perf telemetry (watched in the smoke run; see performance-vigilance memory).
  if (frameDt > 0) perf.frameMs = perf.frameMs === 0 ? frameDt * 1000 : perf.frameMs * 0.9 + frameDt * 1000 * 0.1;
  const info = env.renderer.info;
  perf.drawCalls = info.render.calls;
  perf.triangles = info.render.triangles;
  perf.geometries = info.memory.geometries;
  perf.textures = info.memory.textures;
}

interface Perf {
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}
const perf: Perf = { frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };

declare global {
  interface Window {
    __game?: {
      readonly mode: Mode;
      readonly health: number;
      readonly carHealth: number;
      readonly wasted: boolean;
      readonly busted: boolean;
      readonly runOverCount: number;
      readonly radioLabel: string;
      readonly wanted: number;
      readonly wantedCooling: boolean;
      readonly police: number;
      readonly timeOfDay: number;
      readonly paused: boolean;
      readonly radioReady: boolean;
      readonly carModel: string | null;
      readonly perf: Perf;
      vehicles: Vehicles;
      player: Player;
      peds: Pedestrians;
      city: typeof city;
      teleport(x: number, z: number, heading?: number): void;
      interiorProps(): { prop: string; shopId: string; x: number; z: number; w: number; d: number; h: number }[];
      readonly interior: boolean;
      readonly camDist: number;
      readonly camBlocked: boolean;
      readonly camEye: { x: number; y: number; z: number };
    };
  }
}
window.__game = {
  get mode() {
    return mode;
  },
  get health() {
    return health;
  },
  get carHealth() {
    return vehicles.playerCarHealth();
  },
  get wasted() {
    return wasted;
  },
  get busted() {
    return busted;
  },
  get runOverCount() {
    return peds.runOverCount;
  },
  get radioLabel() {
    return radio ? radio.label() : '📻 OFF';
  },
  get wanted() {
    return stars;
  },
  get wantedCooling() {
    return wantedCooling;
  },
  get police() {
    return vehicles.activePoliceCount();
  },
  get timeOfDay() {
    return timeOfDay;
  },
  get paused() {
    return loop.isPaused();
  },
  get radioReady() {
    return radio !== null; // manifest fetched + tuner built
  },
  get carModel() {
    return vehicles.playerCarName();
  },
  get perf() {
    return perf;
  },
  vehicles,
  player,
  peds,
  city,
  teleport(x: number, z: number, heading?: number) {
    player.teleport(x, z, heading);
    follow.snapBehind(player.heading, player.x, player.z, player.y, insideShop ? INTERIOR_CAM : STREET_CAM);
  },
  interiorProps() {
    return interiors?.props() ?? [];
  },
  get interior() {
    return insideShop;
  },
  get camDist() {
    return follow.eyeDistance;
  },
  get camBlocked() {
    return follow.eyeBlocked;
  },
  get camEye() {
    return { x: env.camera.position.x, y: env.camera.position.y, z: env.camera.position.z };
  },
};

function completeMission(p: { title: string; reward: number; line: string }): void {
  if (session && p.reward > 0) session.shops.wallet.money += p.reward;
  session?.hud.toast(`✅ ${p.title}  完成！${p.reward > 0 ? ` +¥${p.reward}` : ''}`, '#2ee6a8');
  session?.hud.toast(p.line, '#ffd24a');
  sfx?.enterCar();
}

const loop = new GameLoop(update, render);

/** Push the current options everywhere they take live effect. */
function applyOptions(opts: GameOptions): void {
  sfx.setMasterVolume(opts.masterVolume);
  radio?.setMasterVolume(opts.masterVolume);
  env.renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityPixelRatio(opts.quality)));
  dayLength = opts.dayLength;
}
applyOptions(options);

const menu = new Menu(container, options, worldSeed, gameMode, {
  onResume: () => setPaused(false),
  onRestart: () => location.reload(),
  onPlay: () => {
    menu.close();
    loop.setPaused(false);
  },
  onNewGame: (seed) => {
    const p = new URLSearchParams(location.search);
    p.set('seed', String(seed));
    location.search = p.toString(); // reload → world rebuilt from the new seed
  },
  onModeChange: () => {}, // only 'explore' is playable yet (R033)
  onOptionsChange: (opts) => {
    applyOptions(opts);
    saveOptions(opts);
  },
});

function setPaused(p: boolean): void {
  if (p) menu.openAs('pause');
  else menu.close();
  loop.setPaused(p);
}

// Esc (keyboard) toggles the pause menu both ways — a DOM listener, so it fires
// even while the sim loop is frozen.
addEventListener('keydown', (e) => {
  // Pointer lock eats the first Escape (the browser unlocks). Don't also pause.
  if (e.code === 'Escape' && document.pointerLockElement) return;
  if (e.code === 'Escape' && !document.getElementById('splash')) setPaused(!menu.isOpen());
});

// Click the view to orbit. Touch uses the right-half drag instead.
env.renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || touch || mode !== 'foot' || menu.isOpen()) return;
  env.renderer.domElement.requestPointerLock?.();
});

// Gamepad Start toggles pause. Polled on its own rAF (not the sim loop, which is
// frozen while paused) so the pad can also close the menu.
let padStartDown = false;
const pollPause = (): void => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let start = false;
  for (const p of pads) if (p && p.buttons[9]?.pressed) start = true;
  if (start && !padStartDown && !document.getElementById('splash')) setPaused(!menu.isOpen());
  padStartDown = start;
  requestAnimationFrame(pollPause);
};
requestAnimationFrame(pollPause);

loop.start();
// Splash → on dismiss, unlock audio and raise the title menu (paused) until the
// player hits Play. The e2e harness's __skipSplash bypasses dismissal, so it
// never raises the menu and drops straight into the running game.
showSplash(container, () => {
  markGesture();
  menu.openAs('title');
  loop.setPaused(true);
});
