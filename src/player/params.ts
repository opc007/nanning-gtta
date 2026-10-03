/**
 * On-foot movement numbers. Speeds are m/s, accelerations m/s².
 * Jump takeoff is the analytic √(2 g h); the integrator is trapezoidal so a
 * fixed 60 Hz step actually reaches `jumpHeight` (semi-implicit Euler tops
 * out ~5 cm short, which would miss a 1.05 m high table).
 */

export const PLAYER = {
  walkSpeed: 1.6,
  jogSpeed: 4.2,
  sprintSpeed: 7.5,
  crouchSpeed: 1.2,
  accelGround: 14,
  decelGround: 18,
  airControl: 0.35,
  turnRate: 12,
  gravity: 22,
  jumpHeight: 0.75,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  stepHeight: 0.3,
  maxFallNoDamage: 3,
  radius: 0.35,
  heightStand: 1.72,
  heightCrouch: 1.15,
  staminaMax: 100,
  sprintDrain: 18,
  jumpCost: 8,
  staminaRegen: 14,
  regenDelay: 0.8,
  exhaustRecover: 25,
  carry1HSpeedMul: 0.8,
  carry2HSpeedMul: 0.55,
  overfullSpeedMul: 0.8,
  punchRange: 1.1,
  punchCooldown: 0.45,
  landStun: 0.12,
  landStunLong: 0.3,
  /** Metres of fall that stretch the landing pose. */
  landStunFall: 1.5,
  stepSnapSpeed: 10,
  /** Satiety above this counts as 吃撑. */
  overfullSatiety: 100,
} as const;

export const jumpTakeoffSpeed = (): number =>
  Math.sqrt(2 * PLAYER.gravity * PLAYER.jumpHeight);
