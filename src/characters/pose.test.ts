import { describe, expect, it } from 'vitest';
import {
  advancePhase,
  blendPose,
  computePose,
  createPose,
  solveTwoBone,
  type JointName,
} from './pose';

const JOINTS: JointName[] = [
  'hips', 'torso', 'head',
  'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR',
  'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR',
  'footL', 'footR',
  'coatTailL', 'coatTailR', 'coatTailB',
];

describe('advancePhase', () => {
  it('advances by distance, so double speed over half the time matches', () => {
    const slow = advancePhase(0, 1.6 * 1, 'jog');
    const fast = advancePhase(0, 3.2 * 0.5, 'jog');
    expect(fast).toBeCloseTo(slow, 6);
    expect(slow).toBeCloseTo(1.6 / 1.05, 5);
  });
});

describe('computePose', () => {
  it('keeps every joint inside its limits', () => {
    const pose = createPose();
    const states = ['idle', 'walk', 'jog', 'sprint', 'crouch', 'crouchWalk', 'jump', 'fall', 'land', 'sit', 'eat', 'carry'] as const;
    for (const state of states) {
      for (let i = 0; i < 8; i++) {
        computePose({ state, stateTime: i * 0.2, phase: i / 8, speed: 4, vy: state === 'jump' ? 4 : -2, lean: 0.2 }, pose);
        for (const id of JOINTS) {
          const j = pose[id];
          expect(Math.abs(j.rx)).toBeLessThanOrEqual(1.6);
          expect(Math.abs(j.ry)).toBeLessThanOrEqual(1.6);
          expect(Math.abs(j.rz)).toBeLessThanOrEqual(1.6);
          expect(j.dy).toBeGreaterThanOrEqual(-0.6);
          expect(j.dy).toBeLessThanOrEqual(0.4);
        }
      }
    }
  });

  it('swings opposite legs and lifts the coat when falling', () => {
    const pose = createPose();
    computePose({ state: 'jog', stateTime: 0.2, phase: 0.25, speed: 4, vy: 0, lean: 0 }, pose);
    expect(pose.upperLegL.rz).toBeGreaterThan(0.2);
    expect(pose.upperLegR.rz).toBeLessThan(-0.2);
    computePose({ state: 'fall', stateTime: 0.1, phase: 0, speed: 0, vy: -6, lean: 0 }, pose);
    expect(pose.coatTailB.rz).not.toBe(0);
  });

  it('blends two poses', () => {
    const a = createPose();
    const b = createPose();
    const out = createPose();
    computePose({ state: 'idle', stateTime: 0, phase: 0, speed: 0, vy: 0, lean: 0 }, a);
    computePose({ state: 'sprint', stateTime: 0.2, phase: 0.3, speed: 7, vy: 0, lean: 0 }, b);
    blendPose(a, b, 0.5, out);
    expect(out.upperLegL.rz).toBeCloseTo((a.upperLegL.rz + b.upperLegL.rz) / 2, 5);
  });
});

describe('solveTwoBone', () => {
  it('solves a right angle for equal bones and a diagonal target', () => {
    const { a, b } = solveTwoBone(1, 1, Math.SQRT2);
    expect(a).toBeCloseTo(Math.PI / 4, 5);
    expect(b).toBeCloseTo(Math.PI / 2, 5);
  });

  it('stretches to a straight line when the target is the sum of the bones', () => {
    const { b } = solveTwoBone(0.4, 0.4, 0.8);
    expect(b).toBeCloseTo(0, 2);
  });
});
