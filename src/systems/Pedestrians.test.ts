import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Pedestrians } from './Pedestrians';
import { Debris } from './Debris';
import { World } from '../ecs/World';
import type { City } from '../world/City';

/**
 * The brawl rules, tested without a renderer.
 *
 * A small city keeps every pedestrian inside a few metres of every other one,
 * which is what makes "their friends notice" testable: the radius that
 * decides who joins a fight is bigger than the map.
 */
function fakeCity(half: number): City {
  return {
    half,
    grid: { resolve: (x: number, z: number) => ({ x, z }) },
  } as unknown as City;
}

function makeCrowd(count: number, seed: number) {
  const scene = new THREE.Scene();
  const world = new World();
  const debris = new Debris(scene, world);
  const city = fakeCity(3);
  const peds = new Pedestrians(scene, city, world, debris, count, seed);
  return { peds, city, world };
}

/** Put the player a metre to the left of pedestrian `i` and face them. */
function standNear(peds: Pedestrians, i: number): { x: number; z: number; dirX: number; dirZ: number } {
  const p = peds.at(i)!;
  return { x: p.x - 1, z: p.z, dirX: 1, dirZ: 0 };
}

describe('Pedestrians — brawls', () => {
  it('punching someone sends their friends after you', () => {
    const { peds } = makeCrowd(24, 12345);
    let fights = 0;
    peds.onFightStart = () => { fights++; };

    const aim = standNear(peds, 0);
    expect(peds.punch(aim.x, aim.z, aim.dirX, aim.dirZ, 2.6, 1)).toBe(true);
    expect(fights).toBeGreaterThan(0);
  });

  it('a punch makes the person you hit run from you', () => {
    const { peds } = makeCrowd(24, 999);
    const before = peds.at(0)!;
    const aim = standNear(peds, 0);
    expect(peds.punch(aim.x, aim.z, aim.dirX, aim.dirZ, 2.6, 1)).toBe(true);

    // The victim used to just carry on walking: `scared` was only ever set by
    // the car-threat path, so on foot a punch looked like it did nothing.
    for (let i = 0; i < 30; i++) peds.update(fakeCity(3), 1 / 30, undefined, undefined, undefined, { x: aim.x, z: aim.z });
    const after = peds.at(0)!;
    const distBefore = Math.hypot(before.x - aim.x, before.z - aim.z);
    const distAfter = Math.hypot(after.x - aim.x, after.z - aim.z);
    expect(distAfter).toBeGreaterThan(distBefore);
  });

  it('the street fights back: a hostile pedestrian reaches you and swings', () => {
    const { peds } = makeCrowd(24, 4242);
    let swings = 0;
    let damage = 0;
    peds.onSwing = (_x, _z, dmg) => { swings++; damage += dmg; };

    const aim = standNear(peds, 0);
    peds.punch(aim.x, aim.z, aim.dirX, aim.dirZ, 2.6, 1);

    // Four seconds of street time. They have to close from wherever they were
    // standing, which is the whole point: they come to you.
    for (let i = 0; i < 120; i++) {
      peds.update(fakeCity(3), 1 / 30, undefined, undefined, undefined, { x: aim.x, z: aim.z });
    }
    expect(swings).toBeGreaterThan(0);
    expect(damage).toBeGreaterThan(0);
  });

  it('a brawl does not last forever', () => {
    const { peds } = makeCrowd(24, 777);
    const aim = standNear(peds, 0);
    peds.punch(aim.x, aim.z, aim.dirX, aim.dirZ, 2.6, 1);
    for (let i = 0; i < 30; i++) peds.update(fakeCity(3), 1 / 30, undefined, undefined, undefined, { x: aim.x, z: aim.z });
    // Not the person you hit: they are the one being shoved. It is their
    // friends who come, so look at the whole crowd.
    const fighting = Array.from({ length: 24 }, (_, i) => peds.at(i)).filter((p) => p?.state === 'fight');
    expect(fighting.length).toBeGreaterThan(0);

    // Twelve seconds later nobody is still swinging.
    for (let i = 0; i < 360; i++) peds.update(fakeCity(3), 1 / 30, undefined, undefined, undefined, { x: aim.x, z: aim.z });
    const stillFighting = Array.from({ length: 24 }, (_, i) => peds.at(i)).filter((p) => p?.state === 'fight');
    expect(stillFighting.length).toBe(0);
  });

  it('no foe means no fight: the crowd gives up when you are not there', () => {
    const { peds } = makeCrowd(24, 31337);
    const aim = standNear(peds, 0);
    peds.punch(aim.x, aim.z, aim.dirX, aim.dirZ, 2.6, 1);
    for (let i = 0; i < 30; i++) peds.update(fakeCity(3), 1 / 30, undefined, undefined, undefined, { x: aim.x, z: aim.z });
    // The foe argument is what says "you are still here".
    for (let i = 0; i < 10; i++) peds.update(fakeCity(3), 1 / 30, undefined, undefined, undefined, null);
    const stillFighting = Array.from({ length: 24 }, (_, i) => peds.at(i)).filter((p) => p?.state === 'fight');
    expect(stillFighting.length).toBe(0);
  });
});
