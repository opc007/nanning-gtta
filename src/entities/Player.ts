import { createPlayerSim, type PlayerSim, type PlayerState } from '../player/PlayerController';

/**
 * On-foot avatar. The numbers live in a pure `PlayerSim`; this class is the
 * handle `main` and the e2e harness already poke (`player.x`, `player.heading`).
 * Collision and integration happen in `stepPlayer`, which the caller runs.
 */
export class Player {
  readonly sim: PlayerSim;
  px = 0;
  py = 0;
  pz = 0;
  ph = 0;

  constructor(x = 0, z = 0) {
    this.sim = createPlayerSim(x, z, 0);
  }

  get x(): number {
    return this.sim.x;
  }
  set x(v: number) {
    this.sim.x = v;
  }
  get y(): number {
    return this.sim.y;
  }
  set y(v: number) {
    this.sim.y = v;
  }
  get z(): number {
    return this.sim.z;
  }
  set z(v: number) {
    this.sim.z = v;
  }
  get heading(): number {
    return this.sim.heading;
  }
  set heading(v: number) {
    this.sim.heading = v;
  }
  get speed(): number {
    return Math.hypot(this.sim.vx, this.sim.vz);
  }
  get vx(): number {
    return this.sim.vx;
  }
  get vz(): number {
    return this.sim.vz;
  }
  get vy(): number {
    return this.sim.vy;
  }
  get grounded(): boolean {
    return this.sim.grounded;
  }
  get stamina(): number {
    return this.sim.stamina;
  }
  get state(): PlayerState {
    return this.sim.state;
  }
  get stance(): 'stand' | 'crouch' {
    return this.sim.stance;
  }

  /** Snapshot the current pose as the previous one (call once per fixed step). */
  savePrev(): void {
    this.px = this.sim.x;
    this.py = this.sim.y;
    this.pz = this.sim.z;
    this.ph = this.sim.heading;
  }

  /** Zero velocity and plant the feet. Used by respawn, e2e, and screenshots. */
  teleport(x: number, z: number, heading?: number): void {
    this.sim.x = x;
    this.sim.z = z;
    this.sim.y = 0;
    this.sim.vx = 0;
    this.sim.vy = 0;
    this.sim.vz = 0;
    this.sim.grounded = true;
    this.sim.groundY = 0;
    this.sim.fallFrom = 0;
    this.sim.landTimer = 0;
    this.sim.coyote = 0.1;
    if (heading !== undefined) this.sim.heading = heading;
    this.savePrev();
  }
}
