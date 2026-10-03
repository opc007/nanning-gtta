import { angleDelta, clamp } from './math';

/** Pure camera-framing math for the chase cam. No `three`; unit-tested. */
export interface FollowParams {
  distance: number;
  height: number;
  lookHeight: number;
  stiffness: number; // higher = snappier
  speedPull?: number; // metres of distance pulled IN per m/s of speed (eye lag comp)
  slideSwing?: number; // 0..1: fraction of the lateral (powerslide) lag LEFT as on-screen swing — 0 pins the car centre, 1 lets it drift fully off
  maxSwing?: number; // hard cap (world metres) on that lateral swing — ~20% of screen at CAR_CAM
}

/**
 * The camera trails closer as speed rises so the eye's damping lag doesn't widen
 * the framing. Never closer than half the resting distance.
 */
export function followDistance(p: FollowParams, speed: number): number {
  return Math.max(p.distance * 0.5, p.distance - speed * (p.speedPull ?? 0));
}

/**
 * The look-at lead, split into forward (along heading) and lateral (perpendicular)
 * components — the caller passes the car's velocity already decomposed.
 *
 * A point damped at `stiffness` toward a target moving at velocity v settles v/stiffness
 * behind it. We **fully** lead the forward component (cancels the "car climbs toward the
 * top of the screen at speed" lag), but only **partially** lead the lateral component:
 * `slideSwing` of the lateral lag is left in (capped by `maxSwing`) so the car swings out a
 * little during a powerslide instead of being pinned dead-centre — a small, bounded drift
 * rather than the original full, excessive swing. With `slideSwing = 0` the car stays
 * centred; straight-line driving (no lateral velocity) is unaffected either way.
 */
export function lookLead(
  p: FollowParams,
  vForward: number,
  vLateral: number,
): { forward: number; lateral: number } {
  const k = p.stiffness;
  const fullLateral = vLateral / k; // the lateral lag if left entirely uncompensated
  const cap = p.maxSwing ?? Infinity;
  const swing = Math.max(-cap, Math.min(cap, fullLateral * (p.slideSwing ?? 0)));
  return { forward: vForward / k, lateral: fullLateral - swing };
}

/** Pitch is clamped in radians. Positive pitch looks down. */
export function clampPitch(pitch: number, min: number, max: number): number {
  return clamp(pitch, min, max);
}

/**
 * Distance from the look point to the eye after a wall hit.
 * `hitT` is the segment parameter of the first occluder, or -1 when the
 * path is clear. A hit stops `margin` metres short of the wall.
 *
 * A wall closer than `minDist` does **not** push the eye back out to
 * `minDist` — that shove put the lens inside the occluder and the frame
 * went black. The returned distance can be very small; the caller should
 * orbit instead of camping there.
 */
export function cameraPullDistance(
  segmentLength: number,
  hitT: number,
  margin = 0.2,
  minDist = 0.8,
): number {
  if (!(hitT >= 0) || segmentLength <= 0) return Math.max(0, segmentLength);
  const pulled = hitT * segmentLength - margin;
  if (pulled < minDist) return Math.max(0.05, pulled);
  return Math.min(pulled, segmentLength);
}

/**
 * Occlusion pulls in immediately. Clearing a wall eases the eye back out
 * at `outSpeed` metres per second so the camera doesn't breathe.
 */
export function approachCameraDistance(current: number, desired: number, dt: number, outSpeed = 3): number {
  if (desired <= current) return desired;
  return Math.min(desired, current + outSpeed * dt);
}

/** Axis-aligned occluder. Same shape as a height box, without the sim fields. */
export interface CamBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Eye must stay inside this volume (a shop's open air, already inset). */
export interface ChaseConfine {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface ChaseSphere {
  x: number;
  z: number;
  r: number;
}

export interface ChaseEyeQuery {
  x: number;
  z: number;
  feetY: number;
  /** Desired orbit yaw. The solved eye may sit at a different yaw. */
  yaw: number;
  pitch: number;
  distance: number;
  lookHeight: number;
  blocks: readonly CamBox[];
  /** Bias toward a downward view so the surface under the feet stays in frame. */
  showSurface?: boolean;
  confine?: ChaseConfine | null;
  spheres?: readonly ChaseSphere[];
  /** Last solved yaw, so two equally good orbits don't flicker. */
  preferYaw?: number;
}

export interface ChaseEye {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dist: number;
  lookY: number;
  /** Eye is in open air and can see the look point. */
  clear: boolean;
}

const YAW_STEPS = [0, 0.42, -0.42, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, Math.PI];
const EYE_PAD = 0.24;

function segmentHitBox(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  box: CamBox,
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

function eyePose(x: number, z: number, lookY: number, yaw: number, pitch: number, dist: number): { x: number; y: number; z: number } {
  const horiz = Math.cos(pitch) * dist;
  const fx = Math.cos(yaw);
  const fz = -Math.sin(yaw);
  return {
    x: x - fx * horiz,
    y: lookY + Math.sin(pitch) * dist,
    z: z - fz * horiz,
  };
}

function insideBox(x: number, y: number, z: number, b: CamBox, pad: number): boolean {
  return (
    x >= b.minX - pad && x <= b.maxX + pad &&
    y >= b.minY - pad && y <= b.maxY + pad &&
    z >= b.minZ - pad && z <= b.maxZ + pad
  );
}

function inConfine(x: number, y: number, z: number, c: ChaseConfine): boolean {
  return x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY && z >= c.minZ && z <= c.maxZ;
}

function sphereBlocks(x: number, z: number, spheres: readonly ChaseSphere[] | undefined): boolean {
  if (!spheres) return false;
  for (const s of spheres) {
    if (Math.hypot(x - s.x, z - s.z) < s.r * 0.55) return true;
  }
  return false;
}

function segmentHitsSphere(
  x0: number, z0: number, x1: number, z1: number,
  spheres: readonly ChaseSphere[] | undefined,
): boolean {
  if (!spheres) return false;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  for (const s of spheres) {
    const r = s.r * 0.55;
    if (len2 < 1e-6) {
      if (Math.hypot(x0 - s.x, z0 - s.z) < r) return true;
      continue;
    }
    const t = clamp(((s.x - x0) * dx + (s.z - z0) * dz) / len2, 0, 1);
    if (Math.hypot(x0 + dx * t - s.x, z0 + dz * t - s.z) < r) return true;
  }
  return false;
}

function eyeBlocked(
  ex: number, ey: number, ez: number,
  blocks: readonly CamBox[],
  spheres: readonly ChaseSphere[] | undefined,
  confine: ChaseConfine | null,
): boolean {
  if (confine && !inConfine(ex, ey, ez, confine)) return true;
  if (sphereBlocks(ex, ez, spheres)) return true;
  for (const b of blocks) {
    if (insideBox(ex, ey, ez, b, EYE_PAD)) return true;
  }
  return false;
}

function segmentBlocked(
  x: number, lookY: number, z: number,
  ex: number, ey: number, ez: number,
  blocks: readonly CamBox[],
  spheres: readonly ChaseSphere[] | undefined,
): boolean {
  if (segmentHitsSphere(x, z, ex, ez, spheres)) return true;
  for (const b of blocks) {
    const t = segmentHitBox(x, lookY, z, ex, ey, ez, {
      minX: b.minX - 0.05,
      maxX: b.maxX + 0.05,
      minY: b.minY - 0.05,
      maxY: b.maxY + 0.05,
      minZ: b.minZ - 0.05,
      maxZ: b.maxZ + 0.05,
    });
    // A hit on the body at the origin is the player, not a wall.
    if (t > 0.14 && t < 0.98) return true;
  }
  return false;
}

/**
 * Place a chase eye that is not inside a wall. Short clearance orbits and
 * raises the camera instead of pulling the lens through the occluder.
 * `showSurface` (or feet clearly above the floor) looks down far enough
 * that the surface under the player stays in frame.
 */
export function resolveChaseEye(q: ChaseEyeQuery): ChaseEye {
  const show = q.showSurface === true || q.feetY > 0.32;
  const lookH = show ? Math.min(q.lookHeight, 0.55) : q.lookHeight;
  const lookY = q.feetY + lookH;
  const pitches = show
    ? [0.5, 0.38, 0.64, 0.28]
    : [q.pitch, q.pitch + 0.2, 0.36, 0.55];
  const scales = [1, 0.84, 0.68, 0.52];
  const minGood = show ? 2.15 : 1.8;
  const confine = q.confine ?? null;

  let best: ChaseEye | null = null;
  let bestScore = Infinity;

  const consider = (yawOff: number, pitch: number, dist: number): void => {
    if (dist < 0.5) return;
    const p = clamp(pitch, -0.35, 1.05);
    const yaw = q.yaw + yawOff;
    const pose = eyePose(q.x, q.z, lookY, yaw, p, dist);
    if (eyeBlocked(pose.x, pose.y, pose.z, q.blocks, q.spheres, confine)) return;
    if (segmentBlocked(q.x, lookY, q.z, pose.x, pose.y, pose.z, q.blocks, q.spheres)) return;
    const yawPen = Math.abs(angleDelta(0, yawOff)) * 0.85;
    const distPen = dist < minGood ? (minGood - dist) * 6 : Math.abs(q.distance - dist) * 0.1;
    const pitchPen = Math.abs((show ? 0.48 : q.pitch) - p) * (show ? 0.7 : 0.3);
    const preferPen = q.preferYaw === undefined ? 0 : Math.abs(angleDelta(q.preferYaw, yaw)) * 0.25;
    const score = yawPen + distPen + pitchPen + preferPen;
    if (score < bestScore) {
      bestScore = score;
      best = { x: pose.x, y: pose.y, z: pose.z, yaw, pitch: p, dist, lookY, clear: true };
    }
  };

  for (const yawOff of YAW_STEPS) {
    for (const pitch of pitches) {
      for (const s of scales) consider(yawOff, pitch, q.distance * s);
    }
  }
  if (best) return best;

  if (confine) {
    const y = clamp(lookY + 1.25, confine.minY + 0.15, confine.maxY - 0.05);
    if (!eyeBlocked(q.x, y, q.z, q.blocks, q.spheres, confine)) {
      return { x: q.x, y, z: q.z, yaw: q.yaw, pitch: 1.05, dist: Math.max(0.5, y - lookY), lookY, clear: true };
    }
  }

  for (let dist = Math.min(q.distance, 2.4); dist >= 0.45; dist -= 0.2) {
    const p = clamp(show ? 0.5 : q.pitch, -0.2, 0.9);
    const pose = eyePose(q.x, q.z, lookY, q.yaw, p, dist);
    if (eyeBlocked(pose.x, pose.y, pose.z, q.blocks, q.spheres, confine)) continue;
    return { ...pose, yaw: q.yaw, pitch: p, dist, lookY, clear: true };
  }

  const pose = eyePose(q.x, q.z, lookY, q.yaw, 0.3, 0.7);
  return { ...pose, yaw: q.yaw, pitch: 0.3, dist: 0.7, lookY, clear: false };
}
