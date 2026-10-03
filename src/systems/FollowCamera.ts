import * as THREE from 'three';
import { damp } from '../core/math';
import { followDistance, lookLead, type FollowParams } from '../core/followCam';
import type { SpatialGrid } from './SpatialGrid';

export type { FollowParams };

export const CAR_CAM: FollowParams = { distance: 9, height: 4.2, lookHeight: 1.4, stiffness: 4, speedPull: 0.16, slideSwing: 0.3, maxSwing: 2 };
// Nanning's whole subject is the street: the arcade overhead, the lantern
// garlands, the shopfronts. A 5 m chase cam frames the player's shoulders and
// none of that, so on foot the camera sits back far enough to read the block.
export const FOOT_CAM: FollowParams = { distance: 12.5, height: 8.2, lookHeight: 1.8, stiffness: 7 };

/**
 * Smoothed chase camera. The desired pose sits behind the target along its
 * heading; both the eye and the look-at point are exponentially damped so the
 * camera glides instead of snapping. Damping is frame-rate independent.
 */
export class FollowCamera {
  private readonly look = new THREE.Vector3();
  /** Current pull-in factor, 1 = fully clear of occluders. */
  private clear = 1;
  /** Extra world positions that block the camera (tree canopies, awnings). */
  private softBlockers: { x: number; z: number; r: number }[] = [];

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
  update(x: number, z: number, heading: number, p: FollowParams, dt: number, vx = 0, vz = 0): void {
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
    this.camera.position.y = damp(this.camera.position.y, p.height * (0.45 + 0.55 * k), p.stiffness, dt);
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
    this.look.y = damp(this.look.y, p.lookHeight, p.stiffness, dt);
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

  /** Yaw the camera is currently looking along — used for camera-relative walking. */
  get yaw(): number {
    const dx = this.look.x - this.camera.position.x;
    const dz = this.look.z - this.camera.position.z;
    return Math.atan2(-dz, dx);
  }
}
