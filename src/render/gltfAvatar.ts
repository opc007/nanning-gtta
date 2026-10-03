/**
 * Protagonist skin: the CC0 KayKit rogue (real skeleton + clips), recolored and
 * dressed from `CharacterDef`. Weapons and the cape stay in the file so the
 * rig is intact, but they are hidden. Glasses and the open lab coat are meshes
 * parented to the bones, so idle / walk / run / jump / punch / sit are the
 * clip, not a procedural box cycle.
 *
 * GLTFLoader strips dots from node names (`upperarm.l` → `upperarml`) because
 * `.` is reserved in animation paths. Bone lookups try both forms.
 *
 * `?skin=procedural` keeps `buildCharacter`. This loader is the default.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CharacterDef } from '../characters/types';
import type { CharacterAnim, CharacterRig } from '../characters/buildCharacter';
import { assetUrl, styledMesh, toonGradientSoft, toonMat } from './toon';

export interface StyledRig extends CharacterRig {
  /** `run` | `sit` | `walk` holds a mid-cycle pose for screenshots. */
  force: string | null;
  readonly ready: true;
}

const CLIP: Record<string, { name: string; once?: boolean }> = {
  idle: { name: 'Unarmed_Idle' },
  walk: { name: 'Walking_A' },
  jog: { name: 'Running_A' },
  sprint: { name: 'Running_A' },
  crouch: { name: 'Idle' },
  crouchWalk: { name: 'Walking_A' },
  jump: { name: 'Jump_Start', once: true },
  fall: { name: 'Jump_Idle' },
  land: { name: 'Jump_Land', once: true },
  punch: { name: 'Unarmed_Melee_Attack_Punch_A', once: true },
  sit: { name: 'Sit_Chair_Idle' },
  eat: { name: 'Sit_Chair_Idle' },
};

/** Skinned body parts. Everything else in the file is a weapon, a cape, or a helper. */
const BODY = new Set([
  'Rogue_ArmLeft',
  'Rogue_ArmRight',
  'Rogue_Body',
  'Rogue_Head',
  'Rogue_LegLeft',
  'Rogue_LegRight',
]);

function capsuleAlongY(radius: number, boneLen: number): THREE.BufferGeometry {
  const length = Math.max(0.02, boneLen - radius * 2);
  const g = new THREE.CapsuleGeometry(radius, length, 4, 10);
  g.translate(0, boneLen / 2, 0);
  return g;
}

function rounded(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const radius = Math.max(0.004, Math.min(w, h, d) * 0.28);
  const g = new RoundedBoxGeometry(w, h, d, 2, radius);
  g.translate(x, y, z);
  return g;
}

function boneOf(model: THREE.Object3D, name: string): THREE.Object3D | undefined {
  const sanitized = THREE.PropertyBinding.sanitizeNodeName(name);
  return model.getObjectByName(name) ?? model.getObjectByName(sanitized) ?? undefined;
}

function childLength(bone: THREE.Object3D, prefix: string): number {
  const child = bone.children.find((c) => c.name.replace(/\./g, '').startsWith(prefix));
  return child ? Math.max(0.05, child.position.length()) : 0.22;
}

/** Bind-pose geometry of `mesh`, expressed in `bone` local space. */
function boundsInBone(bone: THREE.Object3D, mesh: THREE.Mesh): THREE.Box3 {
  bone.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
  const pos = mesh.geometry.getAttribute('position');
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  if (!pos) return box;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
    box.expandByPoint(v);
  }
  return box;
}

/**
 * Greens in the rogue atlas are the tunic and trousers. Pull them toward the
 * reference grey and push dark warm leather/hair toward charcoal, leaving the
 * peach face islands alone.
 */
function recolorAtlas(src: THREE.Texture): THREE.Texture {
  const img = src.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!img || !w || !h) return src;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return src;
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, w, h);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      if (g > r * 1.04 && g > b * 1.04 && g > 36) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const t = 0.8;
        px[i] = Math.round(r * (1 - t) + l * t);
        px[i + 1] = Math.round(g * (1 - t) + l * t);
        px[i + 2] = Math.round(b * (1 - t) + l * t);
      } else if (r > 55 && r < 175 && g < 100 && r > g && r - b > 18) {
        const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const target = 36 + l * 42;
        const t = 0.7;
        px[i] = Math.round(r * (1 - t) + target * t);
        px[i + 1] = Math.round(g * (1 - t) + target * t);
        px[i + 2] = Math.round(b * (1 - t) + (target + 5) * t);
      }
    }
    ctx.putImageData(image, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = src.colorSpace;
    tex.flipY = src.flipY;
    tex.wrapS = src.wrapS;
    tex.wrapT = src.wrapT;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return src;
  }
}

export function loadStyledAvatar(def: CharacterDef, force: string | null): Promise<StyledRig> {
  const loader = new GLTFLoader();
  return loader.loadAsync(assetUrl('assets/characters/protagonist.glb')).then((gltf) => dress(def, gltf, force));
}

function dress(
  def: CharacterDef,
  gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] },
  force: string | null,
): StyledRig {
  const model = gltf.scene;
  let sharedMap: THREE.Texture | null = null;
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const keep = BODY.has(obj.name);
    mesh.visible = keep;
    mesh.castShadow = keep;
    mesh.receiveShadow = keep;
    mesh.frustumCulled = false;
    if (!keep) return;
    const prev = mesh.material as THREE.MeshStandardMaterial;
    if (!sharedMap && prev && prev.map) sharedMap = recolorAtlas(prev.map);
  });
  if (sharedMap) {
    const bodyMat = new THREE.MeshToonMaterial({
      map: sharedMap,
      color: 0xffffff,
      gradientMap: toonGradientSoft(),
    });
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.visible) mesh.material = bodyMat;
    });
  }

  const bone = (name: string): THREE.Object3D | undefined => boneOf(model, name);
  const coatC = def.outerwear?.color ?? 0xf3f1ec;
  const coat = toonMat(coatC);
  const coatIn = toonMat(new THREE.Color(coatC).multiplyScalar(0.86).getHex());
  const dark = toonMat(0x141414);
  const penBlue = toonMat(0x1d4e89);
  const penRed = toonMat(0x9b2335);
  const book = toonMat(0xc4b49a);

  const add = (parent: THREE.Object3D | undefined, geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0.01): void => {
    if (!parent) return;
    const mesh = styledMesh(geo, mat, outline);
    mesh.frustumCulled = false;
    parent.add(mesh);
  };

  const chest = bone('chest');
  if (chest && def.outerwear?.style === 'labcoat') {
    // Rest-pose torso of this rig is about 0.87 wide and sticks out to z ≈ 0.37.
    // The shell sits just outside that so it reads as a coat, not pads glued on.
    const coatY = -0.18;
    const coatH = 0.9;
    const frontZ = 0.42;
    const backZ = -0.4;
    const thick = 0.04;
    const half = 0.52;
    add(chest, rounded(half * 2.05, coatH, thick, 0, coatY, backZ), coat, 0.01);
    add(chest, rounded(thick, coatH * 0.94, 0.72, half, coatY, -0.02), coat, 0.008);
    add(chest, rounded(thick, coatH * 0.94, 0.72, -half, coatY, -0.02), coat, 0.008);
    // Open fronts. The gap is narrow enough to read as a lapel, wide enough to show the tunic.
    add(chest, rounded(0.34, coatH * 0.97, thick, 0.26, coatY, frontZ), coat, 0.008);
    add(chest, rounded(0.34, coatH * 0.97, thick, -0.26, coatY, frontZ), coat, 0.008);
    add(chest, rounded(0.16, 0.16, 0.06, 0.16, coatY + coatH * 0.5, frontZ - 0.02), coat, 0);
    add(chest, rounded(0.16, 0.16, 0.06, -0.16, coatY + coatH * 0.5, frontZ - 0.02), coat, 0);
    add(chest, rounded(0.025, coatH * 0.88, 0.025, 0.1, coatY, frontZ - 0.02), coatIn, 0);
    add(chest, rounded(0.025, coatH * 0.88, 0.025, -0.1, coatY, frontZ - 0.02), coatIn, 0);
    if (def.outerwear.pocketPens) {
      add(chest, rounded(0.11, 0.09, 0.03, 0.3, coatY + 0.12, frontZ + 0.03), coat, 0);
      add(chest, rounded(0.016, 0.13, 0.016, 0.26, coatY + 0.22, frontZ + 0.05), penBlue, 0);
      add(chest, rounded(0.016, 0.11, 0.016, 0.3, coatY + 0.2, frontZ + 0.05), dark, 0);
      add(chest, rounded(0.016, 0.14, 0.016, 0.34, coatY + 0.22, frontZ + 0.05), penRed, 0);
    }
    if (def.outerwear.sideNotebook) {
      add(chest, rounded(0.09, 0.13, 0.035, -0.46, coatY + 0.02, 0.12), coat, 0);
      add(chest, rounded(0.065, 0.1, 0.02, -0.46, coatY + 0.03, 0.15), book, 0);
    }
  }

  // Sleeves are larger than the arm mesh (rest-pose radius ~0.16 / ~0.14) so the coat covers it.
  for (const side of ['l', 'r'] as const) {
    const upper = bone(`upperarm.${side}`);
    const lower = bone(`lowerarm.${side}`);
    if (upper) add(upper, capsuleAlongY(0.185, childLength(upper, 'lowerarm') * 0.98), coat, 0.01);
    if (lower) add(lower, capsuleAlongY(0.155, childLength(lower, 'wrist') * 0.78), coat, 0.008);
  }

  const head = bone('head');
  const headMesh = model.getObjectByName('Rogue_Head') as THREE.Mesh | undefined;
  if (head && def.glasses?.style === 'thick-rect') {
    const hb = headMesh ? boundsInBone(head, headMesh) : new THREE.Box3(new THREE.Vector3(-0.1, 0, -0.1), new THREE.Vector3(0.1, 0.25, 0.12));
    const hs = hb.getSize(new THREE.Vector3());
    const hc = hb.getCenter(new THREE.Vector3());
    const sane = hs.x > 0.08 && hs.x < 0.8 && hs.y > 0.08;
    const faceZ = sane ? hb.max.z + 0.02 : 0.14;
    const eyeY = sane ? hc.y + hs.y * 0.04 : 0.14;
    const spread = 0.085;
    const fw = 0.13;
    const fh = 0.078;
    const t = 0.02;
    const frame = toonMat(def.glasses.color);
    const bar = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
      add(head, rounded(w, h, d, x, y, z), frame, 0);
    };
    for (const sx of [-1, 1]) {
      const cx = sx * spread;
      bar(fw, t, t, cx, eyeY + fh / 2, faceZ);
      bar(fw, t, t, cx, eyeY - fh / 2, faceZ);
      bar(t, fh, t, cx - fw / 2, eyeY, faceZ);
      bar(t, fh, t, cx + fw / 2, eyeY, faceZ);
      const lens = new THREE.PlaneGeometry(fw - t, fh - t);
      lens.translate(cx, eyeY, faceZ - 0.004);
      const lensMesh = new THREE.Mesh(lens, new THREE.MeshBasicMaterial({
        color: 0xb7c9d4,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }));
      lensMesh.castShadow = false;
      lensMesh.frustumCulled = false;
      head.add(lensMesh);
    }
    bar(spread * 0.55, t * 0.7, t * 0.7, 0, eyeY + fh * 0.15, faceZ);
    const templeLen = sane ? Math.min(0.28, hs.z * 0.35) : 0.18;
    bar(t * 0.8, t * 0.7, templeLen, spread + fw / 2, eyeY + fh * 0.15, faceZ - templeLen / 2);
    bar(t * 0.8, t * 0.7, templeLen, -(spread + fw / 2), eyeY + fh * 0.15, faceZ - templeLen / 2);
  }

  // KayKit faces +Z. The game faces +X at heading 0, so yaw the rig -90°.
  const pivot = new THREE.Group();
  pivot.name = 'styled-pivot';
  pivot.rotation.y = -Math.PI / 2;
  pivot.add(model);

  const group = new THREE.Group();
  group.name = `character:${def.id}`;
  group.add(pivot);

  const fitBox = (): THREE.Box3 => {
    pivot.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    pivot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mesh.isMesh && mesh.visible && mat && !mat.transparent) bounds.expandByObject(mesh);
    });
    return bounds;
  };
  const height = Math.max(0.4, fitBox().max.y - fitBox().min.y);
  const scale = def.body.height / height;
  pivot.scale.setScalar(scale);
  const grounded = fitBox();
  pivot.position.y -= grounded.min.y;
  const footY = pivot.position.y;

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    actions.set(clip.name, mixer.clipAction(clip));
  }
  let current = 'Unarmed_Idle';
  const idle = actions.get('Unarmed_Idle') ?? actions.get('Idle');
  idle?.play();
  let held = false;

  const hips = bone('hips');
  const hipsBindY = hips?.position.y ?? 0;

  const limbs: Record<string, THREE.Object3D> = {};
  if (head) limbs.head = head;
  if (hips) limbs.hips = hips;
  if (chest) limbs.torso = chest;

  const rig: StyledRig = {
    group,
    limbs,
    force,
    ready: true,
    update(speed: number, dt: number, anim?: CharacterAnim): void {
      const raw = this.force ?? anim?.state ?? (speed > 0.25 ? 'jog' : 'idle');
      let key = raw;
      if (raw === 'air') key = (anim?.vy ?? 0) > 0.4 ? 'jump' : 'fall';
      if (raw === 'run') key = 'sprint';
      const spec = CLIP[key] ?? CLIP.idle;
      const action = actions.get(spec.name) ?? idle;
      if (action && spec.name !== current) {
        action.reset();
        action.setLoop(spec.once ? THREE.LoopOnce : THREE.LoopRepeat, spec.once ? 1 : Infinity);
        action.clampWhenFinished = !!spec.once;
        action.fadeIn(0.18).play();
        actions.get(current)?.fadeOut(0.18);
        current = spec.name;
        held = false;
      }
      if (action) {
        if (this.force === 'run' || this.force === 'sit' || this.force === 'walk') {
          action.timeScale = 0;
          if (!held) {
            const dur = action.getClip().duration;
            action.time = this.force === 'sit' ? dur * 0.55 : dur * 0.38;
            held = true;
          }
        } else if (key === 'sprint') action.timeScale = 1.15;
        else if (key === 'jog') action.timeScale = 0.9;
        else if (key === 'walk' || key === 'crouchWalk') action.timeScale = Math.max(0.55, Math.min(1.4, speed / 1.6));
        else action.timeScale = 1;
      }
      mixer.update(dt);
      const crouch = key === 'crouch' || key === 'crouchWalk';
      if (hips && crouch) hips.position.y = hipsBindY - 0.16;
      // Sit_Chair_Idle plants the hips a little under these stool seats. Nudge up so the butt meets the seat.
      pivot.position.y = this.force === 'sit' ? footY + 0.08 : footY;
    },
  };
  return rig;
}
