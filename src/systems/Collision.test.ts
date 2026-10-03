import { describe, it, expect } from 'vitest';
import {
  resolveCircleAabb,
  resolveCircle,
  circleOverlap,
  resolveCarImpulse,
  segmentBlocked,
  nearestIndex,
  groundHeightAt,
  resolveCapsule,
  segmentHitAabb3,
  ceilingAt,
  type Aabb,
  type Aabb3,
} from './Collision';

const box: Aabb = { minX: -5, minZ: -5, maxX: 5, maxZ: 5 };

describe('segmentBlocked (line of sight)', () => {
  const wall: Aabb[] = [{ minX: -2, minZ: -2, maxX: 2, maxZ: 2 }];
  it('is blocked when a box sits between the endpoints', () => {
    expect(segmentBlocked(-10, 0, 10, 0, wall)).toBe(true); // straight through the box
  });
  it('is clear when the box is off to the side', () => {
    expect(segmentBlocked(-10, 8, 10, 8, wall)).toBe(false); // passes well above (z=8)
  });
  it('is clear when both endpoints are on the same side', () => {
    expect(segmentBlocked(-10, 0, -5, 0, wall)).toBe(false); // segment ends before the box
  });
  it('is clear with no boxes', () => {
    expect(segmentBlocked(-10, 0, 10, 0, [])).toBe(false);
  });
});

describe('resolveCarImpulse', () => {
  it('equal masses reduce to the old per-car -(1+e)·vn/2 velocity change', () => {
    const vn = -10;
    const e = 0.4;
    const m = 1400;
    const imp = resolveCarImpulse(vn, m, m, e);
    expect(imp / m).toBeCloseTo((-(1 + e) * vn) / 2, 9); // per-car Δv
  });

  it('the heavier car changes velocity less than the lighter one', () => {
    const imp = resolveCarImpulse(-10, 4500, 1000, 0.4); // truck vs compact
    const dvTruck = imp / 4500;
    const dvCompact = imp / 1000;
    expect(dvCompact).toBeGreaterThan(dvTruck * 3); // light car flung far harder
  });
});

describe('resolveCircleAabb', () => {
  it('leaves a circle outside the box untouched', () => {
    const r = resolveCircleAabb(20, 0, 1, box);
    expect(r).toEqual({ x: 20, z: 0 });
  });

  it('pushes a circle out to the nearest face when overlapping an edge', () => {
    // Circle straddling the +X face: should be pushed clear along +X.
    const r = resolveCircleAabb(5.5, 0, 1, box);
    expect(r.x).toBeCloseTo(6); // maxX + radius
    expect(r.z).toBeCloseTo(0);
  });

  it('ejects a circle whose center is inside via least penetration', () => {
    // Slightly past center toward +X face -> ejected out the +X side.
    const r = resolveCircleAabb(3, 0, 1, box);
    expect(r.x).toBeCloseTo(6);
    expect(r.z).toBeCloseTo(0);
  });

  it('resolves a corner overlap diagonally', () => {
    const r = resolveCircleAabb(6, 6, 2, box);
    const dx = r.x - 5;
    const dz = r.z - 5;
    expect(Math.hypot(dx, dz)).toBeCloseTo(2, 5); // pushed to radius from corner
  });
});

describe('resolveCircle', () => {
  it('resolves against multiple boxes', () => {
    const boxes: Aabb[] = [
      { minX: -5, minZ: -5, maxX: 5, maxZ: 5 },
      { minX: 6, minZ: -5, maxX: 16, maxZ: 5 },
    ];
    const r = resolveCircle(5.5, 0, 1, boxes);
    // Wedged in the 1-unit gap between two boxes -> ends up clear of both.
    expect(r.x).toBeGreaterThanOrEqual(4);
    expect(r.x).toBeLessThanOrEqual(7);
  });
});

describe('circleOverlap', () => {
  it('returns null when circles do not touch', () => {
    expect(circleOverlap(0, 0, 10, 0, 4)).toBeNull();
  });

  it('reports a normalized axis and penetration depth', () => {
    const o = circleOverlap(0, 0, 3, 0, 4)!; // 3 apart, radii sum 4 -> depth 1
    expect(o).not.toBeNull();
    expect(o.nx).toBeCloseTo(-1); // points from B toward A (A is left of B)
    expect(o.nz).toBeCloseTo(0);
    expect(o.depth).toBeCloseTo(1);
  });

  it('stays stable on exact overlap', () => {
    const o = circleOverlap(5, 5, 5, 5, 2)!;
    expect(Math.hypot(o.nx, o.nz)).toBeCloseTo(1);
    expect(o.depth).toBeCloseTo(2);
  });
});

describe('nearestIndex', () => {
  const pts = [{ x: 10, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 3 }];
  it('finds the closest point within range', () => {
    expect(nearestIndex(0, 0, pts, 5)).toBe(1); // (2,0) is closest
  });
  it('returns -1 when nothing is in range', () => {
    expect(nearestIndex(0, 0, pts, 1)).toBe(-1);
  });
});

const solid = (minX: number, maxX: number, minZ: number, maxZ: number, minY: number, maxY: number): Aabb3 => ({
  minX, maxX, minZ, maxZ, minY, maxY, kind: 'solid',
});

describe('groundHeightAt', () => {
  const street: Aabb3[] = [
    { minX: -2, maxX: 2, minZ: -2, maxZ: 2, minY: 0, maxY: 0.15, kind: 'walkable' },
    { minX: 3, maxX: 4, minZ: -0.4, maxZ: 0.4, minY: 0, maxY: 0.75, kind: 'walkable' },
  ];

  it('returns 0 when nothing is under the feet', () => {
    expect(groundHeightAt(10, 10, 0.3, 0.3, street)).toBe(0);
  });

  it('picks the highest top at or below the step limit', () => {
    expect(groundHeightAt(0, 0, 0.25, 0.3, street)).toBeCloseTo(0.15);
    // A 0.75 table is not a step from street level.
    expect(groundHeightAt(3.5, 0, 0.25, 0.3, street)).toBe(0);
    expect(groundHeightAt(3.5, 0, 0.25, 0.75, street)).toBeCloseTo(0.75);
  });

  it('includes the 1.05 high-table boundary and excludes a 1.10 rail', () => {
    const boxes: Aabb3[] = [
      { minX: 0, maxX: 1, minZ: -0.5, maxZ: 0.5, minY: 0.9, maxY: 1.05, kind: 'walkable' },
      solid(2, 2.3, -1, 1, 0, 1.1),
    ];
    expect(groundHeightAt(0.5, 0, 0.25, 1.05, boxes)).toBeCloseTo(1.05);
    expect(groundHeightAt(2.1, 0, 0.25, 1.05, boxes)).toBe(0);
  });
});

describe('resolveCapsule', () => {
  const wall = [solid(1, 1.3, -1, 1, 0, 3)];
  const step = [{ minX: 1, maxX: 2, minZ: -1, maxZ: 1, minY: 0, maxY: 0.3, kind: 'walkable' as const }];

  it('pushes out of a wall taller than the step', () => {
    const r = resolveCapsule(0.9, 0, 0, 1.72, 0.35, 0.3, wall);
    expect(r.x).toBeLessThan(1 - 0.3);
  });

  it('ignores a surface the feet can step onto', () => {
    const r = resolveCapsule(1.1, 0, 0, 1.72, 0.35, 0.3, step);
    expect(r.x).toBeCloseTo(1.1);
    expect(r.z).toBeCloseTo(0);
  });

  it('does not treat a ceiling as a wall', () => {
    const ceil = [solid(-2, 2, -2, 2, 3.1, 3.4)];
    const r = resolveCapsule(0, 0, 0.15, 1.72, 0.35, 0.3, ceil);
    expect(r.x).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(0);
    expect(ceilingAt(0, 0, 2.2, 1.72, 0.35, ceil)).toBeCloseTo(3.1);
  });
});

describe('segmentHitAabb3', () => {
  const wall = solid(-0.2, 0.2, -1, 1, 0, 3);
  it('returns the entry t of a segment that crosses the box', () => {
    const t = segmentHitAabb3(-2, 1, 0, 2, 1, 0, wall);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    expect(-2 + (2 - -2) * t).toBeCloseTo(-0.2, 5);
  });
  it('returns -1 when the segment misses', () => {
    expect(segmentHitAabb3(-2, 1, 5, 2, 1, 5, wall)).toBe(-1);
  });
  it('returns 0 when the segment starts inside', () => {
    expect(segmentHitAabb3(0, 1, 0, 2, 1, 0, wall)).toBe(0);
  });
});
