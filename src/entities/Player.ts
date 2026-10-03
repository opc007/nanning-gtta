/**
 * On-foot avatar.
 *
 * Movement is camera-relative (the caller supplies a desired world direction);
 * the avatar accelerates toward it and yaws to face travel. Collision is
 * resolved by the caller against the shared building colliders.
 *
 * This version adds the vertical axis the base game never had: gravity, a
 * grounded test, and a real jump. The base was a strictly 2D sidewalk sim —
 * no hop, no air, no reason to leave the ground plane, which is exactly the
 * feeling that makes an open-world game read as a corridor.
 */

import { angleDelta, clamp } from '../core/math';

const WALK = 4.2;
const RUN = 8.4;
const TURN = 12; // rad/s the avatar rotates toward its travel direction

export const GRAVITY = 22; // m/s² — heavier than real, reads better at game scale
export const JUMP_V = 7.2; // ~1.2 m apex, enough to clear a kerb or a low wall
const AIR_CONTROL = 0.32; // fraction of ground steering authority retained airborne
const COYOTE = 0.12; // seconds of grace after leaving a ledge

export class Player {
  x = 0;
  z = 0;
  y = 0; // feet height above the street
  vy = 0; // vertical velocity
  heading = 0;
  speed = 0;
  grounded = true;
  /** Counts down after leaving ground without a jump — the coyote window. */
  private airTime = 0;
  /** Just landed this step, for a dust puff / camera dip. */
  justLanded = false;
  justJumped = false;

  // Previous-step pose for render interpolation.
  px = 0;
  pz = 0;
  py = 0;
  ph = 0;

  /** Snapshot the current pose as the previous one (call once per fixed step). */
  savePrev(): void {
    this.px = this.x;
    this.pz = this.z;
    this.py = this.y;
    this.ph = this.heading;
  }

  /** Launch a jump. Ignored in the air and during the coyote window. */
  jump(): boolean {
    if (this.grounded || this.airTime <= COYOTE) {
      this.vy = JUMP_V;
      this.grounded = false;
      this.airTime = COYOTE + 0.01;
      this.justJumped = true;
      return true;
    }
    return false;
  }

  /** dirX/dirZ: desired world-space move direction (need not be normalized). */
  update(dirX: number, dirZ: number, running: boolean, dt: number): void {
    this.justLanded = false;
    this.justJumped = false;

    const mag = Math.hypot(dirX, dirZ);
    const maxSpeed = running ? RUN : WALK;
    // Air control is deliberately weak: a jump should commit you to an arc.
    const authority = this.grounded ? 1 : AIR_CONTROL;

    if (mag > 1e-3) {
      const nx = dirX / mag;
      const nz = dirZ / mag;
      this.speed = maxSpeed * (this.grounded ? 1 : 0.82);
      this.x += nx * this.speed * dt * authority + (this.grounded ? 0 : 0);
      this.z += nz * this.speed * dt * authority;

      const target = Math.atan2(-nz, nx);
      // Turning is slower in the air, which is what makes a mid-air turn feel
      // like a decision rather than a free correction.
      const rate = TURN * (this.grounded ? 1 : 0.45);
      this.heading += clamp(angleDelta(this.heading, target), -rate * dt, rate * dt);
    } else {
      this.speed = 0;
    }

    // Vertical integration.
    if (!this.grounded || this.vy !== 0) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        if (!this.grounded) this.justLanded = true;
        this.grounded = true;
        this.airTime = 0;
      } else {
        this.grounded = false;
      }
    }
  }

  /** Height of the hips, for the camera and for shadow placement. */
  get eyeHeight(): number {
    return 1.62 + this.y;
  }
}
