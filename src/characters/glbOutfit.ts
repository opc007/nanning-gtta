/**
 * Clothes and props that are built on top of a loaded GLB character.
 *
 * The model we ship (`protagonist.glb`, Quaternius Ultimate Modular Men) gives
 * us a rounded body, a real face and a real hairstyle, but no lab coat, no
 * glasses and no flip-flops. Those three are the identity of this character, so
 * they are built here procedurally instead — the same idea as `buildCharacter`,
 * except these pieces are sized from the rig's own bone positions rather than
 * from a `CharacterDef` height.
 *
 * Everything is built in the character's own space (origin between the feet,
 * +X forward, +Y up, +Z the character's right) and then `attach()`ed onto the
 * bone it rides on. `attach()` keeps the world transform, so a piece built
 * against a measured bone position lands exactly where it was measured.
 */

import * as THREE from 'three';
import type { CharacterDef } from './types';

/** Bone positions and body measurements, in character space, taken at bind pose. */
export interface RigMetrics {
  height: number;
  /** Head bone origin. */
  head: THREE.Vector3;
  /** Centre of the face: where the glasses sit. */
  eye: THREE.Vector3;
  /** How far the face sticks out along +X, for pushing glasses off the brow. */
  faceFront: number;
  /** Left-right span of the model's own eye geometry; drives the frame width. */
  eyeSpan: number;
  /**
   * Half the torso's real width, and its front-back depth, measured from the
   * body mesh at chest height. Clothes have to clear the *body*, not the
   * shoulder joints: this model wears a jacket, so its torso is much wider
   * than the joint spacing, and a coat sized off the joints ends up buried
   * inside the character.
   */
  torsoHalf: number;
  torsoDepth: number;
  /** Half the distance between the shoulder joints. */
  shoulderHalf: number;
  neck: THREE.Vector3;
  chest: THREE.Vector3;
  hips: THREE.Vector3;
  upperArmLen: number;
  lowerArmLen: number;
  upperLegLen: number;
  lowerLegLen: number;
  foot: THREE.Vector3;
  torsoLen: number;
  hipWidth: number;
}

const mat = (color: number, roughness = 0.8): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });

function box(
  w: number, h: number, d: number,
  material: THREE.Material,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A round bar — eyeglass rims and lapel edges read better rounded than square. */
function bar(radius: number, len: number, material: THREE.Material, axis: 'x' | 'y' | 'z'): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), material);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true;
  return mesh;
}

// ── Glasses ────────────────────────────────────────────────────────────────

/**
 * Thick black rectangular frames. The rim is a real open loop rather than a
 * filled slab: a filled slab in front of the eyes reads as a mask, which is
 * exactly the failure the previous procedural character had.
 */
export function buildGlasses(m: RigMetrics, def: CharacterDef): THREE.Group {
  const g = new THREE.Group();
  g.name = 'glasses';
  if (!def.glasses) return g;

  const frame = mat(def.glasses.color, 0.35);
  const lensMat = new THREE.MeshStandardMaterial({
    // Pale and clearly translucent. At 0.22 the lens was so close to the eye
    // behind it that the frames read as one black bar across the face rather
    // than two framed lenses.
    color: 0xd6e6ef,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
  });

  // Size the frame off the model's own eye span rather than off body height:
  // the head is wider than the face, so a height-derived frame overhangs the
  // cheeks and reads as a visor.
  // 粗框: the rim is a sixth of the lens width. Thinner than that and the
  // frames read as a smudge at gameplay distance rather than as glasses.
  const rimW = m.eyeSpan * 0.62;
  const rimH = rimW * 0.7;
  const rimT = rimW * 0.19;
  const gap = m.eyeSpan * 0.08;

  for (const side of [1, -1] as const) {
    const cz = side * (gap + rimW / 2);
    // Four bars make the rim, and the lens lies in the YZ plane: width runs
    // along Z (the character's left-right), height along Y, and only the lens
    // itself has any thickness in X. Top and bottom span the full width, the
    // two sides span the full height, so the middle stays open and the eye
    // shows through instead of the frames reading as a visor.
    g.add(bar(rimT, rimW, frame, 'z').translateY(rimH / 2).translateZ(cz));
    g.add(bar(rimT, rimW, frame, 'z').translateY(-rimH / 2).translateZ(cz));
    g.add(bar(rimT, rimH, frame, 'y').translateZ(cz - rimW / 2));
    g.add(bar(rimT, rimH, frame, 'y').translateZ(cz + rimW / 2));
    // Lens sits just behind the rim.
    const lens = box(0.002, rimH * 0.9, rimW * 0.9, lensMat, 0, 0, cz);
    lens.castShadow = false;
    g.add(lens);

    // Temple runs back along -X to the ear, hinged on the outer edge of the
    // rim. Without it the frames read as stuck to the front of the face.
    const len = m.height * 0.045;
    const tz = cz + side * rimT;
    const arm = bar(rimT * 0.9, len, frame, 'y');
    arm.rotateZ(-Math.PI / 2); // lay the cylinder down along X
    arm.position.set(-len / 2, rimH * 0.32, tz);
    g.add(arm);
    g.add(box(rimT * 1.7, rimT * 1.7, rimT * 1.7, frame, 0, rimH * 0.32, tz));
  }
  // Bridge across the nose, sitting just above the rim centre line.
  g.add(bar(rimT, gap * 2 + rimT, frame, 'z').translateY(rimH * 0.28));

  // Relative to the head bone, not absolute. `attach()` preserves world
  // transform, so anything positioned in world space lands correctly only by
  // accident; everything built here is in the character's own space and is
  // placed on its bone by `attachAt`.
  g.position.copy(m.eye).sub(m.head);
  // Sit just clear of the eyeballs so the frames do not sink into the face.
  g.position.x += m.height * 0.012;
  return g;
}

// ── Lab coat ───────────────────────────────────────────────────────────────

export interface LabCoat {
  /** Rigid part: body, collar, pockets, sleeves. Attaches to the chest bone. */
  body: THREE.Group;
  /** Hem segments, kept separate so the walk cycle can swing them. */
  tails: { left: THREE.Object3D; right: THREE.Object3D; back: THREE.Object3D };
  /** Pivot the tails hang from; lives in character space, identity rotation. */
  root: THREE.Group;
}

/**
 * An open lab coat: back panel plus two fronts that do not meet, with a collar,
 * chest pockets and sleeves that ride the arm bones.
 */
export function buildLabCoat(m: RigMetrics, def: CharacterDef): LabCoat | null {
  const ow = def.outerwear;
  if (!ow || ow.style !== 'labcoat') return null;
  // Built in the character's own space (origin between the feet) and left at
  // the origin, so `attachAt` can drop it on the chest bone wherever that bone
  // happens to be in the world. Building it in world space works right up
  // until the character is not at the origin — and 中山路 is 150 m long.
  const coat = mat(ow.color, 0.84);
  const coatShade = mat(ow.color - 0x0a0a0a, 0.88);
  const penMat = mat(0x1d4e89, 0.4);
  const penRed = mat(0x9b2335, 0.4);
  const bookMat = mat(0xc4b49a, 0.85);

  const body = new THREE.Group();
  body.name = 'labcoat';

  // The coat hangs from the neck down to just below the knee.
  const top = m.neck.y;
  const hem = m.hips.y - m.upperLegLen * 0.55;
  const len = top - hem;
  const midY = (top + hem) / 2;
  // Sized off the torso, not the shoulder joints. This model wears a jacket
  // under the coat; sizing off the joints made every panel narrower than the
  // body, so the coat rendered as a white collar and cuffs and nothing else.
  // `+ CLEAR` is what actually makes it a coat rather than a shrink-wrap.
  // A lab coat drapes OVER the shoulders, so the widest thing it has to clear
  // is the shoulder joints — not the ribs. Sizing off the torso alone put the
  // whole garment inside the deltoids and the character wore a white collar
  // with a grey jacket underneath.
  const CLEAR = 0.012;
  const halfW = Math.max(m.torsoHalf, m.shoulderHalf * 0.94) + CLEAR;
  const chestD = m.torsoDepth / 2 + CLEAR;

  // Every panel has to sit OUTSIDE the body. `halfW` and `chestD` are already
  // half-extents that clear the shoulders and the ribs, so panels go at those
  // radii — pulling them inward (an earlier version used chestD * 0.62) buried
  // the whole front of the coat inside the jacket and the character read as
  // "grey suit with white collar" instead of "person in a lab coat".
  // `box(w, h, d, ...)` is w = X (front-back), d = Z (left-right). A coat
  // panel is the other way round: THIN in the axis it faces along, WIDE in
  // the axis it spans. Reading the arguments in the natural order silently
  // produced 32 cm deep, 2.8 cm wide slabs — the coat rendered as a thin
  // white stick in front of the chest for three revisions.
  //
  // The shell is four stacked slabs rather than one box: a lab coat flares at
  // the hem and nips in at the waist. One box reads as a refrigerator.
  const SLABS: [number, number, number][] = [
    // yBottom, yTop, halfWidth
    [hem, hem + len * 0.28, halfW * 1.12],
    [hem + len * 0.28, hem + len * 0.56, halfW * 0.98],
    [hem + len * 0.56, hem + len * 0.84, halfW * 0.9],
    [hem + len * 0.84, top, halfW * 0.95],
  ];
  for (const [y0, y1, hw] of SLABS) {
    const h = y1 - y0;
    const yc = (y0 + y1) / 2;
    // Sides first, so the slab's own width tapers with the rest of the coat.
    for (const side of [1, -1] as const) {
      body.add(box(hw * 1.9, h, 0.026, coat, 0, yc, side * hw * 0.96));
    }
    // Front and back, inset a little so the corners do not poke through.
    body.add(box(0.026, h, hw * 1.82, coat, chestD * 0.98, yc, 0));
    body.add(box(0.026, h, hw * 1.82, coat, -chestD * 0.98, yc, 0));
  }
  // The opening: a dark seam down the centre of the front, with a slight step
  // so it reads as two overlapping panels rather than a drawn line.
  body.add(box(0.014, len * 0.97, 0.018, coatShade, chestD * 1.03, midY, 0));

  // Shoulder yoke: closes the top of the coat around the neck.
  body.add(box(m.torsoDepth * 0.9, 0.1, halfW * 1.7, coat, -chestD * 0.1, top - 0.05, 0));

  // Collar: two angled lapels meeting at the throat.
  for (const side of [1, -1] as const) {
    const lapel = box(0.03, len * 0.19, halfW * 0.72, coat, chestD * 0.86, top - len * 0.08, side * halfW * 0.46);
    lapel.rotation.z = side * 0.34;
    lapel.rotation.y = -side * 0.2;
    body.add(lapel);
  }

  if (ow.pocketPens) {
    // Wearer's left chest pocket, with pens poking out.
    body.add(box(0.09, 0.13, 0.02, coat, chestD * 0.3, top - len * 0.2, halfW * 0.42));
    body.add(box(0.014, 0.1, 0.014, penMat, chestD * 0.3, top - len * 0.16, halfW * 0.44));
    body.add(box(0.014, 0.09, 0.014, penRed, chestD * 0.3, top - len * 0.17, halfW * 0.4));
  }
  if (ow.sideNotebook) {
    // Wearer's right side pocket with a notebook in it.
    body.add(box(0.022, 0.18, 0.13, coat, chestD * 1.0, top - len * 0.52, -halfW * 0.6));
    body.add(box(0.09, 0.13, 0.03, bookMat, chestD * 1.02, top - len * 0.51, -halfW * 0.6));
  }
  // A belt-ish seam at the waist reads as tailoring and breaks up the slab.
  body.add(box(chestD * 1.9, 0.026, halfW * 1.5, coatShade, 0, m.hips.y + 0.06, 0));

  // Tails hang from a pivot in character space so they can swing in the XY
  // plane without inheriting the chest bone's rotation.
  const root = new THREE.Group();
  root.name = 'coatRoot';
  root.position.set(0, m.hips.y - m.upperLegLen * 0.28, 0);

  const tailLen = m.hips.y - m.upperLegLen * 0.55 - (m.hips.y - m.upperLegLen * 0.28);
  const tails = {
    left: new THREE.Group(),
    right: new THREE.Group(),
    back: new THREE.Group(),
  };
  tails.left.name = 'coatTailL';
  tails.right.name = 'coatTailR';
  tails.back.name = 'coatTailB';
  for (const [key, t] of Object.entries(tails)) {
    t.position.set(0, 0, 0);
    const w = key === 'back' ? halfW * 1.3 : halfW * 0.62;
    const d = key === 'back' ? 0.035 : 0.03;
    t.add(box(w, tailLen, d, coat, 0, -tailLen / 2, key === 'back' ? -chestD * 0.42 : chestD * 0.1));
    root.add(t);
  }
  // The two front panels overlap the side tails so no gap opens at the hem.
  for (const t of [tails.left, tails.right]) {
    t.add(box(halfW * 0.5, tailLen * 0.95, 0.026, coat, chestD * 0.1, -tailLen * 0.48, 0));
  }

  return { body, tails, root };
}

/** A sleeve per arm segment, sized from the measured arm length. */
export function buildSleeves(m: RigMetrics, def: CharacterDef): {
  upper: THREE.Mesh; lower: THREE.Mesh;
} | null {
  const ow = def.outerwear;
  if (!ow || ow.style !== 'labcoat') return null;
  const coat = mat(ow.color, 0.84);
  // Off the torso, with the same clearance: a sleeve sized off the shoulder
  // joints left a bare grey strip down the outside of each arm.
  const w = Math.max(m.torsoHalf, m.shoulderHalf) * 0.92;
  const upper = box(w, m.upperArmLen * 0.94, w, coat, 0, -m.upperArmLen * 0.47, 0);
  const lower = box(w * 0.86, m.lowerArmLen * 0.86, w * 0.86, coat, 0, -m.lowerArmLen * 0.43, 0);
  return { upper, lower };
}

// ── Flip-flops ─────────────────────────────────────────────────────────────

/**
 * The model ships dress shoes. A black flip-flop is the sole plus a thong, so we
 * hide the shoe and stand a thong over the model's own foot — cheaper and a far
 * better fit than authoring a replacement foot mesh.
 *
 * Local frame matches the foot bone: +X toward the toes, +Y up, +Z across.
 */
export function buildFlipflopThongs(def: CharacterDef): THREE.Object3D | null {
  if (def.shoes.style !== 'flipflop') return null;
  const strap = mat(def.shoes.color, 0.5);
  const g = new THREE.Group();
  g.name = 'flipflopThong';
  // Local to the foot bone. See the note in buildGlasses.

  // Post between the big and second toe.
  const post = bar(0.011, 0.05, strap, 'y');
  post.position.set(0.042, 0.028, 0);
  g.add(post);

  // The V: two straps running from the post back to the inner edge of the sole.
  for (const side of [1, -1] as const) {
    const len = 0.11;
    const arm = bar(0.0095, len, strap, 'y');
    // Lay the cylinder down along its own length, then splay it out and back.
    arm.rotateZ(Math.PI / 2);
    arm.rotateX(side * 0.42);
    arm.rotateY(0);
    arm.position.set(0.012, 0.026, side * 0.036);
    g.add(arm);
  }
  // The toe bar that ties the two straps together at the front.
  const toe = bar(0.0095, 0.075, strap, 'z');
  toe.position.set(0.042, 0.05, 0);
  g.add(toe);
  return g;
}

/** Reusable measurement helper — everything below is derived from the rig. */
export function measure(
  bone: (name: string) => THREE.Object3D,
  headBox: THREE.Box3,
  eyeBox: THREE.Box3 | null,
  torso?: { half: number; depth: number },
): RigMetrics {
  const p = (n: string): THREE.Vector3 => bone(n).getWorldPosition(new THREE.Vector3());
  const head = p('Head');
  const neck = p('Neck');
  const chest = p('Chest');
  const hips = p('Hips');
  // The rig has `ShoulderL/R` *and* `UpperArmL/R`. The Shoulder pair sits at the
  // base of the neck — they are clavicle helpers, and they are only ~18 cm
  // apart. Shoulders for clothing and skinning are the UpperArm joints.
  const shoulderL = p('UpperArmL');
  const shoulderR = p('UpperArmR');
  const elbowL = p('LowerArmL');
  const handL = p('HandL');
  const hipL = p('UpperLegL');
  const hipR = p('UpperLegR');
  const kneeL = p('LowerLegL');
  const ankleL = p('FootL');
  const ankleR = p('FootR');

  // Anchor the glasses to the model's own eye geometry when it has one. The
  // head bounding box is no good for this: it includes the hair, which sits
  // high and at the back, and that puts the frames up on the forehead.
  const src = eyeBox ?? headBox;
  const eye = new THREE.Vector3(
    (src.min.x + src.max.x) * 0.5,
    (src.min.y + src.max.y) * 0.5,
    (src.min.z + src.max.z) * 0.5,
  );

  return {
    height: headBox.max.y,
    head,
    eye,
    faceFront: eyeBox ? eyeBox.max.x : headBox.max.x,
    eyeSpan: eyeBox ? eyeBox.max.z - eyeBox.min.z : headBox.max.z - headBox.min.z,
    torsoHalf: torso?.half ?? shoulderL.distanceTo(shoulderR) * 0.5,
    torsoDepth: torso?.depth ?? 0.24,
    shoulderHalf: shoulderL.distanceTo(shoulderR) * 0.5,
    neck,
    chest,
    hips,
    upperArmLen: shoulderL.distanceTo(elbowL),
    lowerArmLen: elbowL.distanceTo(handL),    upperLegLen: hipL.distanceTo(kneeL),
    lowerLegLen: kneeL.distanceTo(ankleL),
    foot: ankleL.clone().add(ankleR).multiplyScalar(0.5),
    torsoLen: hips.distanceTo(neck),
    hipWidth: hipL.distanceTo(hipR),
  };
}
