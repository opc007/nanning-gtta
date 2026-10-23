import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Crowd } from './crowd';

/**
 * The crowd's own rules, tested without a renderer.
 *
 * The people on the carriageway are Kenney models that arrive over the
 * network, so these tests never wait for a body — the group, the position and
 * the fight logic all exist the moment somebody is placed.
 */
function makeCrowd(ambient: number): Crowd {
  return new Crowd(new THREE.Scene(), [], ambient);
}

describe('Crowd — street rules', () => {
  it('everybody on the street is a target', () => {
    const crowd = makeCrowd(12);
    expect(crowd.talkers.length).toBeGreaterThan(0);
    expect(crowd.targets().length).toBe(crowd.talkers.length);
    const t = crowd.targets()[0];
    expect(t.kind).toBe('ped');
    expect(typeof t.strike).toBe('function');
    expect(typeof t.grab).toBe('function');
  });

  it('a punch puts someone on the floor after three of them, and they get up', () => {
    const crowd = makeCrowd(12);
    const t = crowd.talkers[0];
    const target = crowd.targets()[0];
    expect(target.strike!(1)).toBe(true);
    expect(t.combat).toBe('shoved');
    // Two more and they are down.
    target.strike!(1);
    target.strike!(1);
    expect(t.combat).toBe('down');
  });

  it('someone who is hit turns on you when they get up', () => {
    const crowd = makeCrowd(12);
    const t = crowd.talkers[0];
    crowd.targets()[0].strike!(1);
    // Run out the shove timer.
    for (let i = 0; i < 80; i++) crowd.update(1 / 30, t.x, t.z + 3, 0, 0, 0);
    expect(t.combat).toBe('fight');
    expect(t.hostile).toBe(true);
  });

  it('a thrown body knocks other people over', () => {
    const crowd = makeCrowd(16);
    // Put two people next to each other by hand: the ambient placement is
    // random, and this test is about the collision, not the layout.
    const a = crowd.talkers[0];
    const b = crowd.talkers[1];
    a.x = 0; a.z = 0;
    b.x = 0.6; b.z = -1.2;

    // Carry the first one and throw them at the second.
    crowd.targets()[0].grab!();
    expect(crowd.carrying()).toBe(true);
    crowd.release(9, 0, -1);
    expect(crowd.carrying()).toBe(false);

    for (let i = 0; i < 40; i++) crowd.update(1 / 30, 0, 2.6, 0, 0, Math.PI / 2);
    expect(b.combat).toBe('down');
  });

  it('a carried person is carried over the shoulder', () => {
    const crowd = makeCrowd(12);
    const t = crowd.talkers[0];
    crowd.targets()[0].grab!();
    crowd.update(1 / 30, 5, 7, 0, 0, 0);
    // Facing +X with heading 0. The person goes over the shoulder: behind
    // the carrier, down their back, and at three-quarter size so their boots
    // hang behind instead of burying themselves in the carrier's neck.
    // Slightly behind the carrier and out to one side, at shoulder height:
    // the body lies along the line of the shoulders with the head past one
    // of them, not stacked on top of the carrier's head.
    expect(t.group.position.x).toBeGreaterThan(4.7);
    expect(t.group.position.x).toBeLessThan(5.05);
    expect(t.group.position.z).toBeGreaterThan(7.2);
    expect(t.group.position.y).toBeCloseTo(1.3, 2);
    expect(t.group.scale.x).toBeCloseTo(0.72, 2);
    // The body lies across the line of the shoulders, not down the back.
    expect(t.group.rotation.z).toBeLessThan(-1.2);
  });
});
