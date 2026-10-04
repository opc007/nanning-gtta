/**
 * The protagonist, driven by the clips that ship inside the model.
 *
 * The previous protagonist was a Quaternius "Ultimate Modular Men" Suit body
 * animated by our own joint solver in `pose.ts`. Two things made that a bad
 * base: the model is a business suit, so every outfit layer had to be cut out
 * of it by hand (`glbBody.ts`), and its bind pose plus a 90-degree pivot meant
 * a pose-space rotation landed on the wrong axis — the arm could not swing
 * forward at any amplitude, which is a long story told in the PR.
 *
 * The Kenney Mini Characters pack is CC0, ships the character as a
 * black-suited figure, and — the part that matters — carries 32 clips authored
 * for exactly these states. So there is no pose solver to get wrong: the rig
 * picks a clip, cross-fades, and plays. Height above the floor stays the
 * game's business, since the clips are all in place.
 *
 * `character-male-d` has two skins (body and head), so the face can be hidden
 * for the first-person camera without touching the body.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAnim, CharacterRig } from './buildCharacter';
import type { CharacterDef } from './types';

export const PROTAGONIST_URL = `${import.meta.env.BASE_URL}assets/kenney/chars/Models/GLB format/character-male-d.glb`;

/** How long a cross-fade between clips takes, seconds. */
const FADE = 0.18;

/**
 * Game state -> clip name.
 *
 * The attack and pick-up clips are one-shot: they are driven by a progress
 * value rather than the locomotion state, so a punch while walking does not
 * knock the gait off.
 */
type OneShot = 'attack-melee-right' | 'attack-melee-left' | 'pick-up';

const LOCOMOTION = ['idle', 'walk', 'sprint', 'jump', 'fall', 'sit', 'drive', 'die', 'crouch'] as const;

export interface ClipCharacter extends CharacterRig {
  /** Cross-fade to a clip immediately, ignoring the locomotion mapping. */
  play(name: string, fade?: number): void;
  /** 0..1 through the current one-shot clip, for a deterministic capture. */
  setOneShot(name: OneShot | null, progress: number): void;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  setHeadVisible(visible: boolean): void;
}

function pickLocomotion(anim?: CharacterAnim): string {
  const state = anim?.state ?? 'idle';
  if (LOCOMOTION.includes(state as (typeof LOCOMOTION)[number])) return state;
  if (state === 'air') return (anim?.vy ?? 0) > 0.4 ? 'jump' : 'fall';
  if (state === 'walk') return 'walk';
  if (state === 'jog' || state === 'sprint') return 'sprint';
  if (state === 'crouchWalk') return 'crouch';
  if (state === 'eat' || state === 'carry') return 'sit';
  return 'idle';
}

export function createClipCharacter(
  def: CharacterDef,
  url: string = PROTAGONIST_URL,
  onReady?: (rig: ClipCharacter) => void,
): ClipCharacter {
  const group = new THREE.Group();
  group.name = `character:${def.id}`;
  const limbs: Record<string, THREE.Object3D> = {};
  const headMeshes: THREE.Object3D[] = [];

  let mixer: THREE.AnimationMixer | null = null;
  let actions = new Map<string, THREE.AnimationAction>();
  let clips = new Map<string, THREE.AnimationClip>();
  let current = '';
  let oneShot: OneShot | null = null;
  let oneShotT = 0;
  let oneShotLen = 1;

  const ensureAnimation = (root: THREE.Object3D, source: THREE.AnimationClip[]): void => {
    if (mixer) return;
    mixer = new THREE.AnimationMixer(root);
    clips = new Map<string, THREE.AnimationClip>();
    for (const clip of source) clips.set(clip.name, clip);
    actions = new Map<string, THREE.AnimationAction>();
    for (const [name, clip] of clips) {
      const a = mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      actions.set(name, a);
    }
    if (!clips.has('idle') && clips.size) {
      // Nothing to fall back to would leave the character in its bind pose,
      // which on this model is a wide T.
      const first = clips.values().next().value as THREE.AnimationClip;
      clips.set('idle', first);
      const a = mixer.clipAction(first);
      a.enabled = true;
      a.setEffectiveWeight(1);
      a.play();
      actions.set('idle', a);
    }
  };

  const crossFadeTo = (name: string, fade: number): void => {
    if (!mixer || !actions.has(name)) return;
    const next = actions.get(name)!;
    // The first clip has to be started outright. Cross-fading into it from
    // the all-zero-weight state every action is created in leaves the whole
    // body at the bind pose, which on this model is a forward hunch rather
    // than anything the clips ever produce.
    if (name === current) {
      next.setEffectiveWeight(1);
      return;
    }
    const prev = current ? actions.get(current) : undefined;
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    else for (const a of actions.values()) if (a !== next) a.setEffectiveWeight(0);
    current = name;
  };

  // `speed` is not used to retime the clips: the pack has separate `walk` and
  // `sprint` clips, so playback picks the clip instead of speeding one up.
  const update = (_speed: number, dt: number, anim?: CharacterAnim): void => {
    if (!mixer) return;
    const d = Math.min(dt, 0.05);
    if (oneShot) {
      oneShotT += d;
      if (oneShotT >= oneShotLen) {
        oneShot = null;
        oneShotT = 0;
      }
    } else {
      // The clips are authored at their own pace; scaling by speed keeps the
      // stride length from stretching out at a sprint, which is the usual
      // giveaway that a walk cycle is a single clip being sped up.
      crossFadeTo(pickLocomotion(anim), FADE);
    }
    mixer.update(d);
  };

  const rig: ClipCharacter = {
    group,
    limbs,
    mixer: null as unknown as THREE.AnimationMixer,
    clips,
    update,
    play: (name: string, fade = FADE) => crossFadeTo(name, fade),
    setOneShot: (name: OneShot | null, progress: number) => {
      if (!mixer) return;
      if (!name) {
        oneShot = null;
        return;
      }
      if (oneShot !== name) {
        oneShot = name;
        oneShotT = 0;
        const a = actions.get(name);
        oneShotLen = a ? Math.max(a.getClip().duration, 0.2) : 1;
        crossFadeTo(name, 0.05);
      }
      const a = actions.get(name);
      if (a) a.time = Math.max(0, Math.min(1, progress)) * oneShotLen;
    },
    setHeadVisible: (visible: boolean) => {
      for (const m of headMeshes) m.visible = visible;
    },
  };

  new GLTFLoader().load(
    url,
    (gltf) => {
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      // x2.2 puts the figure at 1.59 m, measured off the skinned meshes'
      // world bounds, so 2.36 lands it on the 1.7 m the def asks for.
      //
      // Measure the meshes, not the bones. The topmost bone here is the neck —
      // the head is a separate skinned mesh that reaches 0.23 m higher — so a
      // bone-only measurement reads 0.76 m at x2.2 and says x4.9 gives 1.68 m.
      // It does not: x4.9 puts the character at 3.5 m, which is what made it
      // look enormous.
      const k = 2.36;
      model.scale.setScalar(k);
      // `setFromObject` runs *after* the scale is set, so `box.min.y` is
      // already in world units. Scaling it a second time lifted the figure off
      // the ground.
      const box = new THREE.Box3().setFromObject(model);
      model.position.y = -box.min.y;
      model.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
        if ((o as THREE.Mesh).isMesh && /head/i.test(o.name)) headMeshes.push(o);
      });
      group.add(model);
      group.updateMatrixWorld(true);
      limbs.model = model;
      ensureAnimation(model, gltf.animations);
      rig.mixer = mixer!;
      rig.clips = clips;
      onReady?.(rig);
    },
    undefined,
    (err) => {
      // A missing model must not take the game down; the caller keeps whatever
      // it already had on screen.
      console.warn('[characters] could not load', url, err);
    },
  );

  return rig;
}

/** NPC: the same clip library, a different body, and a cheaper share. */
export function createNpcCharacter(
  url: string,
  onReady?: (rig: ClipCharacter) => void,
): ClipCharacter {
  return createClipCharacter(
    { id: `npc:${url}`, name: 'NPC', body: { height: 1.7, shoulder: 0.4, skin: 0xd2b49a } } as CharacterDef,
    url,
    onReady,
  );
}

export { cloneSkeleton as cloneRig };
