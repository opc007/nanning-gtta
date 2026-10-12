/**
 * Kenney furniture and food for the shop interiors.
 *
 * The interiors already instance every prop by type, so swapping the look does
 * not mean rebuilding the layout — it means replacing the geometry on a handful
 * of `InstancedMesh` buckets. Tables, stools, counters and the grills used to
 * stay as code-built boxes; the Furniture Kit now covers those. Food Kit /
 * Mini Market / Poly Pizza steamer cover the recognisable food pieces.
 *
 * Each import is normalised to sit on the floor, centred on its own footprint,
 * and scaled so its largest horizontal extent matches what the procedural prop
 * occupied. Non-uniform fitting would be more precise and is not worth it: the
 * instance matrices already carry a per-prop X/Z scale from the layout, and the
 * colliders come from the same numbers, so a uniform fit keeps visual and
 * physical extents in the same ballpark.
 *
 * Menu boards and hanging lanterns stay on their canvas / Poly Pizza paths —
 * the brief says keep those.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface KitPiece {
  url: string;
  /** Footprint the procedural prop used, in metres. */
  width: number;
  depth: number;
}

const FURN = 'assets/kenney/furniture/Models/GLTF%20format';
const FOOD = 'assets/kenney/food/Models/GLB%20format';
const MARKET = 'assets/kenney/mini-market/Models/GLB%20format';
const POLY = 'assets/poly';

/** Bucket id → the Kenney / Poly model that replaces it. */
export const INTERIOR_KIT: Record<string, KitPiece> = {
  // Furniture Kit (folder is "GLTF format", files are still .glb).
  'table-square': { url: `${FURN}/table.glb`, width: 0.8, depth: 0.8 },
  'table-round': { url: `${FURN}/tableRound.glb`, width: 1.05, depth: 1.05 },
  'table-high': { url: `${FURN}/desk.glb`, width: 0.7, depth: 0.7 },
  stool: { url: `${FURN}/stoolBarSquare.glb`, width: 0.34, depth: 0.34 },
  'stool-high': { url: `${FURN}/stoolBar.glb`, width: 0.32, depth: 0.32 },
  counter: { url: `${FURN}/kitchenCabinet.glb`, width: 0.7, depth: 2.4 },
  grill: { url: `${FURN}/kitchenStove.glb`, width: 0.7, depth: 1.1 },
  // Food / market / Poly Pizza steamer (Quaternius CC0 mirror of the Issue #6 asset).
  steamer: { url: `${POLY}/steamer.glb`, width: 0.5, depth: 0.5 },
  pot: { url: `${FOOD}/pot-lid.glb`, width: 0.4, depth: 0.4 },
  case: { url: `${MARKET}/freezers-standing.glb`, width: 0.52, depth: 1.2 },
  cup: { url: `${FOOD}/cup.glb`, width: 0.1, depth: 0.1 },
  bowl: { url: `${FOOD}/bowl-broth.glb`, width: 0.17, depth: 0.17 },
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
  /**
   * Furniture Kit pieces often have no atlas — only a `baseColorFactor`.
   * Carry that through so swapping the bucket does not paint them white.
   */
  color: number;
}

/** Merge every mesh under a GLB into one geometry (multi-part furniture). */
function mergeMeshes(
  root: THREE.Object3D,
): { geo: THREE.BufferGeometry; map: THREE.Texture | null; color: number } | null {
  const geos: THREE.BufferGeometry[] = [];
  let map: THREE.Texture | null = null;
  let color = 0xffffff;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.getAttribute('position')) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    geos.push(g);
    const mat = m.material as THREE.MeshStandardMaterial | undefined;
    if (mat) {
      if (!map && mat.map) map = mat.map;
      if (color === 0xffffff && mat.color) color = mat.color.getHex();
    }
  });
  if (!geos.length) return null;
  if (geos.length === 1) return { geo: geos[0], map, color };
  const merged = mergeGeometries(geos, false);
  return merged ? { geo: merged, map, color } : { geo: geos[0], map, color };
}

/** Load every kit piece. A missing model is skipped, never fatal. */
export async function loadInteriorKit(): Promise<Map<string, KitPart>> {
  const loader = new GLTFLoader();
  const out = new Map<string, KitPart>();
  await Promise.all(
    Object.entries(INTERIOR_KIT).map(async ([id, piece]) => {
      try {
        const gltf = await loader.loadAsync(piece.url);
        const packed = mergeMeshes(gltf.scene);
        if (packed) {
          out.set(id, {
            geometry: normalise(packed.geo, piece.width, piece.depth),
            map: packed.map,
            color: packed.color,
          });
        }
      } catch {
        // Leave the bucket on its procedural geometry.
      }
    }),
  );
  return out;
}
