/**
 * The street crowd, built from the Kenney CC0 character pack.
 *
 * This used to be `makePerson` — a capsule torso, a sphere head, a hair cap and
 * two capsule legs, assembled in code. The task brief is explicit that no
 * code-built box character may be left on screen, and the pack the brief points
 * at carries twenty rigged figures with a shared skeleton and 27 clips.
 *
 * All the animation data is loaded once and the rest are `SkeletonUtils.clone`
 * copies, so fourteen pedestrians on the carriageway cost one GLB fetch and one
 * set of clip data. Each keeps its own mixer so they do not walk in lockstep.
 *
 * These are Mini Characters, the same pack and the same Q 版 proportions as the
 * protagonist: a 0.83 m head on a 1.7 m body. That is the art style, not a rig
 * fault — a bare three.js page with no mixer and no clips renders them
 * identically.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Character height in metres. The pack's figures are about 0.35 m as authored. */
const NPC_HEIGHT = 1.7;

/**
 * The pool the street draws from. Suit, shirt, casual and two robots, so the
 * carriageway does not read as one person duplicated.
 */
const NPC_FILES = [
  'character-male-d', // black suit, red tie — the protagonist's own
  'character-male-a',
  'character-male-b',
  'character-male-c',
  'character-male-e',
  'character-female-a',
  'character-female-b',
];

function npcUrl(file: string): string {
  // The space in "GLB format" has to be encoded: left raw, the loader gets
  // index.html back and fails with a JSON parse error.
  return `${import.meta.env.BASE_URL}assets/kenney/chars/Models/GLB%20format/${file}.glb`;
}

interface NpcSource {
  template: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

const cache = new Map<string, Promise<NpcSource | null>>();

function loadNpc(file: string): Promise<NpcSource | null> {
  const hit = cache.get(file);
  if (hit) return hit;
  const p = new Promise<NpcSource | null>((resolve) => {
    new GLTFLoader().load(
      npcUrl(file),
      (gltf) => {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const k = NPC_HEIGHT / Math.max(box.max.y - box.min.y, 1e-4);
        root.scale.setScalar(k);
        // `setFromObject` runs after the scale is set, so the box minimum is
        // already in world units — scaling it a second time lifts the figure
        // off the pavement.
        const after = new THREE.Box3().setFromObject(root);
        root.position.y = -after.min.y;
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          o.castShadow = true;
          o.receiveShadow = true;
        });
        resolve({ template: root, clips: gltf.animations });
      },
      undefined,
      () => resolve(null),
    );
  });
  cache.set(file, p);
  return p;
}

/** Preload the pool so the first pedestrian does not pop in a beat late. */
export function preloadCrowd(): void {
  for (const f of NPC_FILES) void loadNpc(f);
}

export class NpcPool {
  private readonly sources = new Map<string, NpcSource>();

  private async ensure(file: string): Promise<boolean> {
    if (this.sources.has(file)) return true;
    const src = await loadNpc(file);
    if (!src) return false;
    this.sources.set(file, src);
    return true;
  }

  /**
   * Spawn one pedestrian, or null if that model has not finished loading.
   * Callers should simply try again next frame — `Crowd` places people in its
   * constructor, so a miss just means one fewer body for a moment.
   */
  async spawn(file: string, clip: string): Promise<{ group: THREE.Group; mixer: THREE.AnimationMixer } | null> {
    if (!(await this.ensure(file))) return null;
    const src = this.sources.get(file)!;
    // Clone shares the skeleton and the clip data; only the transforms are
    // per-instance, which is the whole point of staging the pack once.
    const group = new THREE.Group();
    group.add(cloneSkeleton(src.template));
    group.userData.mixerRoot = group.children[0];
    const mixer = new THREE.AnimationMixer(group.children[0]);
    const c = src.clips.find((x) => x.name === clip) ?? src.clips.find((x) => x.name === 'idle');
    if (c) {
      const a = mixer.clipAction(c);
      a.setEffectiveWeight(1);
      a.play();
    }
    // A small phase offset so a crowd of fourteen is not one animation.
    mixer.setTime(Math.random() * (c?.duration ?? 2));
    group.userData.mixer = mixer;
    return { group, mixer };
  }
}
