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
 * occupied. Tables and stools also take an explicit target height: Kenney's
 * `table.glb` is authored at coffee-table height (~0.31 m), so a footprint-only
 * uniform fit leaves dining surfaces at knee height. When `height` is set we
 * stretch Y independently to match the layout collider (0.75 / 1.05 / 0.45–0.75);
 * other kit pieces keep the old uniform footprint scale.
 *
 * Menu boards and hanging lanterns stay on their canvas / Poly Pizza paths —
 * the brief says keep those.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface KitPiece {
  url: string;
  /** Footprint the procedural prop used, in metres. */
  width: number;
  depth: number;
  /**
   * Standing height in metres (layout collider). When set, Y is scaled
   * independently of the XZ footprint fit.
   */
  height?: number;
}

const FURN = 'assets/kenney/furniture/Models/GLTF%20format';
const FOOD = 'assets/kenney/food/Models/GLB%20format';
const MARKET = 'assets/kenney/mini-market/Models/GLB%20format';
const POLY = 'assets/poly';

/** Bucket id → the Kenney / Poly model that replaces it. */
export const INTERIOR_KIT: Record<string, KitPiece> = {
  // Furniture Kit (folder is "GLTF format", files are still .glb).
  // Heights match PROP_SIZE in interiors.ts: dining 0.75, bar 1.05, stools 0.45–0.75.
  'table-square': { url: `${FURN}/table.glb`, width: 0.8, depth: 0.8, height: 0.75 },
  'table-round': { url: `${FURN}/tableRound.glb`, width: 1.05, depth: 1.05, height: 0.76 },
  'table-high': { url: `${FURN}/desk.glb`, width: 0.7, depth: 0.7, height: 1.05 },
  stool: { url: `${FURN}/stoolBarSquare.glb`, width: 0.34, depth: 0.34, height: 0.45 },
  'stool-high': { url: `${FURN}/stoolBar.glb`, width: 0.32, depth: 0.32, height: 0.75 },
  counter: { url: `${FURN}/kitchenCabinet.glb`, width: 0.7, depth: 2.4 },
  grill: { url: `${FURN}/kitchenStove.glb`, width: 0.7, depth: 1.1 },
  // Food / market / Poly Pizza steamer + wok (Issue #6).
  steamer: { url: `${POLY}/steamer.glb`, width: 0.5, depth: 0.5 },
  // Pan Wok (MilkAndBanana, CC0) — stretch Y to stew-pot collider height.
  pot: { url: `${POLY}/wok.glb`, width: 0.5, depth: 0.5, height: 0.55 },
  case: { url: `${MARKET}/freezers-standing.glb`, width: 0.52, depth: 1.2 },
  cup: { url: `${FOOD}/cup.glb`, width: 0.1, depth: 0.1 },
  bowl: { url: `${FOOD}/bowl-broth.glb`, width: 0.17, depth: 0.17 },
};

/**
 * Centre on XZ, sit on y=0, and scale so the footprint matches the prop it is
 * standing in for. `min` of the two ratios keeps the piece inside the slot
 * rather than spilling onto the aisle. When `height` is given, stretch Y to
 * that target so coffee-table meshes become dining / bar height.
 *
 * Must keep the index buffer: Kenney GLBs are indexed, and dropping it turns
 * sequential verts into a triangle soup (the peach "shard" look).
 */
function normalise(
  geo: THREE.BufferGeometry,
  width: number,
  depth: number,
  height?: number,
): THREE.BufferGeometry {
  const g = geo.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const sx = bb.max.x - bb.min.x;
  const sy = bb.max.y - bb.min.y;
  const sz = bb.max.z - bb.min.z;
  const kFoot = Math.min(sx > 1e-4 ? width / sx : 1, sz > 1e-4 ? depth / sz : 1);
  const ky = height != null && sy > 1e-4 ? height / sy : kFoot;
  g.scale(kFoot, ky, kFoot);
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
  /** True when geometry carries a `color` attribute from multi-part merge. */
  vertexColors: boolean;
}

/**
 * Pack every mesh in a GLB into one geometry. Multi-part Furniture Kit pieces
 * (stool body + cushion, cabinet + doors) only read as furniture when all
 * parts survive; a single "largest mesh" pick leaves floating panels.
 *
 * Parts with different `baseColorFactor`s get a vertex-colour attribute so one
 * InstancedMesh material can still show both tones. A shared colormap (Food
 * Kit) wins and vertex colours stay off.
 */
function packMeshes(
  root: THREE.Object3D,
): { geo: THREE.BufferGeometry; map: THREE.Texture | null; color: number; vertexColors: boolean } | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let sharedMap: THREE.Texture | null = null;
  let fallbackColor = 0xffffff;
  let sawColor = false;
  const colors = new Set<number>();

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.getAttribute('position')) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as
      | THREE.MeshStandardMaterial
      | undefined;
    if (mat?.map && !sharedMap) sharedMap = mat.map;
    const hex = mat?.color?.getHex() ?? 0xffffff;
    colors.add(hex);
    if (!sawColor) {
      fallbackColor = hex;
      sawColor = true;
    }
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    parts.push(g);
  });
  if (!parts.length) return null;

  const useVertexColors = !sharedMap && colors.size > 1;
  if (useVertexColors) {
    // Re-walk to paint each part before merge — colour must match the clone order.
    let i = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry?.getAttribute('position')) return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as
        | THREE.MeshStandardMaterial
        | undefined;
      const c = new THREE.Color(mat?.color?.getHex() ?? 0xffffff);
      const g = parts[i++];
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        arr[v * 3] = c.r;
        arr[v * 3 + 1] = c.g;
        arr[v * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    });
  }

  const geo =
    parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) as THREE.BufferGeometry | null);
  if (!geo) return null;
  return {
    geo,
    map: sharedMap,
    color: sharedMap ? 0xffffff : fallbackColor,
    vertexColors: useVertexColors,
  };
}

/** Load every kit piece. A missing model is skipped, never fatal. */
export async function loadInteriorKit(): Promise<Map<string, KitPart>> {
  const loader = new GLTFLoader();
  const out = new Map<string, KitPart>();
  await Promise.all(
    Object.entries(INTERIOR_KIT).map(async ([id, piece]) => {
      try {
        const gltf = await loader.loadAsync(piece.url);
        const packed = packMeshes(gltf.scene);
        if (packed) {
          out.set(id, {
            geometry: normalise(packed.geo, piece.width, piece.depth, piece.height),
            map: packed.map,
            color: packed.color,
            vertexColors: packed.vertexColors,
          });
        }
      } catch {
        // Leave the bucket on its procedural geometry.
      }
    }),
  );
  return out;
}
