/**
 * Minimal collision: the world is a set of axis-aligned building footprints
 * and every moving actor is a circle on the ground plane. Resolving a circle
 * against AABBs by minimum-translation push-out is cheap, allocation-free in
 * the hot path, and pure — so it is unit-tested without a renderer.
 */
export interface Aabb {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** Push a circle out of a single AABB if it overlaps. Returns corrected center. */
export function resolveCircleAabb(
  cx: number,
  cz: number,
  radius: number,
  box: Aabb,
): Vec2 {
  const closestX = Math.max(box.minX, Math.min(cx, box.maxX));
  const closestZ = Math.max(box.minZ, Math.min(cz, box.maxZ));
  const dx = cx - closestX;
  const dz = cz - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq > radius * radius) return { x: cx, z: cz };

  if (distSq > 1e-9) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    return { x: cx + (dx / dist) * push, z: cz + (dz / dist) * push };
  }

  // Center is inside the box: eject along the axis of least penetration.
  const toLeft = cx - box.minX;
  const toRight = box.maxX - cx;
  const toTop = cz - box.minZ;
  const toBottom = box.maxZ - cz;
  const minPen = Math.min(toLeft, toRight, toTop, toBottom);
  if (minPen === toLeft) return { x: box.minX - radius, z: cz };
  if (minPen === toRight) return { x: box.maxX + radius, z: cz };
  if (minPen === toTop) return { x: cx, z: box.minZ - radius };
  return { x: cx, z: box.maxZ + radius };
}

export function resolveCircle(
  cx: number,
  cz: number,
  radius: number,
  boxes: readonly Aabb[],
): Vec2 {
  let x = cx;
  let z = cz;
  for (const box of boxes) {
    const r = resolveCircleAabb(x, z, radius, box);
    x = r.x;
    z = r.z;
  }
  return { x, z };
}

/** Unit push-out separating two overlapping circles, or null if they don't touch. */
export function circleOverlap(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  rSum: number,
): { nx: number; nz: number; depth: number } | null {
  const dx = ax - bx;
  const dz = az - bz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= rSum * rSum) return null;
  // Degenerate exact overlap: pick an arbitrary but stable axis.
  if (distSq < 1e-9) return { nx: 1, nz: 0, depth: rSum };
  const dist = Math.sqrt(distSq);
  return { nx: dx / dist, nz: dz / dist, depth: rSum - dist };
}

/**
 * Impulse magnitude for a 1-D elastic-ish collision along the contact normal.
 * `vn` is the relative normal velocity (negative = approaching); `e` is
 * restitution. `j/ma` and `-j/mb` are the per-car normal-velocity changes.
 * Equal masses reduce to the old `-(1+e)·vn/2` per car. Pure.
 */
export function resolveCarImpulse(vn: number, ma: number, mb: number, e: number): number {
  return (-(1 + e) * vn) / (1 / ma + 1 / mb);
}

/** Does segment A→B cross this AABB? (2D slab test, segment param t∈[0,1].) */
function segHitsAabb(ax: number, az: number, bx: number, bz: number, box: Aabb): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (ax < box.minX || ax > box.maxX) return false;
  } else {
    let t1 = (box.minX - ax) / dx;
    let t2 = (box.maxX - ax) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (az < box.minZ || az > box.maxZ) return false;
  } else {
    let t1 = (box.minZ - az) / dz;
    let t2 = (box.maxZ - az) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** True if the line of sight A→B is blocked by any of the boxes (buildings). */
export function segmentBlocked(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  boxes: readonly Aabb[],
): boolean {
  for (const box of boxes) if (segHitsAabb(ax, az, bx, bz, box)) return true;
  return false;
}

/**
 * A footprint with a vertical extent. `walkable` surfaces (arcade lip, tabletops)
 * support the player but do not shove them sideways when the top is within
 * step height. `solid` is a wall. `prop` is furniture the interior streamer
 * adds and removes.
 */
export interface Aabb3 extends Aabb {
  minY: number;
  maxY: number;
  kind: 'solid' | 'walkable' | 'prop';
  /** Camera pull-in tests this box. Walls and columns do; floors do not. */
  camBlock?: boolean;
  id?: number;
}

/** True when a circle of radius `r` overlaps the box's XZ footprint. */
export function footprintOverlaps(x: number, z: number, r: number, box: Aabb): boolean {
  const cx = Math.max(box.minX, Math.min(x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz <= r * r;
}

/**
 * Highest surface at or below `maxStepTop` under the footprint, or 0 when the
 * street itself is the floor. A 1 mm slop keeps the jumpHeight+stepHeight
 * boundary (a 1.05 m high table) from failing on discrete timesteps.
 */
export function groundHeightAt(
  x: number,
  z: number,
  r: number,
  maxStepTop: number,
  boxes: readonly Aabb3[],
  count = boxes.length,
): number {
  let best = 0;
  const limit = maxStepTop + 0.002;
  for (let i = 0; i < count; i++) {
    const box = boxes[i];
    if (box.maxY > limit) continue;
    if (!footprintOverlaps(x, z, r, box)) continue;
    if (box.maxY > best) best = box.maxY;
  }
  return best;
}

/**
 * Lowest underside above the shoulders that overlaps the footprint, or +Inf
 * when the head is clear. Used to kill upward velocity on a lintel.
 */
export function ceilingAt(
  x: number,
  z: number,
  feetY: number,
  height: number,
  r: number,
  boxes: readonly Aabb3[],
  count = boxes.length,
): number {
  let best = Infinity;
  const head = feetY + height;
  for (let i = 0; i < count; i++) {
    const box = boxes[i];
    if (box.kind === 'walkable') continue;
    if (box.minY < feetY + height * 0.45) continue;
    // Entirely above the head: not touching yet. A thin slab the head has
    // entered still counts — its top can sit below the crown.
    if (box.minY >= head) continue;
    if (!footprintOverlaps(x, z, r * 0.6, box)) continue;
    if (box.minY < best) best = box.minY;
  }
  return best;
}

/**
 * Horizontal push-out for a vertical capsule. Boxes whose top is within
 * `stepHeight` of the feet are steps, not walls. Boxes entirely above the
 * head (ceilings) are ignored here; `ceilingAt` handles them.
 */
export function resolveCapsule(
  x: number,
  z: number,
  y: number,
  h: number,
  r: number,
  stepHeight: number,
  boxes: readonly Aabb3[],
  count = boxes.length,
): Vec2 {
  let cx = x;
  let cz = z;
  const head = y + h;
  const stepTop = y + stepHeight + 0.002;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < count; i++) {
      const box = boxes[i];
      if (box.maxY <= stepTop) continue;
      if (box.minY >= head - 0.02) continue;
      const pushed = resolveCircleAabb(cx, cz, r, box);
      cx = pushed.x;
      cz = pushed.z;
    }
  }
  return { x: cx, z: cz };
}

/**
 * Ray-slab against a 3D box. Returns the nearest t in [0,1], or -1 on a miss.
 * A segment that starts inside the box reports 0.
 */
export function segmentHitAabb3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  box: Aabb3,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  const slab = (p: number, d: number, min: number, max: number): boolean => {
    if (Math.abs(d) < 1e-9) return p >= min && p <= max;
    let t1 = (min - p) / d;
    let t2 = (max - p) / d;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };
  if (!slab(ax, dx, box.minX, box.maxX)) return -1;
  if (!slab(ay, dy, box.minY, box.maxY)) return -1;
  if (!slab(az, dz, box.minZ, box.maxZ)) return -1;
  return tmin;
}

/** Index of the nearest point within `maxDist`, or -1. */
export function nearestIndex(
  x: number,
  z: number,
  points: ReadonlyArray<Vec2>,
  maxDist: number,
): number {
  let best = -1;
  let bestSq = maxDist * maxDist;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - x;
    const dz = points[i].z - z;
    const d = dx * dx + dz * dz;
    if (d <= bestSq) {
      bestSq = d;
      best = i;
    }
  }
  return best;
}
