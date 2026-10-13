import * as THREE from 'three';
import type { City } from '../world/City';
import { createRng, type Rng } from '../core/rng';
import { lerp, angleLerp } from '../core/math';
import { makePed } from '../render/Assets';
import { Debris } from './Debris';
import { World, defineComponent } from '../ecs/World';

/**
 * 'down' is a person on the floor, not a corpse: they get up. 'carried' is held
 * over the player's shoulder, which is the only state in which the player, not
 * the world, decides where they go.
 */
type State = 'walk' | 'shoved' | 'gibbed' | 'down' | 'carried';

interface Ped {
  state: State;
  x: number;
  z: number;
  y: number; // height while knocked into the air
  heading: number;
  tumble: number; // faceplant rotation while down (0 = upright)
  speed: number;
  turnTimer: number;
  color: number; // shirt colour, reused for gib cubes
  scared: boolean; // fleeing the on-foot player (trembles + runs away)
  hp: number; // punches stagger, they do not delete
  /** Who is carrying them, and how long they have been held. */
  heldBy: number; // player index, -1 when free
  holdT: number;
  /** Set while they are mid-sentence, so a talking ped does not walk off. */
  talking: number;
  vx: number; // velocity while shoved
  vz: number;
  vy: number;
  timer: number; // shove recovery / gib respawn countdown
  // Previous-step pose for render interpolation.
  px: number;
  pz: number;
  py: number;
  ph: number;
  ptumble: number;
  group: THREE.Group;
}

type ImpactQuery = (
  x: number,
  z: number,
) => { speed: number; vx: number; vz: number; isPlayer: boolean } | null;

type Threat = { x: number; z: number; vx: number; vz: number } | null | undefined;
type ResolveCars = (x: number, z: number, radius: number) => { x: number; z: number };

/** Each pedestrian is an entity carrying its `Ped` data as one component. */
const Pedestrian = defineComponent<Ped>('Pedestrian');

const SHIRTS = [0xcf5b5b, 0x5b8acf, 0x6ccf8a, 0xcfc05b, 0xa05bcf, 0xdddddd, 0x444444];
const RADIUS = 0.35;
const SHOVE_SPEED = 2; // m/s: below this a car is too slow to do anything
const GIB_SPEED = 9; // m/s (~32 km/h): at/above this they explode; between, just shoved
const SHOVE_TIME = 1.6; // seconds knocked over before getting back up
const GIB_TIME = 3.5; // seconds gibbed before respawning elsewhere
const GRAVITY = 18;
/** Punches needed to put someone on the floor, and to get them off it again. */
export const PED_HP = 3;
/** Seconds spent face-down before struggling back to their feet. */
const DOWN_TIME = 3.2;
const FLEE_SPEED = 5; // scared pedestrians scurry faster than they stroll
// Fear triggers off the active player (on foot OR in a car):
const NEAR_RADIUS = 5.5; // proximity: anything this close scares them (walk-up or slow creep)
const PATH_LOOK = 18; // vector: a fast threat bearing down from up to this far
const PATH_WIDTH = 3.6; // ...within this lateral corridor of its heading (its sweep)
const VECTOR_SPEED = 8; // ...and moving at least this fast (a car, not a stroll)

/**
 * Wandering pedestrians with a three-state life: walking, shoved (clipped at
 * low speed — flung, tumbles, gets back up, survives), or gibbed (hit fast
 * enough to explode into cubes, then respawn elsewhere). Only the player's
 * gib kills score on the HUD.
 *
 * Migrated onto the ECS (see docs/research/ecs-architecture.md): each ped is an
 * entity with a `Pedestrian` component, and the walk/fear/impact loop and the
 * interpolated render are ECS systems. `peds` still exposes the same `Ped`
 * objects (the component values), so the debug handle and e2e are unchanged.
 */
export class Pedestrians {
  private readonly peds: Ped[] = [];
  private readonly rng: Rng;
  private tick = 0; // render-frame counter for the fear tremble
  runOverCount = 0;

  // Per-tick inputs the update system reads (set in `update` before stepping).
  private curCity?: City;
  private curImpact?: ImpactQuery;
  private curThreat: Threat;
  private curResolveCars?: ResolveCars;

  // Shares the one game World + the shared Debris pool; runs its passes directly.
  constructor(
    scene: THREE.Scene,
    private readonly city: City,
    private readonly world: World,
    private readonly debris: Debris,
    count = 60,
    seed = 333,
  ) {
    this.rng = createRng(seed);
    for (let i = 0; i < count; i++) {
      const color = this.rng.pick(SHIRTS);
      const group = makePed(color);
      scene.add(group);
      const x = this.rng.range(-city.half, city.half);
      const z = this.rng.range(-city.half, city.half);
      const heading = this.rng.range(0, Math.PI * 2);
      const ped: Ped = {
        state: 'walk', x, z, y: 0, heading, tumble: 0, color, scared: false,
        hp: PED_HP, heldBy: -1, holdT: 0, talking: 0,
        speed: this.rng.range(1, 2.2),
        turnTimer: this.rng.range(1, 5),
        vx: 0, vz: 0, vy: 0, timer: 0,
        px: x, pz: z, py: 0, ph: heading, ptumble: 0,
        group,
      };
      this.peds.push(ped);
      this.world.add(this.world.create(), Pedestrian, ped);
    }
  }

  update(city: City, dt: number, impactAt?: ImpactQuery, threat?: Threat, resolveCars?: ResolveCars): void {
    this.curCity = city;
    this.curImpact = impactAt;
    this.curThreat = threat;
    this.curResolveCars = resolveCars;
    this.stepPeds(this.world, dt);
  }

  /** Update system: advance every pedestrian (walk / flee / shoved / gibbed). */
  private stepPeds(w: World, dt: number): void {
    const city = this.curCity!;
    const impactAt = this.curImpact;
    const threat = this.curThreat;
    for (const e of w.query(Pedestrian)) {
      const ped = w.get(e, Pedestrian)!;
      ped.px = ped.x;
      ped.pz = ped.z;
      ped.py = ped.y;
      ped.ph = ped.heading;
      ped.ptumble = ped.tumble;

      if (ped.state === 'carried') {
        // Held in front of the carrier; the carrier's own position is applied
        // from outside, so here we only age the hold and keep the timer sane.
        ped.holdT += dt;
        ped.timer = 0.1;
        continue;
      }
      if (ped.state === 'down') {
        ped.timer -= dt;
        ped.tumble = ped.timer > 0.4 ? Math.PI / 2 : (ped.timer / 0.4) * (Math.PI / 2);
        if (ped.timer <= 0) {
          ped.state = 'walk';
          ped.tumble = 0;
          ped.scared = true; // and they run
        }
        continue;
      }
      if (ped.state === 'gibbed') {
        ped.timer -= dt;
        if (ped.timer <= 0) this.respawn(ped);
        continue;
      }
      if (ped.state === 'shoved') {
        this.updateShoved(ped, city, dt);
        continue;
      }

      // Panic from the active player (on foot OR a car): close proximity, or a
      // fast threat bearing down on a path to hit them. Flee away (proximity) or
      // dodge sideways out of the path (vector). Tremble is in render().
      ped.scared = false;
      if (threat) {
        const dx = ped.x - threat.x;
        const dz = ped.z - threat.z;
        const dist = Math.hypot(dx, dz);
        let fx = 0;
        let fz = 0;
        if (dist < NEAR_RADIUS) {
          ped.scared = true; // proximity: bolt straight away
          fx = dist > 1e-3 ? dx / dist : 1;
          fz = dist > 1e-3 ? dz / dist : 0;
        } else {
          const ts = Math.hypot(threat.vx, threat.vz);
          if (ts > VECTOR_SPEED && dist < PATH_LOOK) {
            const tnx = threat.vx / ts;
            const tnz = threat.vz / ts;
            const ahead = dx * tnx + dz * tnz; // ped in front of the threat?
            const lateral = dx * tnz - dz * tnx; // signed offset from its path
            if (ahead > 0 && Math.abs(lateral) < PATH_WIDTH) {
              ped.scared = true; // vector: dodge to the side it's already on
              const side = lateral >= 0 ? 1 : -1;
              fx = tnz * side;
              fz = -tnx * side;
            }
          }
        }
        if (ped.scared) {
          ped.heading = Math.atan2(-fz, fx);
          ped.x += fx * FLEE_SPEED * dt;
          ped.z += fz * FLEE_SPEED * dt;
        }
      }

      if (!ped.scared) {
        ped.turnTimer -= dt;
        if (ped.turnTimer <= 0) {
          ped.heading += (Math.sin(ped.x * 12.9 + ped.z * 78.2) * 0.5 + 0.5) * Math.PI - Math.PI / 2;
          ped.turnTimer = 2 + ((ped.x * 0.37 + ped.z * 0.91) % 3);
        }
        ped.x += Math.cos(ped.heading) * ped.speed * dt;
        ped.z -= Math.sin(ped.heading) * ped.speed * dt;
      }

      const fixed = city.grid.resolve(ped.x, ped.z, RADIUS);
      if (!ped.scared && (fixed.x !== ped.x || fixed.z !== ped.z)) ped.heading += Math.PI; // bounced off a wall
      ped.x = Math.max(-city.half, Math.min(city.half, fixed.x));
      ped.z = Math.max(-city.half, Math.min(city.half, fixed.z));

      // Don't walk through cars (parked or standing); fast cars still gib below.
      if (this.curResolveCars) {
        const r = this.curResolveCars(ped.x, ped.z, RADIUS);
        ped.x = r.x;
        ped.z = r.z;
      }

      const imp = impactAt?.(ped.x, ped.z);
      if (imp && imp.speed >= GIB_SPEED) this.gib(ped, imp);
      else if (imp && imp.speed >= SHOVE_SPEED) this.shove(ped, imp);
    }
  }

  private shove(ped: Ped, imp: { vx: number; vz: number }): void {
    ped.state = 'shoved';
    ped.timer = SHOVE_TIME;
    ped.vx = imp.vx * 0.5;
    ped.vz = imp.vz * 0.5;
    ped.vy = 2.5; // small pop
  }

  private updateShoved(ped: Ped, city: City, dt: number): void {
    ped.vy -= GRAVITY * dt;
    ped.y += ped.vy * dt;
    if (ped.y <= 0) {
      ped.y = 0;
      ped.vy = 0;
      ped.vx *= 0.82;
      ped.vz *= 0.82;
    }
    const fixed = city.grid.resolve(ped.x + ped.vx * dt, ped.z + ped.vz * dt, RADIUS);
    ped.x = Math.max(-city.half, Math.min(city.half, fixed.x));
    ped.z = Math.max(-city.half, Math.min(city.half, fixed.z));

    // Fall over, then clamber back up during the last stretch of the timer.
    ped.tumble = ped.timer > 0.5 ? Math.min(Math.PI / 2, ped.tumble + dt * 9) : (ped.timer / 0.5) * (Math.PI / 2);

    ped.timer -= dt;
    if (ped.timer <= 0) {
      ped.state = 'walk';
      ped.tumble = 0;
      ped.y = 0;
    }
  }

  /**
   * On-foot melee: gib the nearest walking pedestrian within reach and roughly
   * in front (along dirX,dirZ) — the same pixel burst as a car hit — and score
   * it (which raises heat, like any kill). Returns whether it connected.
   */
  /**
   * The nearest walking pedestrian in the cone, for the shared target resolver.
   * Returns an index so the caller can act through the public verbs below.
   */
  nearest(x: number, z: number, dirX: number, dirZ: number, reach: number): number {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < this.peds.length; i++) {
      const ped = this.peds[i];
      if (ped.state !== 'walk' || ped.heldBy >= 0) continue;
      const dx = ped.x - x;
      const dz = ped.z - z;
      const d = Math.hypot(dx, dz);
      if (d > reach || d < 1e-3) continue;
      const facing = (dx / d) * dirX + (dz / d) * dirZ;
      if (facing < 0.35) continue;
      const v = facing * facing * 2.2 - d / reach;
      if (v > bestScore) { bestScore = v; best = i; }
    }
    return best;
  }

  /** A few words for whoever you stop. Cantonese, because this is 中山路. */
  talk(x: number, z: number, dirX: number, dirZ: number, reach: number): string | null {
    const i = this.nearest(x, z, dirX, dirZ, reach);
    if (i < 0) return null;
    const ped = this.peds[i];
    ped.talking = 2.5;
    ped.heading = Math.atan2(-dirZ, dirX) + Math.PI; // turn to face the player
    return this.pickLine(i);
  }

  private pickLine(i: number): string {
    const lines = [
      '唔好意思，赶时间啊。',
      '今日人好多，唔够位。',
      '食咗未？老友粉喎。',
      '再往前就系粉饺嗰间。',
      '夜市要六点先开嘅。',
    ];
    return lines[(i * 7 + this.tick) % lines.length];
  }

  /**
   * A punch lands, staggers, and eventually puts someone on the floor. It used
   * to delete them outright: `gib` was the only outcome, which is a punch that
   * removes a person from the world and reads as a bug no matter how the debris
   * is coloured. Getting up is the part that makes it a person.
   */
  punch(x: number, z: number, dirX: number, dirZ: number, reach: number, damage: number): boolean {
    const i = this.nearest(x, z, dirX, dirZ, reach);
    if (i < 0) return false;
    const ped = this.peds[i];
    ped.hp -= damage;
    ped.talking = 0;
    this.shove(ped, { vx: dirX * SHOVE_SPEED * 0.8, vz: dirZ * SHOVE_SPEED * 0.8 });
    ped.scared = true; // and they remember your face
    if (ped.hp <= 0) {
      ped.hp = PED_HP;
      ped.state = 'down';
      ped.timer = DOWN_TIME;
      ped.tumble = Math.PI / 2;
      ped.y = 0;
    }
    return true;
  }

  /**
   * Pick someone up. Holding a person costs you: you walk slower and you cannot
   * swing. Without that cost, carrying is strictly better than talking, and
   * nobody would ever choose to talk.
   */
  grab(x: number, z: number, dirX: number, dirZ: number, reach: number): boolean {
    const i = this.nearest(x, z, dirX, dirZ, reach);
    if (i < 0) return false;
    const ped = this.peds[i];
    ped.state = 'carried';
    ped.heldBy = 0;
    ped.holdT = 0;
    ped.vx = ped.vz = ped.vy = 0;
    ped.tumble = 0;
    ped.scared = false;
    return true;
  }

  /** Let go. `power` throws them; zero just drops them at your feet. */
  release(power: number, dirX: number, dirZ: number): boolean {
    for (const ped of this.peds) {
      if (ped.state !== 'carried') continue;
      ped.heldBy = -1;
      ped.holdT = 0;
      if (power > 0) {
        ped.state = 'shoved';
        ped.timer = SHOVE_TIME;
        ped.vx = dirX * power;
        ped.vz = dirZ * power;
        ped.vy = 2.5;
        ped.scared = true;
      } else {
        ped.state = 'walk';
        ped.scared = true;
      }
      return true;
    }
    return false;
  }

  /** Carrying someone? Movement is taxed and the fist is busy. */
  carrying(): boolean {
    for (const ped of this.peds) if (ped.state === 'carried') return true;
    return false;
  }

  private gib(ped: Ped, imp: { vx: number; vz: number; isPlayer: boolean }): void {
    ped.state = 'gibbed';
    ped.timer = GIB_TIME;
    ped.group.visible = false;
    this.debris.burst(ped.x, ped.z, ped.color, imp.vx, imp.vz);
    if (imp.isPlayer) this.runOverCount++;
  }

  private respawn(ped: Ped): void {
    ped.x = ped.px = this.rng.range(-this.city.half, this.city.half);
    ped.z = ped.pz = this.rng.range(-this.city.half, this.city.half);
    ped.y = ped.py = 0;
    ped.heading = ped.ph = this.rng.range(0, Math.PI * 2);
    ped.tumble = ped.ptumble = 0;
    ped.state = 'walk';
    ped.turnTimer = this.rng.range(1, 5);
    ped.group.visible = true;
  }

  /** How many pedestrians exist, for the target resolver. */
  count(): number {
    return this.peds.length;
  }

  /** Read-only view of pedestrian `i`, for the target resolver. */
  at(i: number): { x: number; z: number; hp: number; state: string; heldBy: number } | null {
    const p = this.peds[i];
    return p ? { x: p.x, z: p.z, hp: p.hp, state: p.state, heldBy: p.heldBy } : null;
  }

  render(alpha: number, held: { x: number; y: number; z: number } | null = null): void {
    this.drawPeds(this.world, alpha, held);
  }

  /** Render system: position meshes, interpolating between physics steps. */
  /**
   * Where the carried person is held: out in front, at chest height, tilted.
   * Called by main with the carrier's pose so the two never drift apart.
   */
  holdPose(carrier: { x: number; z: number; heading: number }): { x: number; y: number; z: number } | null {
    for (const ped of this.peds) {
      if (ped.state !== 'carried') continue;
      const fx = Math.cos(carrier.heading);
      const fz = -Math.sin(carrier.heading);
      return { x: carrier.x + fx * 0.85, y: 1.05, z: carrier.z + fz * 0.85 };
    }
    return null;
  }

  private drawPeds(w: World, alpha: number, held: { x: number; y: number; z: number } | null): void {
    this.tick++;
    for (const e of w.query(Pedestrian)) {
      const ped = w.get(e, Pedestrian)!;
      if (ped.state === 'gibbed') continue; // hidden while exploded
      if (ped.state === 'carried' && held) {
        // Drawn at the carrier's shoulder rather than interpolating toward a
        // position the simulation never put them in.
        ped.group.position.set(held.x, held.y, held.z);
        ped.group.rotation.set(-0.5, ped.heading, 0.2);
        continue;
      }
      // A fast little tremble (visual only) while scared.
      let sx = 0;
      let sz = 0;
      let roll = 0;
      if (ped.scared) {
        sx = Math.sin(this.tick * 1.1 + ped.z) * 0.18;
        sz = Math.cos(this.tick * 1.3 + ped.x) * 0.18;
        roll = Math.sin(this.tick * 1.7 + ped.x) * 0.4; // a real visible shudder
      }
      ped.group.position.set(
        lerp(ped.px, ped.x, alpha) + sx,
        lerp(ped.py, ped.y, alpha),
        lerp(ped.pz, ped.z, alpha) + sz,
      );
      ped.group.rotation.set(lerp(ped.ptumble, ped.tumble, alpha), angleLerp(ped.ph, ped.heading, alpha), roll);
    }
  }
}
