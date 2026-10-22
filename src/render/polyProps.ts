/**
 * Poly Pizza props listed in Issue #6.
 *
 * Staged under `public/assets/poly/`:
 * - red lantern — Sophie Kim, CC-BY 3.0
 * - Chukaman steamer — Quaternius CC0 (Issue #6 mirror)
 * - Scooter (e-bike) — Poly by Google, CC-BY 3.0
 * - Pan Wok — MilkAndBanana, CC0
 *
 * Attribution lives in `public/assets/CREDITS.md`.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const LANTERN_URL = `${import.meta.env.BASE_URL}assets/poly/red-lantern.glb`;
const EBIKE_URL = `${import.meta.env.BASE_URL}assets/poly/ebike.glb`;

/** Issue #6 scale for the red lantern. */
const LANTERN_SCALE = 0.75;
/** Issue #6 scale for the Poly by Google scooter (~1.8 m long after fit). */
const EBIKE_SCALE = 0.042;

let lanternTemplate: Promise<THREE.Object3D | null> | null = null;
let ebikeTemplate: THREE.Object3D | null = null;
let ebikeLoad: Promise<THREE.Object3D | null> | null = null;

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
 * Normalise the Poly scooter so heading 0 faces +X (game forward), sits on
 * y=0, and is centred on XZ. Issue #6 scale is ×0.042.
 */
function prepareEbike(scene: THREE.Object3D): THREE.Object3D {
  const root = scene;
  root.scale.setScalar(EBIKE_SCALE);
  // Authored long axis is +Z; game vehicles face +X at heading 0.
  root.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.position.x -= (box.min.x + box.max.x) / 2;
  root.position.y -= box.min.y;
  root.position.z -= (box.min.z + box.max.z) / 2;
  root.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return root;
}

/** Load (once) the Poly Pizza scooter. Safe to call from boot before Vehicles. */
export function preloadPolyEbike(): Promise<THREE.Object3D | null> {
  if (ebikeTemplate) return Promise.resolve(ebikeTemplate);
  if (ebikeLoad) return ebikeLoad;
  ebikeLoad = new Promise((resolve) => {
    new GLTFLoader().load(
      EBIKE_URL,
      (gltf) => {
        ebikeTemplate = prepareEbike(gltf.scene);
        resolve(ebikeTemplate);
      },
      undefined,
      () => {
        ebikeTemplate = null;
        resolve(null);
      },
    );
  });
  return ebikeLoad;
}

/** Clone the preloaded scooter, or null if the GLB did not load. */
export function clonePolyEbike(): THREE.Group | null {
  if (!ebikeTemplate) return null;
  return ebikeTemplate.clone(true) as THREE.Group;
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

/**
 * Park Poly Pizza scooters along the kerb so the e-bike shows in street
 * acceptance stills (fuji door / night). Heading is world yaw (0 = +X).
 */
export async function addPolyEbikes(
  scene: THREE.Scene,
  spots: { x: number; z: number; heading: number; y?: number }[],
): Promise<number> {
  const tmpl = await preloadPolyEbike();
  if (!tmpl) return 0;
  const root = new THREE.Group();
  root.name = 'nn-poly-ebikes';
  // The template carries the ground alignment the loader worked out — the
  // model's own origin is somewhere in the middle of the frame, so `prepare`
  // shifts it down until the wheels touch y=0. A clone keeps that shift in
  // its position, and overwriting the position threw it away: every scooter
  // on the street hovered a hand's width above the pavement, which is the
  // "the e-bike floats in the road" the review kept catching.
  const offset = tmpl.position.clone();
  for (const s of spots) {
    const clone = tmpl.clone(true);
    // The covered walkway is a step up from the carriageway, so a scooter
    // parked under it stands on that step — not with its wheels in it.
    clone.position.set(s.x + offset.x, (s.y ?? 0) + offset.y, s.z + offset.z);
    clone.rotation.y += s.heading;
    root.add(clone);
  }
  scene.add(root);
  return spots.length;
}
