/**
 * The shipped protagonist: a Quaternius "Ultimate Modular Men" body (CC0) with
 * our own face-adjacent identity layered on top — messy grey-black hair, thick
 * black glasses, an open lab coat, flip-flops. See `public/assets/CREDITS.md`.
 *
 * The GLB has a full skin rig but no animation clips, so instead of hunting for
 * a matching clip set we drive the bones with the same procedural pose math the
 * rest of the game already uses (`pose.ts`). That keeps walk / run / jump /
 * crouch / punch in one place and means the model is animated by exactly the
 * rules the gameplay tests already cover.
 *
 * The retarget is deliberately simple: each pose joint is a rotation about the
 * **character-space** Z axis, which is the left-right axis and therefore the one
 * that pitches a limb forward. Bones are re-parented math, not transforms, so
 * every bone gets
 *
 *     local = inverse(bindParentWorld) * Rz(rz) * bindWorld
 *
 * which keeps children inheriting their parent's motion instead of the whole
 * chain collapsing into one rigid pose.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { advancePhase, computePose, createPose, poseStateFrom, type JointName } from './pose';
import type { CharacterAnim, CharacterRig } from './buildCharacter';
import type { CharacterDef } from './types';
import { buildFlipflopThongs, buildGlasses, measure, type RigMetrics } from './glbOutfit';
import { dressGlbBody } from './glbBody';

/**
 * Pose joint -> bone in the GLB.
 *
 * Bone names have **no dots**: three's `PropertyBinding` strips `.` from glTF
 * node names on load, so the rig that ships as `UpperArm.L` in the .glb JSON
 * arrives in the scene graph as `UpperArmL`. Writing `UpperArm.L` here fails at
 * runtime with a bare "bone not found" and the character silently stays in its
 * bind pose, so keep the table and the runtime check below in sync.
 *
 * The coat tails are not bones; see `lab.root` in `glbOutfit`.
 */
const BONE: Partial<Record<JointName, string>> = {
  hips: 'Hips',
  head: 'Head',
  upperArmL: 'UpperArmL',
  lowerArmL: 'LowerArmL',
  upperArmR: 'UpperArmR',
  lowerArmR: 'LowerArmR',
  upperLegL: 'UpperLegL',
  lowerLegL: 'LowerLegL',
  upperLegR: 'UpperLegR',
  lowerLegR: 'LowerLegR',
  footL: 'FootL',
  footR: 'FootR',
};

/**
 * `pose.torso` is one joint but the rig has a three-bone spine. Splitting the
 * rotation down the chain is what stops a sprint from looking like the character
 * snapped forward at the waist.
 */
const SPINE_BONES = ['Abdomen', 'Torso', 'Chest'];
const SPINE_MIX = [0.28, 0.36, 0.36];

/** The forward pitch of the character, as a rotation about the Z axis. */
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * The pose is expressed in character space (+X forward, +Y up), but a bone's
 * local frame is the model's own — and the model is hung off a pivot rotated
 * 90 degrees to face +X. So a `Rz` written straight into a bone's local slot
 * is really a rotation about the character's X axis, which cannot swing a
 * hanging limb forward at all: it can only throw it out to the side. Measured,
 * every punch amplitude left the arm's forward dot product at zero.
 *
 * P carries a character-space rotation into the bind frame the bone maths is
 * written in, so the sandwich below leaves the joint rotation untouched when
 * `rz` is 0 and lands it on the character axis when it is not.
 */
const PIVOT = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI / 2,
);
const PIVOT_INV = PIVOT.clone().invert();

export const PROTAGONIST_URL = `${import.meta.env.BASE_URL}assets/characters/protagonist.glb`;

interface BoneBinding {
  bone: THREE.Bone;
  /** Which pose joint drives this bone. */
  joint: JointName;
  /** How much of that joint's rotation this bone takes (spine splits its share). */
  mix: number;
  /** inverse(bind-pose world rotation of the parent) */
  invParent: THREE.Quaternion;
  /** bind-pose world rotation */
  bindWorld: THREE.Quaternion;
  /**
   * Rotation from the model's rest pose into the convention `pose.ts` assumes
   * (limbs hanging down). The Quaternius bind pose is a T-pose, so without this
   * the arms stay stuck straight out no matter what the walk cycle says.
   */
  rest: THREE.Quaternion;
  /** bind-pose local position */
  bindPos: THREE.Vector3;
  /** 1 / model scale, so a metre of `dy` survives the root scale */
  invScale: number;
}


/**
 * Torso half-width and front-back depth, taken from the vertices of the body
 * mesh that sit within a band around chest height. Skinned meshes are measured
 * from their bind-pose geometry, which is exactly the T-pose we want to size
 * clothing against — a garment has to clear the arms when they are out.
 */
function measureTorso(body: THREE.Object3D, chestY: number, waistY: number): { half: number; depth: number } {
  // The bind pose is a T-pose with the arms out, and on this model they go
  // out along X. That makes the two axes behave differently at the two heights
  // we care about, and reading them the wrong way round is what made the coat
  // disappear:
  //   - at chest height X spans the full 1.3 m arm reach, but Z is torso only
  //   - at waist height both axes are torso, arms are nowhere near
  // So: width from the chest's Z span, depth from the waist's X span.
  const BAND = 0.08;
  const v = new THREE.Vector3();
  body.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  body.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry.getAttribute('position')) meshes.push(mesh);
  });

  const spanAt = (centerY: number, axis: 0 | 1 | 2): { lo: number; hi: number } => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.y - centerY) > BAND) continue;
        const c = axis === 0 ? v.x : axis === 1 ? v.y : v.z;
        if (c < lo) lo = c;
        if (c > hi) hi = c;
      }
    }
    return { lo, hi };
  };

  const chestZ = spanAt(chestY, 2);
  if (!Number.isFinite(chestZ.lo)) return { half: 0.13, depth: 0.3 };

  // Front-to-back depth, from the strip of torso that runs down the middle.
  // The arms go out along X, so any band that includes them reports the full
  // 1.3 m reach; a narrow |z| window keeps only the ribcage.
  let xLo = Infinity;
  let xHi = -Infinity;
  const v2 = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v2.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(v2.y - chestY) > 0.1) continue;
      if (Math.abs(v2.z) > 0.085) continue;
      if (v2.x < xLo) xLo = v2.x;
      if (v2.x > xHi) xHi = v2.x;
    }
  }
  void waistY;
  return {
    half: Math.max((chestZ.hi - chestZ.lo) / 2, 0.08),
    depth: Math.max(Number.isFinite(xLo) ? xHi - xLo : 0.3, 0.1),
  };
}

/**
 * Drop a piece built **in bone-local space** onto that bone.
 *
 * `buildGlasses` and `buildFlipflopThongs` both position themselves in metres
 * relative to the bone they ride on (`eye - head`, and around the foot origin).
 * Two things then have to be undone, and getting either wrong was a bug:
 *
 *  1. **Position.** The pieces are already bone-relative, so the bone's world
 *     position must not be added. Doing so parked the glasses 1.5 m above the
 *     head, visible in the scene as two pale lenses floating in the sky.
 *  2. **Scale.** The export hangs everything off a `CharacterArmature` node
 *     with scale 100, so a child of any bone inherits it. A 10 cm offset read
 *     as 10 m, and the frames rendered as metre-wide bars. `attach()` would
 *     have absorbed this, but `attach()` also reinterprets the piece's
 *     coordinates as world positions and throws it to the map origin, so the
 *     conversion is done by hand instead.
 */
function attachLocal(bone: THREE.Object3D, node: THREE.Object3D): void {
  bone.updateWorldMatrix(true, false);
  const s = bone.getWorldScale(new THREE.Vector3());
  const k = (v: number, axis: number): number => (s.getComponent(axis) > 1e-6 ? v / s.getComponent(axis) : v);
  node.position.set(k(node.position.x, 0), k(node.position.y, 1), k(node.position.z, 2));
  node.scale.multiply(new THREE.Vector3(k(1, 0), k(1, 1), k(1, 2)));
  bone.add(node);
  node.updateMatrix();
}

/**
 * Shortest rotation taking `dir` onto straight down. Used to fold a T-posed
 * arm into the hanging-arm convention the pose solver was written against.
 */
function restToDown(dir: THREE.Vector3): THREE.Quaternion {
  const d = dir.clone().normalize();
  const target = new THREE.Vector3(0, -1, 0);
  // A zero-length direction means a bone name did not resolve. Identity is
  // wrong but harmless; a NaN quaternion would poison the whole chain.
  if (d.lengthSq() < 1e-12) return new THREE.Quaternion();
  const axis = new THREE.Vector3().crossVectors(d, target);
  const len = axis.length();
  if (len < 1e-6) {
    // Already parallel or anti-parallel to down; the quaternion below is either
    // the identity or a 180 degree flip, both of which `setFromUnitVectors`
    // handles better than an empty cross product.
    return new THREE.Quaternion().setFromUnitVectors(d, target);
  }
  axis.divideScalar(len);
  const angle = Math.acos(THREE.MathUtils.clamp(d.dot(target), -1, 1));
  return new THREE.Quaternion().setFromAxisAngle(axis, angle);
}

/**
 * Build the character. Returns immediately with an empty group and fills it in
 * once the GLB arrives; the game loop can call `update` from the first frame.
 */
export function createGlbCharacterRig(
  def: CharacterDef,
  url: string = PROTAGONIST_URL,
  onReady?: (rig: CharacterRig) => void,
): CharacterRig {
  const group = new THREE.Group();
  group.name = `character:${def.id}`;

  const limbs: Record<string, THREE.Object3D> = {};
  const bindings: BoneBinding[] = [];
  const headMeshes: THREE.Object3D[] = [];
  let glassesRig: THREE.Object3D | null = null;
  let metrics: RigMetrics | null = null;
  let phase = 0;
  const pose = createPose();

  const rz = new THREE.Quaternion();
  const axisSpin = new THREE.Quaternion();
  const spin = new THREE.Quaternion();

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
        punch: anim?.punch ?? 0,
      },
      pose,
    );

    for (const b of bindings) {
      const j = pose[b.joint as JointName];
      if (!j) continue;
      rz.setFromAxisAngle(Z_AXIS, b.mix * j.rz);
      // Character space -> bind frame -> back, so a +Z pose rotation lands on
      // the character's Z axis rather than the model's.
      axisSpin.copy(PIVOT).multiply(rz).multiply(PIVOT_INV);
      spin.copy(b.invParent).multiply(axisSpin).multiply(b.rest).multiply(b.bindWorld);
      b.bone.quaternion.copy(spin);
      b.bone.position.y = b.bindPos.y + j.dy * b.invScale;
    }

    // Coat tails are plain groups in character space, so they take the pose
    // rotation directly — same convention as the procedural character.
    if (metrics) {
      for (const name of ['coatTailL', 'coatTailR', 'coatTailB'] as const) {
        const node = limbs[name];
        const j = pose[name as JointName];
        if (!node || !j) continue;
        node.rotation.set(j.rx, j.ry, j.rz);
      }
      // The hem follows the hips vertically without inheriting their rotation,
      // so swinging legs do not drag the whole coat around.
      const coatRoot = limbs.coatRoot;
      if (coatRoot) {
        coatRoot.position.y = metrics.hips.y - metrics.upperLegLen * 0.28 + (pose.hips.dy ?? 0);
      }
    }
  };

  const rig: CharacterRig = {
    group,
    limbs,
    update,
    setHeadVisible: (visible: boolean) => {
      for (const m of headMeshes) m.visible = visible;
      if (glassesRig) glassesRig.visible = visible;
    },
  };
  limbs.coatRoot = new THREE.Group();
  limbs.coatRoot.name = 'coatRoot';

  new GLTFLoader().load(
    url,
    (gltf) => {
      const model = gltf.scene;

      // The GLB is authored at ~1.86 m with feet below the origin. Normalize to
      // the height in the def and stand it on y = 0 so the collision capsule
      // in `Player` lines up.
      model.updateMatrixWorld(true);
      const raw = new THREE.Box3().setFromObject(model);
      const rawH = raw.max.y - raw.min.y;
      const k = def.body.height / rawH;
      const pivot = new THREE.Group();
      pivot.name = 'glbPivot';
      pivot.rotation.y = Math.PI / 2; // model faces +Z, the game wants +X
      pivot.add(model);
      model.scale.setScalar(k);
      model.position.y = -raw.min.y * k;
      group.add(pivot);
      group.updateMatrixWorld(true);

      // Outfit silhouette is applied further down, once the measurements below
      // exist — see `glbBody.ts` for why the model's own meshes are cut rather
      // than covered with a coat built on top of it.

      const byName = new Map<string, THREE.Object3D>();
      model.traverse((obj) => {
        if (obj.name) byName.set(obj.name, obj);
      });
      const missing: string[] = [];
      const bone = (name: string): THREE.Object3D => {
        const b = byName.get(name);
        if (!b) {
          missing.push(name);
          return new THREE.Object3D();
        }
        return b;
      };
      // Resolve every bone the rig needs up front. A missing one used to throw
      // from inside the loader callback, which left a naked T-posed model on
      // screen with no coat and no animation and no error anyone would see.
      for (const name of [
        'Head', 'Neck', 'Chest', 'Hips', ...SPINE_BONES,
        'ShoulderL', 'ShoulderR', 'UpperArmL', 'UpperArmR',
        'LowerArmL', 'LowerArmR', 'HandL', 'HandR',
        'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR',
      ]) bone(name);
      if (missing.length) {
        console.warn(
          `[characters] ${url} is missing bones: ${[...new Set(missing)].join(', ')}`,
        );
        return;
      }

      // Head mesh bounds drive where the glasses sit. Measure before the coat
      // is attached so the coat cannot inflate the box.
      const bodyMesh = byName.get('Suit_Body') ?? model;
      const headMesh = byName.get('Suit_Head') ?? model;
      const headBox = new THREE.Box3().setFromObject(headMesh);
      // The head mesh is split into one child mesh per material, so the eyes
      // are addressable on their own. Use them to place the frames.
      let eyeBox: THREE.Box3 | null = null;
      headMesh.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const name = (mesh.material as THREE.Material).name;
        if (name !== 'Eye') return;
        const b = new THREE.Box3().setFromObject(mesh);
        eyeBox = eyeBox ? eyeBox.union(b) : b;
      });
      // Torso width/depth at chest height, read straight off the body mesh.
      // The bind pose is a T-pose, so a whole-mesh bounding box would measure
      // the arms; slice a band at chest height instead.
      // Width comes from the waist, not the chest. The bind pose is a T-pose,
      // so a chest-height band also contains the outstretched arms — measuring
      // the torso there returned the full arm span (~1 m) and blew the coat up
      // to twice the size of the character. The waist band is torso only.
      const waistY = bone('Hips').getWorldPosition(new THREE.Vector3()).y + 0.15;
      const chestY = bone('Chest').getWorldPosition(new THREE.Vector3()).y - 0.05;
      const torso = measureTorso(bodyMesh, chestY, waistY);
      const m = measure(bone, headBox, eyeBox, torso);
      metrics = m;

      // Cut the model into the character it is supposed to be. This runs after
      // `measure` because opening the coat needs the hip and neck heights, and
      // before the glasses are placed so nothing measures the new geometry.
      dressGlbBody(model, def, m);


      // Remember the head's own meshes: the skinning output ignores the bone's
      // `visible` flag, so first-person has to hide these directly.
      headMesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) headMeshes.push(obj);
      });

      // ── Glasses ────────────────────────────────────────────────────────
      const glasses = buildGlasses(m, def);
      attachLocal(bone('Head'), glasses);
      limbs.glasses = glasses;
      glassesRig = glasses;

      // ── Flip-flops ─────────────────────────────────────────────────────
      const thong = buildFlipflopThongs(def);
      if (thong) {
        attachLocal(bone('FootL'), thong);
        attachLocal(bone('FootR'), thong.clone());
      }

      // ── Bone bindings ──────────────────────────────────────────────────
      group.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      /** Bone direction in character space, taken toward the given child bone. */
      const dirTo = (from: string, to: string): THREE.Vector3 =>
        bone(to).getWorldPosition(new THREE.Vector3())
          .sub(bone(from).getWorldPosition(wp))
          .normalize();

      const bind = (joint: JointName, boneName: string, mix: number, restDir?: THREE.Vector3): void => {
        const b = bone(boneName);
        const parent = b.parent as THREE.Object3D | null;
        const invParent = new THREE.Quaternion();
        // Metres per unit of the bone's own local space. This has to come from
        // the live matrix: the exported rig carries its own scale (Blender puts
        // 1/100-scale exports on a `CharacterArmature` node with scale 100), so
        // dividing by our own root scale alone inflates a 12 mm idle breath into
        // over a metre and stretches the spine apart.
        const parentScaleY = parent ? parent.getWorldScale(new THREE.Vector3()).y : 1;
        if (parent) invParent.copy(parent.getWorldQuaternion(new THREE.Quaternion())).invert();
        bindings.push({
          bone: b as THREE.Bone,
          joint,
          mix,
          invParent,
          bindWorld: b.getWorldQuaternion(new THREE.Quaternion()),
          rest: restDir ? restToDown(restDir) : new THREE.Quaternion(),
          bindPos: b.position.clone(),
          invScale: parentScaleY > 1e-6 ? 1 / parentScaleY : 1,
        });
        limbs[joint] = b;
      };

      // Arms need folding out of the T-pose; the legs and spine already hang.
      // The lower arm gets no `rest` of its own: the upper arm already carries
      // the fold, and a second world-space rotation would bend the elbow twice.
      // The arms take the opposite sign to the legs. The legs already hang
      // down in the bind pose, so a +Z rotation carries them forward. The arms
      // do not: `restToDown` folds them out of the T-pose along the shortest
      // arc, which lands on the other handedness, and +Z then throws them
      // backwards. Measured at the punch peak, `dir(UpperArmR->HandR)` was
      // (-0.97, 0.23, 0.00) — a clean forward swing at exactly 180 degrees
      // out. Negating the arm joints fixes that without disturbing the spine
      // or the legs, which a global sign flip does not.
      for (const side of ['L', 'R'] as const) {
        const upper = `UpperArm${side}`;
        bind(`upperArm${side}` as JointName, upper, -1, dirTo(upper, `Hand${side}`));
        bind(`lowerArm${side}` as JointName, `LowerArm${side}`, -1);
      }
      for (const [joint, boneName] of Object.entries(BONE)) {
        if (boneName && !joint.startsWith('upperArm') && !joint.startsWith('lowerArm')) {
          bind(joint as JointName, boneName, 1);
        }
      }
      // Distribute the spine rotation. `hips` keeps its own translation.
      SPINE_BONES.forEach((boneName, i) => {
        bind('torso', boneName, SPINE_MIX[i]);
      });

      onReady?.(rig);
    },
    undefined,
    (err) => {
      // A missing model must not take the game down with it: the caller keeps
      // whatever it already had on screen.
      console.warn('[characters] could not load', url, err);
    },
  );

  return rig;
}
