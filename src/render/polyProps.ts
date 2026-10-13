/**
 * Poly Pizza props listed in Issue #6.
 *
 * Cloudflare blocks the live CDN from this environment, so what is staged under
 * `public/assets/poly/` is whatever we could pull via Wayback / author mirrors:
 * the red lantern (Sophie Kim, CC-BY 3.0) and the Quaternius Chukaman steamer
 * (CC0, same model the brief points at on Poly Pizza). E-bike and wok are still
 * blocked — CREDITS.md says so, and the procedural e-bike / Kenney pot stand in.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const LANTERN_URL = `${import.meta.env.BASE_URL}assets/poly/red-lantern.glb`;

/** Issue #6 scale for the red lantern. */
const LANTERN_SCALE = 0.75;

let lanternTemplate: Promise<THREE.Object3D | null> | null = null;

function loadLantern(): Promise<THREE.Object3D | null> {
  if (lanternTemplate) return lanternTemplate;
  lanternTemplate = new Promise((resolve) => {
    new GLTFLoader().load(
      LANTERN_URL,
      (gltf) => {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const h = Math.max(box.max.y - box.min.y, 1e-4);
        // Authoring height varies; LANTERN_SCALE is relative to a ~1 m reference.
        root.scale.setScalar(LANTERN_SCALE * (1 / h));
        const after = new THREE.Box3().setFromObject(root);
        // Hang point at the top of the mesh.
        root.position.y = -after.max.y;
        root.traverse((o) => {
          o.castShadow = true;
          o.receiveShadow = true;
        });
        resolve(root);
      },
      undefined,
      () => resolve(null),
    );
  });
  return lanternTemplate;
}

/**
 * Scatter a few Poly Pizza red lanterns under the arcade overhang, one pair
 * per warm shop, so the CC-BY credit is visible on the street and not only in
 * CREDITS.md. Returns how many were placed.
 */
export async function addPolyLanterns(
  scene: THREE.Scene,
  spots: { x: number; y: number; z: number }[],
): Promise<number> {
  const tmpl = await loadLantern();
  if (!tmpl) return 0;
  const root = new THREE.Group();
  root.name = 'nn-poly-lanterns';
  for (const s of spots) {
    const clone = tmpl.clone(true);
    clone.position.set(s.x, s.y, s.z);
    root.add(clone);
  }
  scene.add(root);
  return spots.length;
}
