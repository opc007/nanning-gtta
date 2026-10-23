/**
 * What is the player pointing at?
 *
 * Every verb used to answer that question for itself. Shops tested their own
 * reach and their own idea of "in front of you", pedestrians tested another,
 * the railings a third. Three definitions of "close enough and facing it" is
 * why the interaction felt arbitrary — you would swing at something that
 * obviously counted, and nothing would happen.
 *
 * So this resolves it once: a cone in front of the player, a reach, and a line
 * of sight, scored across every kind of thing in the world. The verbs ask this
 * and act on what comes back. Adding a new kind of thing to the world means
 * adding it to one list here rather than re-deriving the geometry a fourth time.
 *
 * The resolver also *tells* the player what it found, because the single
 * biggest thing missing from the feel is knowing what you are about to hit. A
 * target you cannot see is a target you cannot aim at.
 */

import * as THREE from 'three';
import { segmentBlocked } from './Collision';

export type TargetKind = 'ped' | 'shop' | 'prop' | 'vehicle' | 'barrier';

/** What a caller offers to the resolver. No facing or distance yet. */
export interface TargetCandidate {
  kind: TargetKind;
  id: string | number;
  x: number;
  z: number;
  /** HP left, when the target has any. */
  hp?: number;
  maxHp?: number;
  /** Called on strike. Returns false if the target was not actually hit. */
  strike?: (damage: number) => boolean;
  /** Called on grab. Returns true if the target is now held. */
  grab?: () => boolean;
  /** Display name, shown on the reticle. */
  label: string;
}

/** A candidate the resolver accepted, with the geometry it worked out. */
export interface Target extends TargetCandidate {
  /** How squarely the player is facing it, 0–1. */
  facing: number;
  /** Centre-to-centre distance, metres. */
  distance: number;
}

export interface TargetQuery {
  x: number;
  z: number;
  /** Facing unit vector (the same one the punch code uses). */
  dirX: number;
  dirZ: number;
  reach: number;
  /** Half-angle of the cone, radians. 0.6 rad ≈ 34°, forgiving but not blind. */
  halfAngle?: number;
  /** Boxes the line of sight must not pass through — walls, closed shops. */
  blockers?: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  /** Restrict to these kinds, e.g. a verb that only makes sense on one. */
  only?: TargetKind[];
}

const DEFAULT_HALF_ANGLE = 0.62;

/**
 * Score one candidate. Facing dominates distance on purpose: in a crowd you
 * want the person you are looking at, not the one marginally closer who is
 * half turned away. Ties then break toward whatever is nearer.
 */
function score(t: { x: number; z: number }, q: TargetQuery): { facing: number; distance: number } | null {
  const dx = t.x - q.x;
  const dz = t.z - q.z;
  const d = Math.hypot(dx, dz);
  if (d > q.reach || d < 1e-3) return null;
  const facing = (dx / d) * q.dirX + (dz / d) * q.dirZ;
  if (facing < Math.cos(q.halfAngle ?? DEFAULT_HALF_ANGLE)) return null;
  if (q.blockers?.length) {
    // A closed door between you and the target means the target is not there.
    if (segmentBlocked(q.x, q.z, t.x, t.z, q.blockers)) return null;
  }
  return { facing, distance: d };
}

export function pickTarget(candidates: readonly TargetCandidate[], q: TargetQuery): Target | null {
  const pool = q.only ? candidates.filter((c) => q.only!.includes(c.kind)) : candidates;
  let best: Target | null = null;
  let bestScore = -Infinity;
  for (const c of pool) {
    const s = score(c, q);
    if (!s) continue;
    // Facing is worth more than proximity, and deliberately non-linear: the
    // first 30° of cone should matter far more than the last.
    const v = s.facing * s.facing * 2.2 - s.distance / q.reach;
    if (v > bestScore) {
      bestScore = v;
      best = { ...c, facing: s.facing, distance: s.distance };
    }
  }
  return best;
}

/**
 * The reticle: a ring on the ground under whatever the resolver picked up.
 *
 * Deliberately not a floating sprite or a health bar over the head — a flat
 * ring reads at any distance, in any lighting, and does not fight the signs
 * for attention. It fades in rather than snapping on, so sweeping the camera
 * across a crowd feels like scanning rather than strobing.
 */
export class TargetMarker {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private shown = 0;
  private current: Target | null = null;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.RingGeometry(0.38, 0.46, 28);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffd24a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** @returns true if the highlighted target changed this frame. */
  update(target: Target | null, dt: number): boolean {
    const want = target ? 1 : 0;
    // Fast enough to feel instant on acquire, slow enough not to strobe while
    // the player sweeps across a row of pedestrians.
    this.shown += (want - this.shown) * Math.min(1, dt * 14);
    const changed = (this.current === null) !== (target === null);
    this.current = target;

    if (target) {
      this.mesh.position.set(target.x, 0.03, target.z);
      const s = 0.8 + target.distance * 0.08;
      this.mesh.scale.set(s, 1, s);
      // Hurt things read red before you have committed to swinging.
      const hurt = target.maxHp ? 1 - (target.hp ?? target.maxHp) / target.maxHp : 0;
      this.mat.color.setRGB(1, 0.82 - hurt * 0.6, 0.29 - hurt * 0.24);
    }
    this.mat.opacity = this.shown * 0.85;
    this.mesh.visible = this.shown > 0.02;
    return changed;
  }
}
