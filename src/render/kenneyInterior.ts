/**
 * Kenney furniture and food for the shop interiors.
 *
 * The interiors already instance every prop by type, so swapping the look does
 * not mean rebuilding the layout — it means replacing the geometry on a handful
 * of `InstancedMesh` buckets. Tables, stools, counters and the grills stay
 * procedural (they are boxes and cylinders, and a GLB buys nothing there); what
 * a code-built box genuinely cannot fake is a stack of bamboo steamer baskets, a
 * lidded stew pot, a glass-fronted freezer, a cup of tea and a bowl of broth.
 * Those five are what the four shops are actually recognised by, so those five
 * come from the Food Kit and Mini Market.
 *
 * Each import is normalised to sit on the floor, centred on its own footprint,
 * and scaled so its largest horizontal extent matches what the procedural prop
 * occupied. Non-uniform fitting would be more precise and is not worth it: the
 * instance matrices already carry a per-prop X/Z scale from the layout, and the
 * colliders come from the same numbers, so a uniform fit keeps visual and
 * physical extents in the same ballpark.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface KitPiece {
  url: string;
  /** Footprint the procedural prop used, in metres. */
  width: number;
  depth: number;
}

/** Bucket id → the Kenney model that replaces it. */
export const INTERIOR_KIT: Record<string, KitPiece> = {
  steamer: { url: 'assets/kenney/food/Models/GLB%20format/steamer.glb', width: 0.5, depth: 0.5 },
  pot: { url: 'assets/kenney/food/Models/GLB%20format/pot-lid.glb', width: 0.4, depth: 0.4 },
  case: { url: 'assets/kenney/mini-market/Models/GLB%20format/freezers-standing.glb', width: 0.52, depth: 1.2 },
  cup: { url: 'assets/kenney/food/Models/GLB%20format/cup.glb', width: 0.1, depth: 0.1 },
  bowl: { url: 'assets/kenney/food/Models/GLB%20format/bowl-broth.glb', width: 0.17, depth: 0.17 },
};

/**
 * Centre on XZ, sit on y=0, and scale so the footprint matches the prop it is
 * standing in for. `min` of the two ratios keeps the piece inside the slot
 * rather than spilling onto the aisle.
 */
function normalise(geo: THREE.BufferGeometry, width: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.getAttribute('normal')) g.setAttribute('normal', geo.getAttribute('normal').clone());
  if (geo.getAttribute('uv')) g.setAttribute('uv', geo.getAttribute('uv').clone());

  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const sx = bb.max.x - bb.min.x;
  const sz = bb.max.z - bb.min.z;
  const k = Math.min(sx > 1e-4 ? width / sx : 1, sz > 1e-4 ? depth / sz : 1);
  g.scale(k, k, k);
  g.computeBoundingBox();
  const b2 = g.boundingBox!;
  g.translate(
    -(b2.min.x + b2.max.x) / 2,
    -b2.min.y,
    -(b2.min.z + b2.max.z) / 2,
  );
  g.computeVertexNormals();
  return g;
}

export interface KitPart {
  geometry: THREE.BufferGeometry;
  /** The pack's shared colormap, so the piece is not a white blob. */
  map: THREE.Texture | null;
}

/** Load every kit piece. A missing model is skipped, never fatal. */
export async function loadInteriorKit(): Promise<Map<string, KitPart>> {
  const loader = new GLTFLoader();
  const out = new Map<string, KitPart>();
  await Promise.all(
    Object.entries(INTERIOR_KIT).map(async ([id, piece]) => {
      try {
        const gltf = await loader.loadAsync(piece.url);
        let found: THREE.BufferGeometry | null = null;
        let map: THREE.Texture | null = null;
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!found && m.isMesh && m.geometry?.getAttribute('position')) {
            found = m.geometry;
            map = (m.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
          }
        });
        if (found) out.set(id, { geometry: normalise(found, piece.width, piece.depth), map });
      } catch {
        // Leave the bucket on its procedural geometry.
      }
    }),
  );
  return out;
}
