/**
 * Procedural low-poly character. Every limb is its own Object3D so a later
 * pass can animate it. Outfit pieces are children of the body part they ride
 * on (coat on the torso, sleeves on the arms, flip-flops on the feet), which
 * is what makes a clothing swap a data change.
 *
 * Local space matches the game: facing +X at rotation.y = 0, +Y up, +Z is
 * the character's right.
 */

import * as THREE from 'three';
import type { CharacterDef } from './types';
import { advancePhase, computePose, createPose, poseStateFrom, type JointName } from './pose';

export interface CharacterAnim {
  state: string;
  stateTime: number;
  /** Punch progress, 1 at the hit falling back to 0. See `pose.ts`. */
  punch?: number;
  vy: number;
}

export interface CharacterRig {
  group: THREE.Group;
  /** Named joints. Keys are stable: hips, torso, head, upperArmL, lowerArmL, ... */
  readonly limbs: Record<string, THREE.Object3D>;
  update(speed: number, dt: number, anim?: CharacterAnim): void;
  /**
   * Hide the face for the first-person camera. The GLB rig needs it because
   * skinning ignores the bone's own `visible` flag, so the head meshes have to
   * be hidden directly rather than through the head joint.
   */
  setHeadVisible(visible: boolean): void;
}

const mat = (color: number, roughness = 0.78): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function joint(name: string, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

/** A limb segment whose pivot is the joint and whose mesh hangs toward -Y. */
function hang(name: string, w: number, h: number, d: number, material: THREE.Material): THREE.Group {
  const g = joint(name, 0, 0, 0);
  g.add(box(w, h, d, material, 0, -h / 2, 0));
  return g;
}

export function buildCharacter(def: CharacterDef): CharacterRig {
  const group = new THREE.Group();
  group.name = `character:${def.id}`;

  const skin = mat(def.body.skin, 0.72);
  const hairMat = mat(def.hair.color, 0.95);
  const streakMat = mat(def.hair.streak, 0.9);
  const cloth = mat(def.top.color, 0.9);
  const coatMat = def.outerwear ? mat(def.outerwear.color, 0.82) : null;
  const shortsMat = mat(def.bottoms.color, 0.88);
  const shoeMat = mat(def.shoes.color, 0.55);
  const glassMat = def.glasses ? mat(def.glasses.color, 0.35) : null;
  const penMat = mat(0x1d4e89, 0.4);
  const penRed = mat(0x9b2335, 0.4);
  const bookMat = mat(0xc4b49a, 0.85);
  const dark = mat(0x1a1a1a, 0.6);

  const limbs: Record<string, THREE.Object3D> = {};
  const add = (parent: THREE.Object3D, node: THREE.Object3D): void => {
    parent.add(node);
    limbs[node.name] = node;
  };

  // Shoulder width drives how far the arms sit. Height scales the leg drop
  // so a taller def still plants its feet on y = 0.
  const shoulder = def.body.shoulder;
  const hipY = 0.9 * (def.body.height / 1.74);
  const shoulderY = 1.4 * (def.body.height / 1.74);

  const hips = joint('hips', 0, hipY, 0);
  group.add(hips);
  limbs.hips = hips;

  if (def.bottoms.style === 'cargo-shorts') {
    // Loose, ending just above the knee. Pockets hang off the thighs below.
    hips.add(box(0.3, 0.22, shoulder * 0.8, shortsMat, 0.01, -0.06, 0));
  }

  const torso = joint('torso', 0, 0.06, 0);
  add(hips, torso);
  torso.add(box(0.22, 0.36, shoulder * 0.78, skin, 0, 0.2, 0));

  if (def.top.style === 'tank') {
    // Ribbed tank: a grey shell plus two darker ribs so it isn't a flat slab.
    // It shows through an open coat.
    torso.add(box(0.2, 0.32, shoulder * 0.7, cloth, 0.01, 0.2, 0));
    const rib = mat(def.top.color - 0x1a1a1a, 0.95);
    torso.add(box(0.205, 0.02, shoulder * 0.72, rib, 0.02, 0.28, 0));
    torso.add(box(0.205, 0.02, shoulder * 0.72, rib, 0.02, 0.2, 0));
    torso.add(box(0.205, 0.02, shoulder * 0.72, rib, 0.02, 0.12, 0));
  }

  if (def.outerwear?.style === 'labcoat' && coatMat) {
    // Knee-length, open down the front. Back panel plus two fronts that don't meet.
    const hem = -0.54;
    torso.add(box(0.08, 0.86, shoulder * 0.96, coatMat, -0.1, hem + 0.43, 0));
    torso.add(box(0.16, 0.84, 0.12, coatMat, 0.04, hem + 0.44, shoulder * 0.3));
    torso.add(box(0.16, 0.84, 0.12, coatMat, 0.04, hem + 0.44, -shoulder * 0.3));
    // Collar.
    torso.add(box(0.08, 0.08, 0.1, coatMat, 0.06, 0.4, 0.08));
    torso.add(box(0.08, 0.08, 0.1, coatMat, 0.06, 0.4, -0.08));
    if (def.outerwear.pocketPens) {
      // Wearer's left chest (local -Z).
      torso.add(box(0.04, 0.08, 0.1, coatMat, 0.1, 0.22, -0.12));
      torso.add(box(0.012, 0.09, 0.012, penMat, 0.13, 0.3, -0.14));
      torso.add(box(0.012, 0.08, 0.012, dark, 0.13, 0.29, -0.12));
      torso.add(box(0.012, 0.1, 0.012, penRed, 0.13, 0.31, -0.1));
    }
    if (def.outerwear.sideNotebook) {
      // Wearer's right side pocket (local +Z).
      torso.add(box(0.05, 0.1, 0.09, coatMat, 0.08, 0.02, 0.2));
      torso.add(box(0.03, 0.09, 0.07, bookMat, 0.11, 0.04, 0.2));
    }
  }

  const head = joint('head', 0, 0.5, 0);
  add(torso, head);
  head.add(box(0.2, 0.24, 0.18, skin, 0.02, 0.12, 0));
  // Ears.
  head.add(box(0.04, 0.07, 0.03, skin, 0.02, 0.12, 0.1));
  head.add(box(0.04, 0.07, 0.03, skin, 0.02, 0.12, -0.1));
  // Brow, nose, mouth — enough that a close-up isn't a blank box.
  head.add(box(0.03, 0.05, 0.035, skin, 0.12, 0.1, 0));
  head.add(box(0.015, 0.012, 0.06, dark, 0.125, 0.05, 0));
  // Eyes sit just behind the lenses so the glasses have a face in them.
  const eye = mat(0xf4f1ea, 0.4);
  const pupil = mat(0x1a1a1a, 0.3);
  head.add(box(0.02, 0.018, 0.028, eye, 0.115, 0.14, 0.042));
  head.add(box(0.02, 0.018, 0.028, eye, 0.115, 0.14, -0.042));
  head.add(box(0.012, 0.012, 0.012, pupil, 0.125, 0.138, 0.042));
  head.add(box(0.012, 0.012, 0.012, pupil, 0.125, 0.138, -0.042));

  if (def.hair.style === 'messy') {
    head.add(box(0.22, 0.08, 0.2, hairMat, 0.0, 0.26, 0));
    head.add(box(0.16, 0.06, 0.12, streakMat, -0.02, 0.3, 0.04));
    head.add(box(0.1, 0.07, 0.08, hairMat, 0.04, 0.28, -0.06));
    head.add(box(0.08, 0.1, 0.06, hairMat, -0.04, 0.22, 0.07));
    // A fringe over the forehead.
    head.add(box(0.06, 0.06, 0.16, hairMat, 0.1, 0.22, 0));
  }

  if (def.glasses?.style === 'thick-rect' && glassMat) {
    const glasses = joint('glasses', 0.12, 0.13, 0);
    head.add(glasses);
    limbs.glasses = glasses;
    // Two thick rims and a bridge. Temples run back toward the ears.
    glasses.add(box(0.025, 0.055, 0.075, glassMat, 0, 0, 0.045));
    glasses.add(box(0.025, 0.055, 0.075, glassMat, 0, 0, -0.045));
    glasses.add(box(0.02, 0.012, 0.03, glassMat, 0, 0.01, 0));
    glasses.add(box(0.09, 0.012, 0.012, glassMat, -0.04, 0.02, 0.078));
    glasses.add(box(0.09, 0.012, 0.012, glassMat, -0.04, 0.02, -0.078));
    // Pale lenses so the frames read as glasses, not a mask.
    const lens = mat(0xc5d0d8, 0.15);
    lens.transparent = true;
    lens.opacity = 0.35;
    glasses.add(box(0.01, 0.04, 0.055, lens, 0.012, 0, 0.045));
    glasses.add(box(0.01, 0.04, 0.055, lens, 0.012, 0, -0.045));
  }

  // Arms. Sleeves parent to the upper arm so they swing with it.
  const armL = hang('upperArmL', 0.09, 0.26, 0.09, skin);
  armL.position.set(0, shoulderY - hipY - 0.06, -shoulder * 0.58);
  add(torso, armL);
  const foreL = hang('lowerArmL', 0.075, 0.24, 0.075, skin);
  foreL.position.set(0, -0.26, 0);
  add(armL, foreL);
  foreL.add(box(0.08, 0.06, 0.09, skin, 0, -0.27, 0));

  const armR = hang('upperArmR', 0.09, 0.26, 0.09, skin);
  armR.position.set(0, shoulderY - hipY - 0.06, shoulder * 0.58);
  add(torso, armR);
  const foreR = hang('lowerArmR', 0.075, 0.24, 0.075, skin);
  foreR.position.set(0, -0.26, 0);
  add(armR, foreR);
  foreR.add(box(0.08, 0.06, 0.09, skin, 0, -0.27, 0));

  if (coatMat && def.outerwear?.style === 'labcoat') {
    armL.add(box(0.12, 0.24, 0.12, coatMat, 0, -0.12, 0));
    armR.add(box(0.12, 0.24, 0.12, coatMat, 0, -0.12, 0));
    // Sleeves continue to the wrist; the hand stays bare.
    foreL.add(box(0.095, 0.2, 0.095, coatMat, 0, -0.1, 0));
    foreR.add(box(0.095, 0.2, 0.095, coatMat, 0, -0.1, 0));
  }

  // Legs. Feet carry the shoes.
  const legL = hang('upperLegL', 0.12, 0.4, 0.12, skin);
  legL.position.set(0, -0.08, -0.09);
  add(hips, legL);
  if (def.bottoms.style === 'cargo-shorts') {
    // Thigh of the shorts, plus a flap pocket on the outer face.
    legL.add(box(0.15, 0.28, 0.15, shortsMat, 0.01, -0.16, 0));
    legL.add(box(0.04, 0.12, 0.1, shortsMat, 0.02, -0.2, -0.09));
  }
  const shinL = hang('lowerLegL', 0.09, 0.38, 0.09, skin);
  shinL.position.set(0, -0.4, 0);
  add(legL, shinL);

  const legR = hang('upperLegR', 0.12, 0.4, 0.12, skin);
  legR.position.set(0, -0.08, 0.09);
  add(hips, legR);
  if (def.bottoms.style === 'cargo-shorts') {
    legR.add(box(0.15, 0.28, 0.15, shortsMat, 0.01, -0.16, 0));
    legR.add(box(0.04, 0.12, 0.1, shortsMat, 0.02, -0.2, 0.09));
  }
  const shinR = hang('lowerLegR', 0.09, 0.38, 0.09, skin);
  shinR.position.set(0, -0.4, 0);
  add(legR, shinR);

  if (def.shoes.style === 'flipflop') {
    const foot = (parent: THREE.Object3D, name: string): void => {
      const f = joint(name, 0.02, -0.4, 0);
      parent.add(f);
      limbs[name] = f;
      // Sole under the heel, toes past the front, a thong between them.
      f.add(box(0.24, 0.018, 0.085, shoeMat, 0.06, 0, 0));
      f.add(box(0.07, 0.035, 0.06, skin, 0.14, 0.028, 0));
      f.add(box(0.012, 0.04, 0.012, shoeMat, 0.11, 0.04, 0));
      f.add(box(0.05, 0.01, 0.07, shoeMat, 0.07, 0.045, 0));
    };
    foot(shinL, 'footL');
    foot(shinR, 'footR');
  }

  // Shorts cover the top of the thighs. Already on the hips.

  let phase = 0;
  const pose = createPose();
  const bindY: Record<string, number> = {};
  for (const [name, limb] of Object.entries(limbs)) bindY[name] = limb.position.y;

  const update = (speed: number, dt: number, anim?: CharacterAnim): void => {
    const state = poseStateFrom(anim?.state ?? (speed > 0.25 ? 'jog' : 'idle'), anim?.vy ?? 0);
    phase = advancePhase(phase, Math.max(0, speed) * dt, state);
    computePose(
      {
        state,
        stateTime: anim?.stateTime ?? 0,
        phase,
        speed,
        vy: anim?.vy ?? 0,
        lean: 0,
      },
      pose,
    );
    for (const [name, limb] of Object.entries(limbs)) {
      const j = pose[name as JointName];
      if (!j) continue;
      limb.rotation.set(j.rx, j.ry, j.rz);
      const base = bindY[name];
      if (base !== undefined) limb.position.y = base + j.dy;
    }
  };

  return {
    group,
    limbs,
    update,
    setHeadVisible(visible: boolean) {
      const head = limbs.head;
      if (head) head.visible = visible;
    },
  };
}
