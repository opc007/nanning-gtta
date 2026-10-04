import { describe, expect, it } from 'vitest';
import { computePose, createPose } from './pose';

const poseOf = (input: Partial<Parameters<typeof computePose>[0]>) => {
  const pose = createPose();
  computePose(
    {
      state: 'idle', stateTime: 0, phase: 0, speed: 0, vy: 0, lean: 0,
      ...input,
    },
    pose,
  );
  return pose;
};

describe('punch overlay', () => {
  it('leaves the pose alone when not punching', () => {
    const idle = poseOf({ state: 'idle' });
    const explicitZero = poseOf({ state: 'idle', punch: 0 });
    expect(explicitZero.upperArmR.rz).toBeCloseTo(idle.upperArmR.rz, 6);
    expect(explicitZero.torso.rz).toBeCloseTo(idle.torso.rz, 6);
  });

  it('extends the right arm forward at peak extension', () => {
    // `punch` is the remaining fraction, so it counts down from 1. Peak
    // extension is 30% of the way through the swing.
    const p = poseOf({ state: 'idle', punch: 0.7 });
    expect(p.upperArmR.rz).toBeGreaterThan(1.0);
    expect(p.lowerArmR.rz).toBeLessThan(0);
  });

  it('pulls the off arm back and twists the torso into it', () => {
    const rest = poseOf({ state: 'idle' });
    const p = poseOf({ state: 'idle', punch: 0.7 });
    expect(p.upperArmL.rz).toBeLessThan(rest.upperArmL.rz);
    expect(p.torso.rz).toBeGreaterThan(rest.torso.rz + 0.1);
  });

  it('returns to the rest pose by the end of the swing', () => {
    const rest = poseOf({ state: 'idle' });
    const done = poseOf({ state: 'idle', punch: 0 });
    expect(done.upperArmR.rz).toBeCloseTo(rest.upperArmR.rz, 6);
  });

  it('out-ranks the gait, because you can punch while walking', () => {
    // At the same stride phase the punching arm must differ from the walking
    // arm; otherwise the punch is invisible whenever the player is moving.
    const walk = poseOf({ state: 'walk', phase: 0.25, speed: 1.2 });
    const walkPunch = poseOf({ state: 'walk', phase: 0.25, speed: 1.2, punch: 0.7 });
    expect(Math.abs(walkPunch.upperArmR.rz - walk.upperArmR.rz)).toBeGreaterThan(0.5);
  });

  it('never leaves a joint outside its limits', () => {
    // The limit was 1.6 while the joint rotation was still being applied in
    // the model's bind frame, where the character-space axis is skewed by the
    // 90-degree pivot and a full extension could not be reached. It is 2.9 now
    // that `glbRig` maps the pose rotation into character space first: a
    // fully extended punch needs 2.42 rad, and silently clipping it to 1.6 is
    // what left the arm 25 degrees below horizontal at the punch peak.
    const LIMIT = 2.9;
    for (const punch of [1, 0.9, 0.7, 0.5, 0.3, 0.1]) {
      const p = poseOf({ state: 'sprint', phase: 0.4, speed: 5, punch });
      for (const j of Object.values(p)) {
        for (const axis of ['rx', 'ry', 'rz'] as const) {
          expect(Math.abs(j[axis])).toBeLessThanOrEqual(LIMIT);
        }
      }
    }
  });

  it('clamps progress outside 0..1 instead of overshooting', () => {
    const over = poseOf({ state: 'idle', punch: 5 });
    const atStart = poseOf({ state: 'idle', punch: 1 });
    expect(over.upperArmR.rz).toBeCloseTo(atStart.upperArmR.rz, 6);
    const under = poseOf({ state: 'idle', punch: -3 });
    const atEnd = poseOf({ state: 'idle', punch: 0 });
    expect(under.upperArmR.rz).toBeCloseTo(atEnd.upperArmR.rz, 6);
  });
});
