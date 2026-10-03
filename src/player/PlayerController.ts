/**
 * On-foot controller. Pure: no Three.js. One `stepPlayer` call is one fixed
 * 60 Hz tick. The avatar wrapper in `entities/Player` stores a `PlayerSim`
 * and forwards input.
 */

import { angleDelta, clamp } from '../core/math';
import {
  ceilingAt,
  groundHeightAt,
  resolveCapsule,
  type Aabb3,
} from '../systems/Collision';
import { PLAYER, jumpTakeoffSpeed } from './params';

export type PlayerState =
  | 'idle'
  | 'walk'
  | 'jog'
  | 'sprint'
  | 'crouch'
  | 'crouchWalk'
  | 'air'
  | 'land'
  | 'carry'
  | 'punch'
  | 'sit'
  | 'eat';

export type CarryMode = 'none' | '1h' | '2h';

export interface PlayerSim {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  grounded: boolean;
  groundY: number;
  stance: 'stand' | 'crouch';
  state: PlayerState;
  stateTime: number;
  stamina: number;
  staminaMax: number;
  exhausted: boolean;
  coyote: number;
  jumpBuffer: number;
  /** Seconds left before stamina starts refilling. */
  regenWait: number;
  health: number;
  /** Feet height at the moment we left the ground, for fall damage. */
  fallFrom: number;
  landTimer: number;
  /** Latch so staminaEmpty fires once per empty-out. */
  staminaEmptySent: boolean;
  prev: { x: number; y: number; z: number; heading: number };
}

export interface PlayerStepInput {
  moveX: number;
  moveY: number;
  camYaw: number;
  sprint: boolean;
  /** Alt, or a stick held under half deflection. */
  walkMod: boolean;
  crouchPressed: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
}

export interface MoveModifiers {
  /** Buffs and other multipliers. 1 = unchanged. */
  speedMul: number;
  carry: CarryMode;
  /** 0–130. Above 100 the player is 吃撑 and slows down. */
  satiety: number;
}

export interface PlayerWorld {
  /** Write nearby height boxes into `out`. Return the count. */
  query(x: number, z: number, radius: number, out: Aabb3[]): number;
}

export type PlayerEvent =
  | { kind: 'jumped' }
  | { kind: 'landed'; impactVy: number; drop: number }
  | { kind: 'fallDamage'; amount: number }
  | { kind: 'staminaEmpty' }
  | { kind: 'footstep' };

export const EMPTY_MODIFIERS: MoveModifiers = { speedMul: 1, carry: 'none', satiety: 80 };

export function createPlayerSim(x = 0, z = 0, y = 0): PlayerSim {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: 0,
    grounded: true,
    groundY: y,
    stance: 'stand',
    state: 'idle',
    stateTime: 0,
    stamina: PLAYER.staminaMax,
    staminaMax: PLAYER.staminaMax,
    exhausted: false,
    coyote: PLAYER.coyoteTime,
    jumpBuffer: 0,
    regenWait: 0,
    health: 100,
    fallFrom: y,
    landTimer: 0,
    staminaEmptySent: false,
    prev: { x, y, z, heading: 0 },
  };
}

const scratch: Aabb3[] = new Array(256);

function nearby(world: PlayerWorld, x: number, z: number, r: number): number {
  return world.query(x, z, r, scratch);
}

function speedMulOf(m: MoveModifiers): number {
  let mul = m.speedMul;
  if (m.satiety > PLAYER.overfullSatiety) mul *= PLAYER.overfullSpeedMul;
  if (m.carry === '1h') mul *= PLAYER.carry1HSpeedMul;
  if (m.carry === '2h') mul *= PLAYER.carry2HSpeedMul;
  return mul;
}

function targetSpeed(inp: PlayerStepInput, stance: 'stand' | 'crouch', sprinting: boolean, m: MoveModifiers): number {
  const mag = Math.hypot(inp.moveX, inp.moveY);
  if (mag < 1e-3) return 0;
  const mul = speedMulOf(m);
  if (stance === 'crouch') return PLAYER.crouchSpeed * Math.min(1, mag) * mul;
  if (sprinting) return PLAYER.sprintSpeed * Math.min(1, mag) * mul;
  const walking = inp.walkMod || mag < 0.5;
  if (walking) return PLAYER.walkSpeed * Math.min(1, mag / 0.5) * mul;
  return PLAYER.jogSpeed * Math.min(1, mag) * mul;
}

export function stepPlayer(
  s: PlayerSim,
  inp: PlayerStepInput,
  world: PlayerWorld,
  dt: number,
  modifiers: MoveModifiers = EMPTY_MODIFIERS,
): PlayerEvent[] {
  const events: PlayerEvent[] = [];
  const p = PLAYER;
  s.prev.x = s.x;
  s.prev.y = s.y;
  s.prev.z = s.z;
  s.prev.heading = s.heading;

  if (inp.crouchPressed) s.stance = s.stance === 'crouch' ? 'stand' : 'crouch';
  const wasGrounded = s.grounded;

  const mag = Math.hypot(inp.moveX, inp.moveY);
  const wantSprint =
    inp.sprint &&
    s.stance === 'stand' &&
    modifiers.carry !== '2h' &&
    !s.exhausted &&
    s.stamina > 0 &&
    mag > 0.2 &&
    s.landTimer <= 0;
  const speed = targetSpeed(inp, s.stance, wantSprint, modifiers);

  const yaw = inp.camYaw;
  const wishX = Math.cos(yaw) * inp.moveY + Math.sin(yaw) * inp.moveX;
  const wishZ = -Math.sin(yaw) * inp.moveY + Math.cos(yaw) * inp.moveX;
  const wishMag = Math.hypot(wishX, wishZ);
  const dirX = wishMag > 1e-4 ? wishX / wishMag : 0;
  const dirZ = wishMag > 1e-4 ? wishZ / wishMag : 0;
  const desiredVx = dirX * speed;
  const desiredVz = dirZ * speed;

  const speeding = speed > Math.hypot(s.vx, s.vz) - 1e-3;
  const rate = (s.grounded ? (speeding ? p.accelGround : p.decelGround) : p.accelGround * p.airControl);
  const dvx = desiredVx - s.vx;
  const dvz = desiredVz - s.vz;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = rate * dt;
  if (dv <= maxDv || dv < 1e-8) {
    s.vx = desiredVx;
    s.vz = desiredVz;
  } else {
    s.vx += (dvx / dv) * maxDv;
    s.vz += (dvz / dv) * maxDv;
  }

  if (wishMag > 0.15) {
    const face = Math.atan2(-dirZ, dirX);
    s.heading += clamp(angleDelta(s.heading, face), -p.turnRate * dt, p.turnRate * dt);
  }

  if (inp.jumpPressed) s.jumpBuffer = p.jumpBuffer;
  else s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);

  const canJump = (s.grounded || s.coyote > 0) && s.stamina >= p.jumpCost && s.landTimer <= 0;
  let jumped = false;
  if (s.jumpBuffer > 0 && canJump) {
    s.vy = jumpTakeoffSpeed();
    s.grounded = false;
    s.coyote = 0;
    s.jumpBuffer = 0;
    s.stamina = Math.max(0, s.stamina - p.jumpCost);
    s.regenWait = p.regenDelay;
    s.fallFrom = s.y;
    s.stance = 'stand';
    jumped = true;
    events.push({ kind: 'jumped' });
  }

  const holdingSprint =
    inp.sprint && s.stance === 'stand' && modifiers.carry !== '2h' && mag > 0.2;
  if (wantSprint) {
    s.stamina = Math.max(0, s.stamina - p.sprintDrain * dt);
    s.regenWait = p.regenDelay;
    if (s.stamina <= 0) {
      s.stamina = 0;
      s.exhausted = true;
      if (!s.staminaEmptySent) {
        s.staminaEmptySent = true;
        events.push({ kind: 'staminaEmpty' });
      }
    }
  } else if (holdingSprint) {
    // Still holding sprint while empty or stunned: the delay does not run down.
    s.regenWait = p.regenDelay;
  } else if (s.regenWait > 0) {
    s.regenWait = Math.max(0, s.regenWait - dt);
  } else {
    s.stamina = Math.min(s.staminaMax, s.stamina + p.staminaRegen * dt);
    if (s.exhausted && s.stamina >= p.exhaustRecover) {
      s.exhausted = false;
      s.staminaEmptySent = false;
    }
  }

  const height = s.stance === 'crouch' ? p.heightCrouch : p.heightStand;
  const prevVy = s.vy;
  s.vy -= p.gravity * dt;
  s.y += ((prevVy + s.vy) * 0.5) * dt;

  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const n = nearby(world, s.x, s.z, p.radius + 0.8);
  // Gravity has already dipped the feet a few millimetres. Step rejection uses
  // the surface we were standing on, so a lip of exactly stepHeight still counts.
  const feetForStep = wasGrounded ? Math.max(s.y, s.groundY) : s.y;
  const pushed = resolveCapsule(s.x, s.z, feetForStep, height, p.radius, p.stepHeight, scratch, n);
  s.x = pushed.x;
  s.z = pushed.z;

  if (s.vy > 0) {
    const ceil = ceilingAt(s.x, s.z, s.y, height, p.radius, scratch, n);
    if (s.y + height > ceil) {
      s.y = ceil - height;
      s.vy = 0;
    }
  }

  // Feet sample, plus a short forward probe so a jump can catch a table edge
  // on the same tick the step window opens (the 1.05 m high table).
  let support = groundHeightAt(s.x, s.z, p.radius * 0.7, feetForStep + p.stepHeight, scratch, n);
  if (!s.grounded || s.vy > 0) {
    const fx = Math.cos(s.heading);
    const fz = -Math.sin(s.heading);
    const ahead = groundHeightAt(
      s.x + fx * 0.22,
      s.z + fz * 0.22,
      p.radius * 0.55,
      feetForStep + p.stepHeight,
      scratch,
      n,
    );
    if (ahead > support) support = ahead;
  }

  if (s.y <= support + 1e-3 && s.vy <= 0) {
    const drop = s.fallFrom - support;
    const impact = s.vy;
    s.y = support;
    s.vy = 0;
    s.grounded = true;
    s.groundY = support;
    s.coyote = p.coyoteTime;
    // A jump buffered just before touchdown leaves the ground again this step.
    const buffered = !jumped && !wasGrounded && s.jumpBuffer > 0 && s.stamina >= p.jumpCost;
    if (buffered) {
      s.vy = jumpTakeoffSpeed();
      s.grounded = false;
      s.coyote = 0;
      s.jumpBuffer = 0;
      s.stamina = Math.max(0, s.stamina - p.jumpCost);
      s.regenWait = p.regenDelay;
      s.fallFrom = s.y;
      s.stance = 'stand';
      jumped = true;
      events.push({ kind: 'jumped' });
    } else if (!wasGrounded && !jumped) {
      events.push({ kind: 'landed', impactVy: impact, drop });
      if (drop > p.maxFallNoDamage) {
        events.push({ kind: 'fallDamage', amount: (drop - p.maxFallNoDamage) * 12 });
      }
      s.landTimer = drop > p.landStunFall ? p.landStunLong : p.landStun;
    }
  } else if (wasGrounded && !jumped && support < s.y - p.stepHeight - 1e-3) {
    s.grounded = false;
    s.groundY = support;
    s.fallFrom = s.y;
    s.coyote = p.coyoteTime;
  } else if (
    (wasGrounded || s.grounded) &&
    !jumped &&
    support >= s.y - 1e-3 &&
    support - s.y <= p.stepHeight
  ) {
    const rise = Math.min(p.stepSnapSpeed * dt, support - s.y);
    s.y += rise;
    if (support - s.y <= 1e-3) s.y = support;
    s.vy = 0;
    s.grounded = true;
    s.groundY = s.y;
    s.coyote = p.coyoteTime;
  } else {
    s.grounded = false;
    s.groundY = support;
    if (wasGrounded && !jumped) {
      s.fallFrom = Math.max(s.fallFrom, s.y);
      s.coyote = p.coyoteTime;
    } else {
      s.coyote = Math.max(0, s.coyote - dt);
    }
  }

  if (s.landTimer > 0) s.landTimer = Math.max(0, s.landTimer - dt);

  const horiz = Math.hypot(s.vx, s.vz);
  const prev = s.state;
  if (!s.grounded) s.state = 'air';
  else if (s.landTimer > 0 && prev === 'air') s.state = 'land';
  else if (s.landTimer > 0 && s.state === 'land') s.state = 'land';
  else if (s.stance === 'crouch') s.state = horiz > 0.2 ? 'crouchWalk' : 'crouch';
  else if (wantSprint && horiz > 1) s.state = 'sprint';
  else if (horiz > p.jogSpeed * 0.55) s.state = 'jog';
  else if (horiz > 0.25) s.state = 'walk';
  else s.state = 'idle';

  // Hooks the dining / carry systems set from outside. Locomotion overwrites
  // them only while those systems are not holding the pose — they assign the
  // state after stepPlayer returns. See animState().
  if (s.state !== prev) s.stateTime = 0;
  else s.stateTime += dt;

  return events;
}

/** Pose name for the rig. Sit / eat / carry are passed through when set. */
export function animState(s: PlayerSim, held: PlayerState | null): PlayerState {
  if (held === 'sit' || held === 'eat' || held === 'carry' || held === 'punch') return held;
  if (s.state === 'air') return 'air';
  if (s.state === 'land') return 'land';
  return s.state;
}
