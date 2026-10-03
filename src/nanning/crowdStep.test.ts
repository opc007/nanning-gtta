import { describe, expect, it } from 'vitest';
import { stepCrowd, type CrowdMover } from './crowdStep';

const mover = (partial: Partial<CrowdMover>): CrowdMover => ({
  t: 0,
  leaving: false,
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  idleSteps: 0,
  ...partial,
});

describe('crowd step', () => {
  it('does not freeze the people standing after someone who is leaving', () => {
    const agents = [
      mover({ leaving: true, vx: 2, vz: 0 }),
      mover({ x: 5 }),
      mover({ x: 8, t: 1.2 }),
    ];
    stepCrowd(agents, 0.5);
    expect(agents[0].x).toBeCloseTo(1);
    expect(agents[0].idleSteps).toBe(0);
    // The old `return` skipped everyone after the walker.
    expect(agents[1].idleSteps).toBe(1);
    expect(agents[2].t).toBeCloseTo(0.7);
    expect(agents[2].idleSteps).toBe(0);
  });

  it('lets a talker finish speaking before they walk off', () => {
    const agents = [mover({ leaving: true, t: 0.2, vx: 3 })];
    stepCrowd(agents, 0.5);
    expect(agents[0].t).toBeLessThanOrEqual(0);
    expect(agents[0].x).toBe(0);
  });
});
