import { describe, it, expect } from 'vitest';
import { approachCameraDistance, cameraPullDistance, clampPitch, followDistance, lookLead, resolveChaseEye, type CamBox, type ChaseConfine, type FollowParams } from './followCam';
import { generateNanningCity } from '../nanning/layout';
import { buildInterior, type ShopShell } from '../nanning/interiors';
import type { Aabb3 } from '../systems/Collision';
import { damp } from './math';

const CAR_CAM: FollowParams = {
  distance: 9,
  height: 4.2,
  lookHeight: 1.4,
  stiffness: 4,
  speedPull: 0.16,
  slideSwing: 0.3,
  maxSwing: 2,
};

/**
 * Forward-axis framing: car moving at `speed` along heading. Returns how far it ends up
 * *ahead* of the look-at (positive = drifted toward the top of the screen).
 */
function forwardOffset(speed: number, withLead: boolean): number {
  const dt = 1 / 60;
  const lead = withLead ? lookLead(CAR_CAM, speed, 0).forward : 0;
  let car = 0;
  let look = 0;
  for (let i = 0; i < 600; i++) {
    car += speed * dt;
    look = damp(look, car + lead, CAR_CAM.stiffness, dt);
  }
  return car - look;
}

/**
 * Lateral-axis framing during a slide: car translating sideways at `vLateral` (with some
 * forward `vForward`). Returns the residual sideways offset of the car from centre — the
 * powerslide "swing".
 */
function lateralSwing(vForward: number, vLateral: number): number {
  const dt = 1 / 60;
  const lead = lookLead(CAR_CAM, vForward, vLateral).lateral;
  let car = 0;
  let look = 0;
  for (let i = 0; i < 600; i++) {
    car += vLateral * dt;
    look = damp(look, car + lead, CAR_CAM.stiffness, dt);
  }
  return car - look;
}

describe('followDistance', () => {
  it('pulls in with speed, clamped at half the resting distance', () => {
    expect(followDistance(CAR_CAM, 0)).toBeCloseTo(9);
    expect(followDistance(CAR_CAM, 10)).toBeCloseTo(9 - 10 * 0.16);
    expect(followDistance(CAR_CAM, 1000)).toBeCloseTo(4.5);
  });
});

describe('lookLead', () => {
  it('leads the forward component fully (speed / stiffness)', () => {
    expect(lookLead(CAR_CAM, 0, 0)).toEqual({ forward: 0, lateral: 0 });
    expect(lookLead(CAR_CAM, 8, 0).forward).toBeCloseTo(2);
  });

  it('leaves a bounded fraction of the lateral lag as swing', () => {
    // vLateral 8 → full lag 2; slideSwing 0.3 leaves 0.6 → lateral lead 1.4.
    expect(lookLead(CAR_CAM, 0, 8).lateral).toBeCloseTo(2 * (1 - 0.3));
    // A big slide: full lag 5, swing capped at maxSwing(2) → lateral lead 5 - 1.5.
    expect(lookLead(CAR_CAM, 0, 20).lateral).toBeCloseTo(5 - Math.min(2, 5 * 0.3));
  });
});

describe('camera framing', () => {
  it('keeps the car centred along travel across the speed range (forward fix)', () => {
    for (const speed of [0, 5, 15, 30]) {
      expect(Math.abs(forwardOffset(speed, true))).toBeLessThan(0.3);
    }
  });

  it('without the lead the car drifts forward with speed — the original bug', () => {
    const slow = forwardOffset(5, false);
    const fast = forwardOffset(30, false);
    expect(slow).toBeGreaterThan(0.5);
    expect(fast).toBeGreaterThan(slow); // drift grows with speed
    expect(Math.abs(forwardOffset(30, true))).toBeLessThan(fast / 10); // lead removes it
  });

  it('lets the car swing out a little in a powerslide — small + bounded, not pinned, not excessive', () => {
    const swing = Math.abs(lateralSwing(18, 12));
    expect(swing).toBeGreaterThan(0.05); // not pinned dead-centre
    expect(swing).toBeLessThanOrEqual(CAR_CAM.maxSwing! + 1e-9); // never past the cap (~20% screen)
    expect(swing).toBeLessThan(12 / CAR_CAM.stiffness); // far less than the original full swing
  });
});

describe('on-foot camera occlusion', () => {
  it('stops short of a wall and does not push the eye back through it', () => {
    // 5.5 m segment, wall at t=0.5 → hit at 2.75, eye at 2.55.
    expect(cameraPullDistance(5.5, 0.5)).toBeCloseTo(2.55, 5);
    // Wall at 0.275 m. Clamping up to 0.8 m used to bury the lens in the wall.
    expect(cameraPullDistance(5.5, 0.05)).toBeCloseTo(0.075, 5);
    expect(cameraPullDistance(5.5, 0.05)).toBeLessThan(0.8);
    expect(cameraPullDistance(5.5, -1)).toBeCloseTo(5.5, 5);
  });

  it('snaps inward and eases back out at 3 m/s', () => {
    expect(approachCameraDistance(5.5, 2.0, 1 / 60)).toBeCloseTo(2.0, 5);
    expect(approachCameraDistance(2.0, 5.5, 1)).toBeCloseTo(5.0, 5);
    expect(approachCameraDistance(2.0, 5.5, 2)).toBeCloseTo(5.5, 5);
  });

  it('clamps pitch into the street range', () => {
    const min = (-30 * Math.PI) / 180;
    const max = (55 * Math.PI) / 180;
    expect(clampPitch(0.4, min, max)).toBeCloseTo(0.4, 5);
    expect(clampPitch(1, min, max)).toBeCloseTo(max, 5);
    expect(clampPitch(-2, min, max)).toBeCloseTo(min, 5);
    expect(clampPitch(2, min, max)).toBeCloseTo(max, 5);
  });
});

function shopAir(shell: ShopShell): ChaseConfine {
  const m = 0.62;
  return {
    minX: shell.cx - shell.depth / 2 + m,
    maxX: shell.cx + shell.depth / 2 - m,
    minZ: shell.cz - shell.width / 2 + m,
    maxZ: shell.cz + shell.width / 2 - m,
    minY: 0.4,
    maxY: 2.45,
  };
}

function occluders(shell: ShopShell): CamBox[] {
  const city = generateNanningCity(1945);
  const buf: Aabb3[] = [];
  const n = city.heightGrid.query(shell.cx, shell.cz, 14, buf);
  const blocks: CamBox[] = buf.slice(0, n).filter((b) => b.camBlock);
  for (const c of buildInterior(shell).colliders) {
    if (c.camBlock) blocks.push(c);
  }
  return blocks;
}

function buried(eye: { x: number; y: number; z: number }, blocks: readonly CamBox[]): boolean {
  return blocks.some(
    (b) => eye.x > b.minX && eye.x < b.maxX && eye.y > b.minY && eye.y < b.maxY && eye.z > b.minZ && eye.z < b.maxZ,
  );
}

describe('resolveChaseEye indoors', () => {
  const city = generateNanningCity(1945);
  const shells: ShopShell[] = city.shops
    .filter((s) => !s.nightOnly && ['noodle', 'fenjiao', 'grill', 'tea'].includes(s.def.kind))
    .map((s) => {
      const b = city.buildings[s.building];
      return {
        id: s.id,
        kind: s.def.kind,
        x: s.x,
        z: s.z,
        nx: s.nx,
        nz: s.nz,
        cx: b.cx,
        cz: b.cz,
        depth: b.depth,
        width: b.width,
      };
    });

  it('keeps the eye in open air for every facing, at the door and in the middle', () => {
    const yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const shell of shells) {
      const blocks = occluders(shell);
      const confine = shopAir(shell);
      const spots = [
        { x: shell.x - shell.nx * 0.9, z: shell.z, feetY: 0.15, label: 'door' },
        { x: shell.cx, z: shell.cz, feetY: 0.15, label: 'middle' },
      ];
      for (const spot of spots) {
        for (const yaw of yaws) {
          const eye = resolveChaseEye({
            x: spot.x,
            z: spot.z,
            feetY: spot.feetY,
            yaw,
            pitch: 0.25,
            distance: 3.5,
            lookHeight: 1.05,
            blocks,
            confine,
          });
          expect(eye.clear, `${shell.kind} ${spot.label} yaw ${yaw.toFixed(2)}`).toBe(true);
          expect(buried(eye, blocks), `${shell.kind} ${spot.label}`).toBe(false);
          expect(eye.dist, `${shell.kind} ${spot.label}`).toBeGreaterThan(1.5);
          expect(eye.x).toBeGreaterThanOrEqual(confine.minX);
          expect(eye.x).toBeLessThanOrEqual(confine.maxX);
          expect(eye.z).toBeGreaterThanOrEqual(confine.minZ);
          expect(eye.z).toBeLessThanOrEqual(confine.maxZ);
          expect(eye.y).toBeLessThanOrEqual(confine.maxY);
        }
      }
    }
  });

  it('frames a table landing from far enough back to show the top', () => {
    const shell = shells.find((s) => s.kind === 'noodle')!;
    const layout = buildInterior(shell);
    const table = layout.props.find((p) => p.prop === 'table-square')!;
    const blocks = occluders(shell);
    const eye = resolveChaseEye({
      x: table.x,
      z: table.z,
      feetY: table.h,
      yaw: shell.nx > 0 ? Math.PI : 0,
      pitch: 0.2,
      distance: 3.5,
      lookHeight: 1.05,
      blocks,
      showSurface: true,
      confine: shopAir(shell),
    });
    expect(eye.clear).toBe(true);
    expect(buried(eye, blocks)).toBe(false);
    expect(eye.dist).toBeGreaterThanOrEqual(1.9);
    expect(eye.y).toBeGreaterThan(table.h + 0.85);
    expect(eye.lookY).toBeLessThan(table.h + 0.7);
  });
});
