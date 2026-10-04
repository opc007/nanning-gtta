/**
 * Dressing the Quaternius body, by surgery on its own meshes.
 *
 * The first attempt layered a procedural lab coat over the model as four rigid
 * slabs parented to `Chest`/`UpperArm*`. It never read: the jacket underneath is
 * the same grey as the coat's shadow side, so every screenshot still said
 * "grey suit", and the sleeves were rigid boards bolted to the upper-arm bones,
 * so every punch or jump threw white shards across the shoulders.
 *
 * The model's own meshes are far better starting material. `GLTFLoader` splits
 * multi-primitive meshes into `Name_0..N` children, so the jacket, the shirt,
 * the tie and the skin are four separate objects we can recolour or remove
 * outright, and `Suit_Legs` carries `COLOR_0`, which means the legs can be
 * re-coloured per vertex to turn trousers into shorts with bare shins — no
 * boolean cut, and therefore no hollow tube and no floating stubs.
 *
 * What the result reads as: white lab coat, grey vest showing through the open
 * front, grey shorts, bare shins, black flip-flops, thick black glasses.
 */

import * as THREE from 'three';
import type { CharacterDef } from './types';
import type { RigMetrics } from './glbOutfit';

export interface BodyDress {
  /** Meshes that were hidden, so first-person can keep them hidden. */
  hidden: THREE.Object3D[];
  /** Vertices recoloured on `Suit_Legs`, for the tests and for debugging. */
  shinVerts: number;
  shortVerts: number;
  /** Jacket triangles removed to open the front. */
  openedTris: number;
}

/** World-space Y of the trouser hem, as a fraction of the leg's own span. */
const KNEE_FRACTION = 0.46;

function child(parent: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  parent.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

/**
 * Find a mesh by the name of its **material**.
 *
 * The loader splits a multi-primitive mesh into children numbered from 1 —
 * `Suit_Body_1` is the jacket, `_2` the shirt, `_3` the tie, `_4` the skin —
 * and the numbering has already shifted once in this project, which is how the
 * shirt ended up hidden while the tie stayed on. Material names are the stable
 * part of the file, so everything below is addressed through them.
 */
function byMaterial(parent: THREE.Object3D, material: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  parent.traverse((o) => {
    if (found || !(o as THREE.Mesh).isMesh) return;
    const m = o as THREE.Mesh;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    if (list.some((x) => x?.name === material)) found = m;
  });
  return found;
}

function solid(m: THREE.Object3D): THREE.Mesh | null {
  return (m as THREE.Mesh).isMesh ? (m as THREE.Mesh) : null;
}

/** Vertex positions of a mesh at bind pose, in character space. */
function bindPositions(mesh: THREE.Mesh): Float32Array {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const m = mesh.matrixWorld.elements;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/**
 * Drop whole triangles from an indexed geometry.
 *
 * Returns the number of triangles removed. All vertex attributes are carried
 * across, so a skinned mesh keeps its joints and weights and the skinning is
 * unaffected — only the faces go away.
 */
export function carveTriangles(
  mesh: THREE.Mesh,
  world: Float32Array,
  drop: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => boolean,
): number {
  const geo = mesh.geometry;
  const src = geo.index;
  const count = src ? src.count : geo.getAttribute('position').count;
  const triCount = Math.floor(count / 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const keep: number[] = [];
  let removed = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = src ? src.getX(t * 3) : t * 3;
    const i1 = src ? src.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = src ? src.getX(t * 3 + 2) : t * 3 + 2;
    a.set(world[i0 * 3], world[i0 * 3 + 1], world[i0 * 3 + 2]);
    b.set(world[i1 * 3], world[i1 * 3 + 1], world[i1 * 3 + 2]);
    c.set(world[i2 * 3], world[i2 * 3 + 1], world[i2 * 3 + 2]);
    if (drop(a, b, c)) removed++;
    else keep.push(i0, i1, i2);
  }
  if (!removed) return 0;

  const flat = new THREE.BufferGeometry();
  const idx = new Uint32Array(keep);
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.getAttribute(name) as THREE.BufferAttribute;
    const dst = new Float32Array(keep.length * attr.itemSize);
    for (let k = 0; k < keep.length; k++) {
      const s = attr.itemSize === 1 ? keep[k] : keep[k];
      for (let c2 = 0; c2 < attr.itemSize; c2++) {
        dst[k * attr.itemSize + c2] = (attr.array as ArrayLike<number>)[s * attr.itemSize + c2];
      }
    }
    flat.setAttribute(name, new THREE.BufferAttribute(dst, attr.itemSize, attr.normalized));
  }
  flat.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.dispose();
  mesh.geometry = flat;
  return removed;
}

/**
 * Re-colour the legs per vertex: shorts above the knee, bare shin below.
 *
 * The material must go to white first, because three multiplies material colour
 * by the vertex colour — leaving the grey in place tints everything.
 */
export function paintLegs(
  mesh: THREE.Mesh,
  world: Float32Array,
  shortColor: THREE.Color,
  skinColor: THREE.Color,
): { shin: number; shorts: number; kneeY: number } {
  const geo = mesh.geometry;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < world.length; i += 3) {
    if (world[i + 1] < lo) lo = world[i + 1];
    if (world[i + 1] > hi) hi = world[i + 1];
  }
  const kneeY = lo + (hi - lo) * KNEE_FRACTION;
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  let shin = 0;
  let shorts = 0;
  for (let i = 0; i < n; i++) {
    const c = world[i * 3 + 1] < kneeY ? skinColor : shortColor;
    if (c === skinColor) shin++;
    else shorts++;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  return { shin, shorts, kneeY };
}

/** Set a material's base colour, cloning first if several meshes share it. */
function tint(mesh: THREE.Mesh, color: number, roughness?: number): void {
  const apply = (m: THREE.Material | THREE.Material[]): void => {
    if (Array.isArray(m)) {
      m.forEach(apply);
      return;
    }
    const std = m as THREE.MeshStandardMaterial;
    const clone = std.clone();
    clone.color = new THREE.Color(color);
    if (roughness !== undefined) clone.roughness = roughness;
    mesh.material = clone;
  };
  apply(mesh.material);
}

/**
 * Cut a vertical slot down the front of the jacket so the grey vest underneath
 * shows and the coat reads as worn open rather than buttoned shut.
 *
 * The character faces +X, so the opening is `x > 0` (front) within a narrow
 * `z` band (the centre line), running from the hips up to the collar.
 */
export function openCoatFront(
  mesh: THREE.Mesh,
  world: Float32Array,
  opts: { hipY: number; neckY: number; halfWidth?: number },
): number {
  const half = opts.halfWidth ?? 0.085;
  const all = (v: THREE.Vector3[], f: (x: number, y: number, z: number) => boolean): boolean =>
    v.every((p) => f(p.x, p.y, p.z));
  return carveTriangles(mesh, world, (a, b, c) => {
    const v = [a, b, c];
    // A triangle only goes if every one of its corners is inside the slot, so
    // the cut edge follows the mesh's own topology instead of stair-stepping.
    return (
      all(v, (_x, y) => y > opts.hipY && y < opts.neckY) &&
      all(v, (x) => x > 0.0) &&
      all(v, (_x, _y, z) => Math.abs(z) < half)
    );
  });
}

/**
 * Dress the whole model. Call once the GLB is in its bind pose and the world
 * matrices have been updated.
 */
export function dressGlbBody(
  model: THREE.Object3D,
  def: CharacterDef,
  m: RigMetrics,
): BodyDress {
  model.updateWorldMatrix(true, true);
  const hidden: THREE.Object3D[] = [];
  let shinVerts = 0;
  let shortVerts = 0;
  let openedTris = 0;

  // ── Hair / skin / brows ────────────────────────────────────────────────
  const hair = byMaterial(model, 'Hair');
  if (hair) tint(hair, def.hair.color, 0.95);
  const skin = byMaterial(model, 'Skin');
  if (skin) tint(skin, def.body.skin, 0.72);
  const brows = byMaterial(model, 'Eyebrows');
  if (brows) tint(brows, def.hair.color, 0.95);

  // ── Legs: shorts above the knee, bare shin below ───────────────────────
  const legs = byMaterial(model, 'Suit');
  const legMesh = solid(child(model, 'Suit_Legs') ?? new THREE.Object3D());
  if (legMesh) {
    const world = bindPositions(legMesh);
    tint(legMesh, 0xffffff, 0.88);
    const res = paintLegs(
      legMesh,
      world,
      new THREE.Color(def.bottoms.color),
      new THREE.Color(def.body.skin),
    );
    shinVerts = res.shin;
    shortVerts = res.shorts;
  }
  void legs;

  // ── Torso: the jacket itself becomes the lab coat ──────────────────────
  // `byMaterial('Suit')` would also match the legs, so the jacket is found as
  // the Suit material that is *not* the leg mesh.
  const jacket = (() => {
    let hit: THREE.Mesh | null = null;
    model.traverse((o) => {
      if (hit || !(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      if (list.some((x) => x?.name === 'Suit') && m !== legMesh) hit = m;
    });
    return hit;
  })();
  if (jacket) {
    tint(jacket, def.outerwear?.color ?? 0xf3f1ec, 0.86);
    const world = bindPositions(jacket);
    openedTris = openCoatFront(jacket, world, {
      hipY: m.hips.y - 0.02,
      neckY: m.neck.y - 0.02,
    });
  }

  // ── Shirt underneath becomes the grey vest, visible through the opening ──
  const shirt = byMaterial(model, 'White');
  if (shirt) tint(shirt, def.top.color, 0.9);

  // ── The tie is the single loudest "business suit" cue. Remove it outright;
  //     the vest is right behind it, so there is nothing to show through.
  const tie = byMaterial(model, 'Tie');
  if (tie) {
    tie.visible = false;
    hidden.push(tie);
  }

  // ── Shoes: black, and flattened so they read as a flip-flop sole with bare
  //    shin above it rather than a dress shoe. ────────────────────────────
  const feet = byMaterial(model, 'Black');
  if (feet) {
    tint(feet, def.shoes.color, 0.72);
    feet.scale.y = 0.58;
  }

  model.updateWorldMatrix(true, true);
  return { hidden, shinVerts, shortVerts, openedTris };
}
