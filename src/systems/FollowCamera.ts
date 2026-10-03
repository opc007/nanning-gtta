import * as THREE from 'three';
import { damp, angleDelta, clamp } from '../core/math';
import {
  clampPitch,
  followDistance,
  lookLead,
  resolveChaseEye,
  type ChaseConfine,
  type FollowParams,
} from '../core/followCam';
import type { Aabb3 } from './Collision';
import type { SpatialGrid } from './SpatialGrid';

/** On-foot chase. Closer than the old 8.6 m framing so the street and the coat both read. */
export const STREET_CAM: FollowParams = { distance: 5.5, height: 2.3, lookHeight: 1.5, stiffness: 8 };
/**
 * Inside a shop. Long enough that the coat doesn't fill the frame, and
 * aimed low enough to read tables. The solver orbits when this rest pose
 * would sit in a wall.
 */
export const INTERIOR_CAM: FollowParams = { distance: 3.5, height: 2.05, lookHeight: 1.05, stiffness: 10 };

const PITCH_STREET = { min: (-30 * Math.PI) / 180, max: (55 * Math.PI) / 180 };
const PITCH_INTERIOR = { min: (-20 * Math.PI) / 180, max: (60 * Math.PI) / 180 };

export type { ChaseConfine, FollowParams };

export const CAR_CAM: FollowParams = { distance: 9, height: 4.2, lookHeight: 1.4, stiffness: 4, speedPull: 0.16, slideSwing: 0.3, maxSwing: 2 };
// Nanning's whole subject is the street: the arcade overhead, the lantern
// garlands, the shopfronts. A 5 m chase cam frames the player's shoulders and
// none of that, so on foot the camera sits back far enough to read the block.
export const FOOT_CAM: FollowParams = { distance: 7.2, height: 3.5, lookHeight: 1.9, stiffness: 7 };

/**
 * Smoothed chase camera. The desired pose sits behind the target along its
 * heading; both the eye and the look-at point are exponentially damped so the
 * camera glides instead of snapping. Damping is frame-rate independent.
 */
export class FollowCamera {
  private readonly look = new THREE.Vector3();
  /** Current pull-in factor, 1 = fully clear of occluders. */
  private clear = 1;
  private snapped = false;
  /** Extra world positions that block the camera (tree canopies, awnings). */
  private softBlockers: { x: number; z: number; r: number }[] = [];
  /** Orbit for the on-foot camera. Yaw 0 looks along +X. Positive pitch looks down. */
  orbitYaw = 0;
  orbitPitch = 0.15;
  private lookIdle = 0;
  /** Distance from the look point to the eye after occlusion. Read by the rig. */
  eyeDistance = STREET_CAM.distance;
  /** True when the solved eye is inside a wall. The frame would be black. */
  eyeBlocked = false;
  private solvedYaw = 0;
  /** True while the pointer is locked. Auto-return waits until it isn't. */
  pointerLocked = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /**
   * Nanning's street is dense with things the base game never had: 榕树 canopies
   * that swallow the camera whole, and awnings at head height. Without occlusion
   * the camera ends up inside a tree and the screen goes solid green. The base
   * camera has no such handling, so we add a soft pull-in.
   */
  setSoftBlockers(list: { x: number; z: number; r: number }[]): void {
    this.softBlockers = list;
  }

  /**
   * Heading convention matches the sim: forward = (cos h, 0, -sin h). The eye trails
   * behind the *heading*; the look-at leads along the *velocity vector* `(vx, vz)` so the
   * car stays centred even when travel diverges from heading (powerslides).
   */
  update(x: number, z: number, heading: number, p: FollowParams, dt: number, vx = 0, vz = 0, y = 0): void {
    // Snap on the first frame. Damping in from an arbitrary initial pose takes
    // tens of seconds to converge, and during that time the player is looking at
    // whatever the sky is doing.
    if (!this.snapped) {
      this.snapped = true;
      this.clear = 1;
      this.camera.position.set(x - Math.cos(heading) * p.distance, p.height + y, z + Math.sin(heading) * p.distance);
      this.look.set(x, p.lookHeight + y, z);
      this.camera.lookAt(this.look);
      return;
    }
    const fx = Math.cos(heading);
    const fz = -Math.sin(heading);
    const speed = Math.hypot(vx, vz);

    // Pull the camera in as speed rises so damping lag doesn't widen the framing.
    const dist = followDistance(p, speed);
    const desiredX = x - fx * dist;
    const desiredZ = z - fz * dist;

    // Occlusion pull-in: sample the segment from the head to the desired eye and
    // shorten it to the last free point. Sampled at a few heights so the camera
    // can still rise over a low awning instead of jamming against it.
    const want = this.clearFor(x, z, desiredX, desiredZ, p);
    this.clear = damp(this.clear, want, 9, dt);
    const k = this.clear;

    this.camera.position.x = damp(this.camera.position.x, x + (desiredX - x) * k, p.stiffness, dt);
    this.camera.position.y = damp(this.camera.position.y, p.height * (0.45 + 0.55 * k) + y, p.stiffness, dt);
    this.camera.position.z = damp(this.camera.position.z, z + (desiredZ - z) * k, p.stiffness, dt);

    // Decompose velocity into forward (along heading) + lateral (perpendicular). Lead the
    // forward part fully (no climb-at-speed), the lateral part only partially — so the car
    // keeps a small, bounded swing during a powerslide instead of snapping to dead-centre.
    const rx = Math.sin(heading);
    const rz = Math.cos(heading);
    const vForward = vx * fx + vz * fz;
    const vLateral = vx * rx + vz * rz;
    const lead = lookLead(p, vForward, vLateral);
    const leadX = fx * lead.forward + rx * lead.lateral;
    const leadZ = fz * lead.forward + rz * lead.lateral;
    this.look.x = damp(this.look.x, x + leadX, p.stiffness, dt);
    this.look.y = damp(this.look.y, p.lookHeight + y, p.stiffness, dt);
    this.look.z = damp(this.look.z, z + leadZ, p.stiffness, dt);
    this.camera.lookAt(this.look);
  }

  /**
   * 1 = the full chase pose is clear, <1 = something is in the way and the eye
   * has to come in. Uses the world's spatial grid for building AABBs (with a
   * generous vertical fudge) and a cheap radius test for soft blockers.
   */
  private clearFor(tx: number, tz: number, ex: number, ez: number, p: FollowParams): number {
    let k = 1;
    const dx = ex - tx;
    const dz = ez - tz;
    const STEPS = 6;
    for (let i = STEPS; i >= 1; i--) {
      const t = i / STEPS;
      const px = tx + dx * t;
      const pz = tz + dz * t;
      if (this.blocked(px, pz, p)) {
        k = Math.max(0.3, (i - 1) / STEPS);
        break;
      }
    }
    for (const b of this.softBlockers) {
      // Project the blocker onto the chase segment.
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-4) continue;
      const t = Math.max(0, Math.min(1, ((b.x - tx) * dx + (b.z - tz) * dz) / len2));
      const px = tx + dx * t;
      const pz = tz + dz * t;
      if (Math.hypot(px - b.x, pz - b.z) < b.r) {
        k = Math.min(k, Math.max(0.32, t * 0.9));
      }
    }
    return k;
  }

  /** True if this point sits inside (or hard against) a building footprint. */
  private blocked(px: number, pz: number, _p: FollowParams): boolean {
    if (!this.grid) return false;
    // `resolve` is a push-out; if it actually moved the point, the point was
    // inside a collider. Cheap enough at 6 samples a frame.
    const r = this.grid.resolve(px, pz, 0.45);
    return Math.hypot(r.x - px, r.z - pz) > 0.02;
  }

  /** Wired up by main.ts once the city (and its spatial grid) exists. */
  setGrid(grid: SpatialGrid): void {
    this.grid = grid;
  }
  private grid: SpatialGrid | null = null;

  /** Yaw the lens is actually looking along. The HUD arrow uses this. */
  get yaw(): number {
    const dx = this.look.x - this.camera.position.x;
    const dz = this.look.z - this.camera.position.z;
    return Math.atan2(-dz, dx);
  }

  /**
   * Yaw on-foot movement uses. Wall avoidance may swing the lens; walking
   * stays on the orbit the player chose, which sits behind the body unless
   * they are looking around.
   */
  get moveYaw(): number {
    return this.orbitYaw;
  }

  /**
   * Drop the orbit behind the avatar and place the camera there immediately,
   * so camera-relative walking matches the heading on the same frame.
   */
  snapBehind(heading: number, x: number, z: number, feetY = 0, preset: FollowParams = STREET_CAM): void {
    this.orbitYaw = heading;
    this.orbitPitch = Math.atan2(preset.height - preset.lookHeight, preset.distance);
    this.solvedYaw = heading;
    this.eyeDistance = preset.distance;
    this.eyeBlocked = false;
    this.lookIdle = 0;
    this.snapped = true;
    const pitch = this.orbitPitch;
    const horiz = Math.cos(pitch) * preset.distance;
    const fx = Math.cos(heading);
    const fz = -Math.sin(heading);
    const lookY = feetY + preset.lookHeight;
    this.look.set(x, lookY, z);
    this.camera.position.set(x - fx * horiz, lookY + Math.sin(pitch) * preset.distance, z - fz * horiz);
    this.camera.lookAt(this.look);
  }

  /**
   * On-foot orbit. `lookDX/lookDY` are radians this frame (mouse, touch, stick).
   * Walls pull the eye in immediately; it eases back out at 3 m/s.
   * `blocks` are the height boxes (and furniture) the segment can hit.
   */
  updateOnFoot(
    x: number,
    feetY: number,
    z: number,
    heading: number,
    preset: FollowParams,
    dt: number,
    lookDX: number,
    lookDY: number,
    blocks: readonly Aabb3[],
    blockCount: number,
    confine: ChaseConfine | null = null,
  ): void {
    const looking = Math.abs(lookDX) + Math.abs(lookDY) > 1e-5;
    if (looking) this.lookIdle = 0;
    else this.lookIdle += dt;

    this.orbitYaw -= lookDX;
    const limits = preset.distance < 4 ? PITCH_INTERIOR : PITCH_STREET;
    this.orbitPitch = clampPitch(this.orbitPitch + lookDY, limits.min, limits.max);

    // Hands off the mouse, pointer free: drift back behind the body.
    if (!this.pointerLocked && !looking && this.lookIdle > 1.5) {
      const dy = angleDelta(this.orbitYaw, heading);
      const step = Math.min(Math.abs(dy), 2 * dt);
      this.orbitYaw += Math.sign(dy) * step;
      const rest = Math.atan2(preset.height - preset.lookHeight, preset.distance);
      this.orbitPitch += clamp(rest - this.orbitPitch, -dt, dt);
    }

    const boxes: Aabb3[] = [];
    for (let i = 0; i < blockCount; i++) {
      const box = blocks[i];
      if (box.camBlock) boxes.push(box);
    }
    const solved = resolveChaseEye({
      x,
      z,
      feetY,
      yaw: this.orbitYaw,
      pitch: this.orbitPitch,
      distance: preset.distance,
      lookHeight: preset.lookHeight,
      blocks: boxes,
      showSurface: feetY > 0.32,
      confine,
      spheres: this.softBlockers,
      preferYaw: this.solvedYaw,
    });
    this.solvedYaw = solved.yaw;
    this.eyeDistance = solved.dist;
    this.eyeBlocked = !solved.clear;
    // Snap. Easing the eye toward a blocked pose is what put it inside the wall.
    this.camera.position.set(solved.x, solved.y, solved.z);
    this.look.set(x, solved.lookY, z);
    this.camera.lookAt(this.look);

    const fov = preset.distance < 4 ? 66 : 60;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, fov, 6, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
