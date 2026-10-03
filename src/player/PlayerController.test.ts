import { describe, expect, it } from 'vitest';
import type { Aabb3 } from '../systems/Collision';
import {
  createPlayerSim,
  stepPlayer,
  type MoveModifiers,
  type PlayerSim,
  type PlayerStepInput,
  type PlayerWorld,
} from './PlayerController';
import { PLAYER } from './params';

const DT = 1 / 60;

function worldOf(boxes: readonly Aabb3[]): PlayerWorld {
  return {
    query(x, z, r, out) {
      let n = 0;
      for (const b of boxes) {
        if (b.maxX < x - r || b.minX > x + r || b.maxZ < z - r || b.minZ > z + r) continue;
        out[n++] = b;
      }
      return n;
    },
  };
}

const hold = (over: Partial<PlayerStepInput> = {}): PlayerStepInput => ({
  moveX: 0,
  moveY: 0,
  camYaw: 0,
  sprint: false,
  walkMod: false,
  crouchPressed: false,
  jumpPressed: false,
  jumpHeld: false,
  ...over,
});

function run(s: PlayerSim, world: PlayerWorld, input: PlayerStepInput, seconds: number, mods?: MoveModifiers): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) stepPlayer(s, input, world, DT, mods);
}

const speedOf = (s: PlayerSim): number => Math.hypot(s.vx, s.vz);

describe('stepPlayer locomotion', () => {
  const flat = worldOf([]);

  it('reaches jog speed in about 0.3 s', () => {
    const s = createPlayerSim();
    run(s, flat, hold({ moveY: 1 }), 0.3);
    expect(speedOf(s)).toBeGreaterThan(4.05);
    expect(speedOf(s)).toBeLessThanOrEqual(PLAYER.jogSpeed + 0.05);
    expect(s.state).toBe('jog');
  });

  it('walks when Alt is held and crouches on toggle', () => {
    const s = createPlayerSim();
    run(s, flat, hold({ moveY: 1, walkMod: true }), 0.6);
    expect(speedOf(s)).toBeLessThan(PLAYER.walkSpeed + 0.05);
    expect(speedOf(s)).toBeGreaterThan(1.4);
    expect(s.state).toBe('walk');

    stepPlayer(s, hold({ crouchPressed: true }), flat, DT);
    run(s, flat, hold({ moveY: 1 }), 0.5);
    expect(s.stance).toBe('crouch');
    expect(speedOf(s)).toBeLessThan(PLAYER.crouchSpeed + 0.05);
    expect(s.state === 'crouchWalk' || s.state === 'crouch').toBe(true);
  });

  it('drains stamina while sprinting and refuses another sprint until 25', () => {
    const s = createPlayerSim();
    run(s, flat, hold({ moveY: 1, sprint: true }), 6);
    expect(s.stamina).toBe(0);
    expect(s.exhausted).toBe(true);
    run(s, flat, hold({ moveY: 1, sprint: true }), 0.4);
    expect(speedOf(s)).toBeLessThan(PLAYER.jogSpeed + 0.15);
    // Recover, but not yet to the sprint gate.
    run(s, flat, hold(), 0.8 + 1.2);
    expect(s.stamina).toBeGreaterThan(5);
    expect(s.stamina).toBeLessThan(PLAYER.exhaustRecover);
    expect(s.exhausted).toBe(true);
    run(s, flat, hold({ moveY: 1, sprint: true }), 0.3);
    expect(speedOf(s)).toBeLessThan(PLAYER.jogSpeed + 0.2);
    run(s, flat, hold(), 2);
    expect(s.stamina).toBeGreaterThanOrEqual(PLAYER.exhaustRecover);
    expect(s.exhausted).toBe(false);
    run(s, flat, hold({ moveY: 1, sprint: true }), 0.8);
    expect(speedOf(s)).toBeGreaterThan(6);
  });

  it('jumps about 0.75 m', () => {
    const s = createPlayerSim();
    let peak = 0;
    stepPlayer(s, hold({ jumpPressed: true }), flat, DT);
    for (let i = 0; i < 90; i++) {
      stepPlayer(s, hold(), flat, DT);
      if (s.y > peak) peak = s.y;
    }
    expect(peak).toBeGreaterThan(0.73);
    expect(peak).toBeLessThan(0.77);
    expect(s.grounded).toBe(true);
    expect(s.y).toBeCloseTo(0, 2);
  });

  it('still jumps just after walking off a ledge (coyote time)', () => {
    const ledge: Aabb3[] = [
      { minX: -2, maxX: 0, minZ: -1, maxZ: 1, minY: 0, maxY: 1, kind: 'walkable' },
    ];
    const world = worldOf(ledge);
    const s = createPlayerSim(-0.4, 0, 1);
    // Run off the +X end.
    let jumped = false;
    for (let i = 0; i < 80 && !jumped; i++) {
      const before = s.grounded;
      const ev = stepPlayer(s, hold({ moveY: 1 }), world, DT);
      if (before && !s.grounded) {
        const late = stepPlayer(s, hold({ moveY: 1, jumpPressed: true }), world, DT);
        expect(late.some((e) => e.kind === 'jumped') || ev.some((e) => e.kind === 'jumped')).toBe(true);
        expect(s.vy).toBeGreaterThan(4);
        jumped = true;
      }
    }
    expect(jumped).toBe(true);
  });

  it('buffers a jump pressed slightly before landing', () => {
    const s = createPlayerSim(0, 0, 0.35);
    s.grounded = false;
    s.vy = -1;
    s.coyote = 0;
    s.fallFrom = 0.35;
    let hopped = false;
    for (let i = 0; i < 30; i++) {
      const press = i === 2;
      const ev = stepPlayer(s, hold({ jumpPressed: press }), worldOf([]), DT);
      if (ev.some((e) => e.kind === 'jumped')) hopped = true;
    }
    expect(hopped).toBe(true);
    expect(s.y).toBeGreaterThan(0.2);
  });

  it('slows down while carrying and while overfull', () => {
    const one = createPlayerSim();
    run(one, flat, hold({ moveY: 1 }), 1, { speedMul: 1, carry: '1h', satiety: 50 });
    expect(speedOf(one)).toBeCloseTo(PLAYER.jogSpeed * PLAYER.carry1HSpeedMul, 1);

    const two = createPlayerSim();
    run(two, flat, hold({ moveY: 1, sprint: true }), 1, { speedMul: 1, carry: '2h', satiety: 50 });
    expect(speedOf(two)).toBeLessThan(PLAYER.jogSpeed * PLAYER.carry2HSpeedMul + 0.15);
    expect(speedOf(two)).toBeGreaterThan(1.5);

    const full = createPlayerSim();
    run(full, flat, hold({ moveY: 1 }), 1, { speedMul: 1, carry: 'none', satiety: 120 });
    expect(speedOf(full)).toBeCloseTo(PLAYER.jogSpeed * PLAYER.overfullSpeedMul, 1);
  });
});

describe('stepPlayer steps and climbs', () => {
  function climb(top: number, sprint: boolean): PlayerSim {
    const box: Aabb3 = {
      minX: 0.85,
      maxX: 2.4,
      minZ: -0.7,
      maxZ: 0.7,
      minY: Math.max(0, top - 0.08),
      maxY: top,
      kind: 'walkable',
    };
    const s = createPlayerSim(0, 0, 0);
    const world = worldOf([box]);
    let launched = false;
    for (let i = 0; i < 200; i++) {
      const jump = !launched && s.x > 0.35;
      if (jump) launched = true;
      stepPlayer(s, hold({ moveY: 1, sprint, jumpPressed: jump }), world, DT);
      if (launched && s.grounded && s.y > top - 0.05 && s.x > 0.9 && s.x < 2.3) return s;
    }
    return s;
  }

  it('steps a 0.15 m arcade and a 0.30 m lip without jumping', () => {
    for (const top of [0.15, 0.3]) {
      const box: Aabb3 = {
        minX: 0.4,
        maxX: 8,
        minZ: -2,
        maxZ: 2,
        minY: 0,
        maxY: top,
        kind: 'walkable',
      };
      const s = createPlayerSim(0, 0, 0);
      run(s, worldOf([box]), hold({ moveY: 1 }), 1.2);
      expect(s.y).toBeGreaterThan(top - 0.02);
      expect(s.x).toBeGreaterThan(0.7);
      expect(s.state).not.toBe('air');
    }
  });

  it('cannot walk up a 0.31 m lip', () => {
    const box: Aabb3 = {
      minX: 0.5,
      maxX: 3,
      minZ: -2,
      maxZ: 2,
      minY: 0,
      maxY: 0.31,
      kind: 'solid',
    };
    const s = createPlayerSim(0, 0, 0);
    run(s, worldOf([box]), hold({ moveY: 1 }), 1);
    expect(s.y).toBeLessThan(0.05);
    expect(s.x).toBeLessThan(0.5);
  });

  it('jumps onto a stool (0.45), a table (0.75) and a high table (1.05)', () => {
    for (const top of [0.45, 0.75, 1.05]) {
      const s = climb(top, top >= 0.75);
      expect(s.grounded).toBe(true);
      expect(s.y).toBeCloseTo(top, 1);
    }
  });

  it('cannot clear a 1.10 m rail', () => {
    const rail: Aabb3 = {
      minX: 0.7,
      maxX: 1.0,
      minZ: -2,
      maxZ: 2,
      minY: 0,
      maxY: 1.1,
      kind: 'solid',
    };
    const s = createPlayerSim(0, 0, 0);
    const world = worldOf([rail]);
    let jumped = false;
    for (let i = 0; i < 180; i++) {
      const press = !jumped && s.x > 0.25;
      if (press) jumped = true;
      stepPlayer(s, hold({ moveY: 1, sprint: true, jumpPressed: press }), world, DT);
    }
    expect(s.x).toBeLessThan(0.7);
    expect(s.y).toBeLessThan(0.2);
  });
});
