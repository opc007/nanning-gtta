import { describe, it, expect } from 'vitest';
import { obbOverlap, type Car } from './Vehicles';

/**
 * Car-vs-car contact normal, tested where the bug lived.
 *
 * `obbOverlap` returned u·sign(dist) — a normal pointing from a toward b —
 * while `collide()` consumes it as b→a (the `circleOverlap` convention):
 * `a += n·depth`, `b -= n·depth`, and `vn = (va−vb)·n < 0` for "approaching".
 * The "separation" therefore shoved overlapping cars INTO each other (a 1.5 m
 * lateral overlap closed to 1.16 m instead of opening to 1.84 m), and the
 * impulse yanked separating pairs back together while ignoring real approaches.
 * Cars ground through each other at intersections — and wherever the squeeze
 * pointed, through a shopfront.
 */
const at = (x: number, z: number, heading = 0): Car => ({ x, z, heading }) as Car;

describe('obbOverlap — contact normal convention', () => {
  it('points from b toward a on the lateral axis', () => {
    const a = at(0, 0);
    const b = at(0, 1.5); // half-wid sum 1.84 → 0.34 m overlap
    const o = obbOverlap(a, b)!;
    expect(o).not.toBeNull();
    // b→a means (a − b)·n > 0
    expect(o.nx * (a.x - b.x) + o.nz * (a.z - b.z)).toBeGreaterThan(0);
  });

  it('points from b toward a head-on and diagonally', () => {
    // Pairs whose contact axis has a non-zero centre distance (a pair aligned
    // on the min axis has dist 0 and either direction separates — that case is
    // pinned by the gap-opening test below).
    for (const b of [at(1.2, 1.0), at(-1.2, 0.9), at(0.2, 1.4)]) {
      const a = at(0, 0);
      const o = obbOverlap(a, b)!;
      expect(o).not.toBeNull();
      expect(o.nx * (a.x - b.x) + o.nz * (a.z - b.z)).toBeGreaterThan(0);
    }
  });

  it('collide()-style separation opens the gap instead of closing it', () => {
    const a = at(0, 0);
    const b = at(0, 1.5);
    const o = obbOverlap(a, b)!;
    // The exact push collide() applies (mass-weighted; equal masses here).
    const ax = a.x + o.nx * o.depth * 0.5;
    const az = a.z + o.nz * o.depth * 0.5;
    const bx = b.x - o.nx * o.depth * 0.5;
    const bz = b.z - o.nz * o.depth * 0.5;
    // Lateral gap must reach the contact distance (2 × half-width = 1.84),
    // never fall below the 1.5 m it started at.
    expect(bz - az).toBeGreaterThan(1.5);
    expect(bz - az).toBeCloseTo(1.84, 6);
    expect(bx - ax).toBeCloseTo(0, 6);
  });

  it('impulse sign convention: approaching is negative vn, separating positive', () => {
    const a = at(0, 0);
    const b = at(0, 1.5);
    const o = obbOverlap(a, b)!;
    // a driving +Z into b, b reversing −Z into a.
    const vnApproach = (0 - 0) * o.nx + (1 - -1) * o.nz;
    expect(vnApproach).toBeLessThan(0);
    // Both reversing away from each other.
    const vnSeparate = (0 - 0) * o.nx + (-1 - 1) * o.nz;
    expect(vnSeparate).toBeGreaterThan(0);
  });

  it('returns null for cars that are clear', () => {
    expect(obbOverlap(at(0, 0), at(0, 3))).toBeNull(); // side by side, 3 m apart
    expect(obbOverlap(at(0, 0), at(6, 0))).toBeNull(); // nose to nose, 6 m apart
  });
});
