/**
 * Pure per-frame step for street talkers.
 *
 * A talker who is walking off (`leaving`) used to `return` out of the crowd
 * loop, so every NPC after them froze. This step always moves on to the next
 * agent — leaving is a `continue`, not a `return`.
 */

export interface CrowdMover {
  /** Seconds left on the current speech bubble. */
  t: number;
  leaving: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** How many frames this agent was free to idle. Tests read this. */
  idleSteps: number;
}

export function stepCrowd(agents: CrowdMover[], dt: number): void {
  for (const a of agents) {
    if (a.t > 0) {
      a.t -= dt;
      continue;
    }
    if (a.leaving) {
      a.x += a.vx * dt;
      a.z += a.vz * dt;
      continue;
    }
    a.idleSteps++;
  }
}
