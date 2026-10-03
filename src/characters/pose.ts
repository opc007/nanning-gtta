/**
 * Procedural pose. Pure math: a locomotion state plus a phase (advanced by
 * distance walked, not by time) becomes local joint rotations. The rig in
 * `buildCharacter` applies whatever joints it actually has.
 *
 * Joint axes match the mesh: +Z rotation pitches a limb toward +X (forward).
 */

export type AnimState =
  | 'idle'
  | 'walk'
  | 'jog'
  | 'sprint'
  | 'crouch'
  | 'crouchWalk'
  | 'jump'
  | 'fall'
  | 'land'
  | 'sit'
  | 'eat'
  | 'carry';

export type JointName =
  | 'hips'
  | 'torso'
  | 'head'
  | 'upperArmL'
  | 'lowerArmL'
  | 'upperArmR'
  | 'lowerArmR'
  | 'upperLegL'
  | 'lowerLegL'
  | 'upperLegR'
  | 'lowerLegR'
  | 'footL'
  | 'footR'
  | 'coatTailL'
  | 'coatTailR'
  | 'coatTailB';

export interface JointPose {
  rx: number;
  ry: number;
  rz: number;
  /** Added to the bind-pose local Y, metres. */
  dy: number;
}

export type Pose = Record<JointName, JointPose>;

export interface PoseInput {
  state: AnimState;
  /** Seconds in the current state. Drives jumps, landings, idle breath. */
  stateTime: number;
  /** Gait phase in cycles. 1 = one full stride. */
  phase: number;
  speed: number;
  vy: number;
  /** Extra forward lean, radians. */
  lean: number;
}

export const STRIDE_M: Partial<Record<AnimState, number>> = {
  walk: 0.62,
  crouchWalk: 0.42,
  jog: 1.05,
  sprint: 1.6,
};

const JOINTS: JointName[] = [
  'hips', 'torso', 'head',
  'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR',
  'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR',
  'footL', 'footR',
  'coatTailL', 'coatTailR', 'coatTailB',
];

/** Limits applied after the pose is solved, radians / metres. */
const LIMIT = 1.6;

export function createPose(): Pose {
  const pose = {} as Pose;
  for (const id of JOINTS) pose[id] = { rx: 0, ry: 0, rz: 0, dy: 0 };
  return pose;
}

export function advancePhase(phase: number, distance: number, state: AnimState, strideScale = 1): number {
  const stride = (STRIDE_M[state] ?? 0.62) * strideScale;
  if (stride <= 1e-4) return phase;
  return phase + distance / stride;
}

function clampJoint(j: JointPose): void {
  j.rx = clamp(j.rx, -LIMIT, LIMIT);
  j.ry = clamp(j.ry, -LIMIT, LIMIT);
  j.rz = clamp(j.rz, -LIMIT, LIMIT);
  j.dy = clamp(j.dy, -0.6, 0.4);
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/**
 * Two-bone IK in the plane of the chain. `target` is the distance from the
 * root to the end effector. Returns the bend at the root (`a`, from the
 * straight line to the target) and the flexion at the mid joint (`b`).
 */
export function solveTwoBone(lenA: number, lenB: number, target: number): { a: number; b: number } {
  const reach = lenA + lenB;
  const fold = Math.abs(lenA - lenB);
  if (target >= reach - 1e-4) return { a: 0, b: 0 };
  if (target <= fold + 1e-4) return { a: 0, b: Math.PI };
  const max = reach - 1e-4;
  const min = fold + 1e-4;
  const d = clamp(target, min, max);
  const cosB = clamp((lenA * lenA + lenB * lenB - d * d) / (2 * lenA * lenB), -1, 1);
  const b = Math.PI - Math.acos(cosB);
  const cosA = clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1);
  const a = Math.acos(cosA);
  return { a, b };
}

export function computePose(inp: PoseInput, out: Pose): void {
  for (const id of JOINTS) {
    const j = out[id];
    j.rx = 0;
    j.ry = 0;
    j.rz = 0;
    j.dy = 0;
  }

  const swing = Math.sin(inp.phase * Math.PI * 2);
  const lift = Math.max(0, Math.sin(inp.phase * Math.PI * 2));
  const state = inp.state;

  if (state === 'idle') {
    const breath = Math.sin(inp.stateTime * 1.6) * 0.012;
    out.torso.dy = breath;
    out.hips.dy = breath * 0.4;
    out.upperArmL.rz = 0.08;
    out.upperArmR.rz = -0.08;
  } else if (state === 'walk' || state === 'jog' || state === 'sprint' || state === 'crouchWalk') {
    const amp = state === 'sprint' ? 0.9 : state === 'jog' ? 0.7 : state === 'crouchWalk' ? 0.35 : 0.45;
    const arm = state === 'sprint' ? 0.7 : state === 'jog' ? 0.55 : 0.4;
    out.upperLegL.rz = swing * amp;
    out.upperLegR.rz = -swing * amp;
    // Knee bends on the swing-through (negative swing = leg back, still some bend).
    const knee = (side: number): number => {
      const t = Math.max(0, side);
      return 0.15 + t * (state === 'sprint' ? 1.05 : 0.7);
    };
    out.lowerLegL.rz = -knee(-swing);
    out.lowerLegR.rz = -knee(swing);
    out.upperArmL.rz = -swing * arm;
    out.upperArmR.rz = swing * arm;
    if (state === 'sprint') {
      out.lowerArmL.rz = -1.15;
      out.lowerArmR.rz = -1.15;
      out.torso.rz = 0.18;
    } else if (state === 'jog') {
      out.lowerArmL.rz = -0.35;
      out.lowerArmR.rz = -0.35;
      out.torso.rz = 0.08;
    }
    out.hips.dy = Math.abs(swing) * (state === 'crouchWalk' ? 0.01 : 0.025);
    // Flip-flop scuff: feet stay nearly flat, a little toe drag.
    out.footL.rz = lift * 0.15;
    out.footR.rz = (1 - lift) * 0.15;
  } else if (state === 'crouch') {
    out.hips.dy = -0.28;
    out.upperLegL.rz = 0.7;
    out.upperLegR.rz = 0.7;
    out.lowerLegL.rz = -1.25;
    out.lowerLegR.rz = -1.25;
    out.torso.rz = 0.25;
    out.upperArmL.rz = 0.3;
    out.upperArmR.rz = 0.3;
  } else if (state === 'jump') {
    out.upperLegL.rz = -0.35;
    out.upperLegR.rz = -0.35;
    out.lowerLegL.rz = -0.7;
    out.lowerLegR.rz = -0.7;
    out.upperArmL.rz = -2.2;
    out.upperArmR.rz = -2.2;
    out.torso.rz = -0.1;
  } else if (state === 'fall') {
    out.upperLegL.rz = 0.25;
    out.upperLegR.rz = 0.15;
    out.lowerLegL.rz = -0.4;
    out.lowerLegR.rz = -0.3;
    out.upperArmL.rz = -0.4;
    out.upperArmR.rz = 0.5;
  } else if (state === 'land') {
    const k = clamp(1 - inp.stateTime / 0.12, 0, 1);
    out.hips.dy = -0.08 * k;
    out.upperLegL.rz = 0.45 * k;
    out.upperLegR.rz = 0.45 * k;
    out.lowerLegL.rz = -0.9 * k;
    out.lowerLegR.rz = -0.9 * k;
    out.torso.rz = 0.2 * k;
  } else if (state === 'sit') {
    out.hips.dy = -0.45;
    out.upperLegL.rz = 1.45;
    out.upperLegR.rz = 1.45;
    out.lowerLegL.rz = -1.5;
    out.lowerLegR.rz = -1.5;
    out.upperArmL.rz = 0.4;
    out.upperArmR.rz = 0.15;
  } else if (state === 'eat') {
    out.hips.dy = -0.45;
    out.upperLegL.rz = 1.45;
    out.upperLegR.rz = 1.45;
    out.lowerLegL.rz = -1.5;
    out.lowerLegR.rz = -1.5;
    const chew = Math.sin(inp.stateTime * (Math.PI * 2) / 1.2);
    out.upperArmR.rz = -0.9 + chew * 0.25;
    out.lowerArmR.rz = -1.1;
    out.head.rz = 0.25 + Math.max(0, chew) * 0.1;
  } else if (state === 'carry') {
    out.upperArmL.rz = -1.1;
    out.upperArmR.rz = -1.1;
    out.lowerArmL.rz = -0.8;
    out.lowerArmR.rz = -0.8;
    out.torso.rz = 0.05;
  }

  out.torso.rz += inp.lean;

  // Coat tails: follow the thigh, and kick up when falling.
  const flutter = clamp(-inp.vy * 0.05, -0.4, 0.5);
  const sprintAmp = state === 'sprint' ? 0.9 : 0.6;
  out.coatTailL.rz = clamp(out.upperLegL.rz * 0.55 + flutter, -sprintAmp, sprintAmp);
  out.coatTailR.rz = clamp(out.upperLegR.rz * 0.55 + flutter, -sprintAmp, sprintAmp);
  out.coatTailB.rz = clamp(-Math.abs(swing) * 0.25 + flutter * 0.5, -sprintAmp, sprintAmp);

  for (const id of JOINTS) clampJoint(out[id]);
}

export function blendPose(a: Pose, b: Pose, t: number, out: Pose): void {
  const k = clamp(t, 0, 1);
  for (const id of JOINTS) {
    out[id].rx = a[id].rx + (b[id].rx - a[id].rx) * k;
    out[id].ry = a[id].ry + (b[id].ry - a[id].ry) * k;
    out[id].rz = a[id].rz + (b[id].rz - a[id].rz) * k;
    out[id].dy = a[id].dy + (b[id].dy - a[id].dy) * k;
  }
}

/** Map the controller state onto a pose state. `air` splits by vertical speed. */
export function poseStateFrom(state: string, vy: number): AnimState {
  if (state === 'air') return vy > 0.4 ? 'jump' : 'fall';
  if (
    state === 'idle' || state === 'walk' || state === 'jog' || state === 'sprint' ||
    state === 'crouch' || state === 'crouchWalk' || state === 'land' ||
    state === 'sit' || state === 'eat' || state === 'carry' ||
    state === 'jump' || state === 'fall'
  ) {
    return state;
  }
  return 'idle';
}
