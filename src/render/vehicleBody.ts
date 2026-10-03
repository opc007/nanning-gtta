import * as THREE from 'three';
/**
 * Vehicle bodies built by lofting cross-sections.
 *
 * The base game builds every car from `BoxGeometry`. A box has a 90° shoulder
 * and a flat roof, and no amount of paint makes it a car — the silhouette is
 * the whole read, and a box silhouette says "placeholder" at any distance.
 *
 * So: define a car as a series of cross-sections along its length, then skin
 * them into a smooth hull. Each section is a superellipse (half-width, centre
 * height, half-height, exponent), which lets one primitive describe a soft
 * nose, a boxy midsection and a glasshouse. Add a separate greenhouse loft for
 * the cabin so the windscreen can rake without warping the body.
 */

/** Superellipse point at angle t. k=2 → ellipse, k=4+ → boxy. */
function sePoint(t: number, hw: number, hh: number, k: number, cz: number, cy: number): [number, number, number] {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / k) * hw;
  const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / k) * hh;
  return [x, cy + y, cz];
}

export interface Section {
  /** Position along the vehicle's length (forward is +). */
  z: number;
  /** Half-width. */
  w: number;
  /** Centre height. */
  y: number;
  /** Half-height. */
  h: number;
  /** Superellipse exponent: 2 round, 6 boxy. */
  k?: number;
}

/**
 * Skin a list of sections into a closed hull. Cap the ends so the mesh is
 * watertight (matters for shadows and for any future physics proxy).
 */
export function loft(sections: Section[], seg = 16, cap = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = seg + 1;
  sections.forEach((s) => {
    for (let i = 0; i < ring; i++) {
      const t = (i / seg) * Math.PI * 2;
      const [x, y, z] = sePoint(t, s.w, s.h, s.k ?? 4, s.z, s.y);
      pos.push(x, y, z);
    }
  });
  for (let si = 0; si < sections.length - 1; si++) {
    for (let i = 0; i < seg; i++) {
      const a = si * ring + i;
      const b = a + 1;
      const c = (si + 1) * ring + i + 1;
      const d = (si + 1) * ring + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  if (cap) {
    // End caps as triangle fans around a centre vertex.
    for (const end of [0, sections.length - 1]) {
      const s = sections[end];
      const centre = pos.length / 3;
      pos.push(0, s.y, s.z);
      const base = end * ring;
      for (let i = 0; i < seg; i++) {
        const a = base + i;
        const b = base + i + 1;
        if (end === 0) idx.push(centre, b, a);
        else idx.push(centre, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── Sedan ───────────────────────────────────────────────────────────────────

/**
 * A three-box saloon, described the way a car actually is: low nose, rising
 * bonnet line, a raked windscreen, a glasshouse set inboard of the body, a
 * short deck, and a cut-off tail. Read the section list front to back and the
 * silhouette tells you what kind of car it is.
 */
const SEDAN_SECTIONS: Section[] = [
  { z: 2.05, w: 0.60, y: 0.52, h: 0.22, k: 4 },
  { z: 1.78, w: 0.80, y: 0.52, h: 0.30, k: 5 },
  { z: 1.30, w: 0.90, y: 0.52, h: 0.36, k: 6 },
  { z: 0.70, w: 0.93, y: 0.53, h: 0.38, k: 6 },
  { z: 0.20, w: 0.93, y: 0.55, h: 0.39, k: 6 },
  { z: -0.30, w: 0.92, y: 0.56, h: 0.40, k: 6 },
  { z: -0.90, w: 0.92, y: 0.56, h: 0.40, k: 6 },
  { z: -1.45, w: 0.91, y: 0.55, h: 0.39, k: 5 },
  { z: -1.85, w: 0.86, y: 0.54, h: 0.36, k: 4 },
  { z: -2.05, w: 0.70, y: 0.54, h: 0.28, k: 3 },
];

/** The glasshouse, inboard and set back — a windscreen rake, not a roof box. */
const SEDAN_CABIN: Section[] = [
  { z: 0.32, w: 0.74, y: 0.88, h: 0.05, k: 3 },
  { z: -0.10, w: 0.80, y: 1.02, h: 0.20, k: 3 },
  { z: -0.75, w: 0.82, y: 1.06, h: 0.22, k: 4 },
  { z: -1.35, w: 0.78, y: 1.02, h: 0.20, k: 3 },
  { z: -1.72, w: 0.68, y: 0.90, h: 0.08, k: 3 },
];

const COMPACT_SECTIONS: Section[] = [
  { z: 1.75, w: 0.55, y: 0.5, h: 0.2, k: 4 },
  { z: 1.45, w: 0.76, y: 0.5, h: 0.28, k: 5 },
  { z: 0.95, w: 0.85, y: 0.5, h: 0.34, k: 6 },
  { z: 0.25, w: 0.87, y: 0.52, h: 0.36, k: 6 },
  { z: -0.4, w: 0.86, y: 0.53, h: 0.37, k: 6 },
  { z: -1.05, w: 0.85, y: 0.53, h: 0.36, k: 6 },
  { z: -1.5, w: 0.78, y: 0.52, h: 0.32, k: 4 },
  { z: -1.78, w: 0.62, y: 0.52, h: 0.24, k: 3 },
];

const COMPACT_CABIN: Section[] = [
  { z: 0.15, w: 0.68, y: 0.84, h: 0.05, k: 3 },
  { z: -0.25, w: 0.74, y: 0.98, h: 0.19, k: 3 },
  { z: -0.95, w: 0.75, y: 1.0, h: 0.2, k: 4 },
  { z: -1.45, w: 0.66, y: 0.9, h: 0.1, k: 3 },
];

const SPORTS_SECTIONS: Section[] = [
  { z: 2.15, w: 0.5, y: 0.42, h: 0.16, k: 4 },
  { z: 1.8, w: 0.78, y: 0.42, h: 0.24, k: 5 },
  { z: 1.2, w: 0.9, y: 0.43, h: 0.28, k: 6 },
  { z: 0.4, w: 0.93, y: 0.45, h: 0.3, k: 6 },
  { z: -0.5, w: 0.93, y: 0.45, h: 0.3, k: 6 },
  { z: -1.3, w: 0.9, y: 0.45, h: 0.28, k: 5 },
  { z: -1.9, w: 0.8, y: 0.45, h: 0.24, k: 4 },
  { z: -2.15, w: 0.6, y: 0.45, h: 0.18, k: 3 },
];

const SPORTS_CABIN: Section[] = [
  { z: 0.2, w: 0.66, y: 0.7, h: 0.04, k: 3 },
  { z: -0.3, w: 0.72, y: 0.84, h: 0.15, k: 3 },
  { z: -1.0, w: 0.7, y: 0.84, h: 0.14, k: 4 },
  { z: -1.5, w: 0.5, y: 0.72, h: 0.05, k: 3 },
];

const VAN_SECTIONS: Section[] = [
  { z: 2.2, w: 0.8, y: 0.6, h: 0.3, k: 4 },
  { z: 1.7, w: 0.98, y: 0.62, h: 0.4, k: 6 },
  { z: 1.0, w: 1.0, y: 0.68, h: 0.52, k: 8 },
  { z: 0.0, w: 1.0, y: 0.7, h: 0.56, k: 8 },
  { z: -1.0, w: 1.0, y: 0.7, h: 0.56, k: 8 },
  { z: -1.9, w: 0.98, y: 0.68, h: 0.52, k: 7 },
  { z: -2.2, w: 0.84, y: 0.64, h: 0.4, k: 4 },
];

const VAN_CABIN: Section[] = [
  { z: 1.35, w: 0.8, y: 1.1, h: 0.05, k: 3 },
  { z: 0.85, w: 0.86, y: 1.24, h: 0.22, k: 3 },
  { z: 0.0, w: 0.88, y: 1.28, h: 0.24, k: 4 },
  { z: -0.7, w: 0.86, y: 1.26, h: 0.22, k: 3 },
];

const PICKUP_SECTIONS: Section[] = [
  { z: 2.2, w: 0.62, y: 0.58, h: 0.26, k: 4 },
  { z: 1.8, w: 0.86, y: 0.58, h: 0.34, k: 5 },
  { z: 1.1, w: 0.95, y: 0.6, h: 0.4, k: 6 },
  { z: 0.3, w: 0.96, y: 0.62, h: 0.42, k: 6 },
  { z: -0.4, w: 0.96, y: 0.62, h: 0.42, k: 6 },
  { z: -1.0, w: 0.94, y: 0.6, h: 0.36, k: 5 },
  { z: -2.1, w: 0.96, y: 0.6, h: 0.34, k: 6 },
  { z: -2.2, w: 0.8, y: 0.6, h: 0.26, k: 4 },
];

const PICKUP_CABIN: Section[] = [
  { z: 0.45, w: 0.76, y: 0.98, h: 0.05, k: 3 },
  { z: 0.0, w: 0.82, y: 1.14, h: 0.2, k: 3 },
  { z: -0.7, w: 0.82, y: 1.16, h: 0.2, k: 4 },
  { z: -1.1, w: 0.72, y: 1.0, h: 0.07, k: 3 },
];

export type BodyShape = 'sedan' | 'compact' | 'sports' | 'van' | 'pickup' | 'ebike';

const SHAPES: Record<BodyShape, { body: Section[]; cabin: Section[]; scale: number; wheelR: number; axle: number; track: number; frontZ: number; rearZ: number }> = {
  sedan: { body: SEDAN_SECTIONS, cabin: SEDAN_CABIN, scale: 1, wheelR: 0.45, axle: 1.3, track: 0.82, frontZ: 2.05, rearZ: -2.05 },
  compact: { body: COMPACT_SECTIONS, cabin: COMPACT_CABIN, scale: 0.93, wheelR: 0.42, axle: 1.12, track: 0.78, frontZ: 1.75, rearZ: -1.78 },
  sports: { body: SPORTS_SECTIONS, cabin: SPORTS_CABIN, scale: 1.05, wheelR: 0.44, axle: 1.38, track: 0.84, frontZ: 2.15, rearZ: -2.15 },
  van: { body: VAN_SECTIONS, cabin: VAN_CABIN, scale: 1.02, wheelR: 0.46, axle: 1.42, track: 0.86, frontZ: 2.2, rearZ: -2.2 },
  pickup: { body: PICKUP_SECTIONS, cabin: PICKUP_CABIN, scale: 1.0, wheelR: 0.48, axle: 1.42, track: 0.88, frontZ: 2.2, rearZ: -2.2 },
  ebike: { body: [], cabin: [], scale: 1, wheelR: 0.28, axle: 0.75, track: 0.3, frontZ: 0.78, rearZ: -0.7 },
};

export interface BodyMesh {
  group: THREE.Group;
  /** Front wheels, rotated for a visual steering cue. */
  steerWheels: THREE.Object3D[];
}

/** One wheel: tyre, dished rim, five spokes, hub, brake disc. */
function wheel(r: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.TorusGeometry(r * 0.78, r * 0.24, 8, 18),
    new THREE.MeshStandardMaterial({ color: 0x131518, roughness: 0.95 }),
  );
  tyre.rotation.y = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  const rimGeo = new THREE.CylinderGeometry(r * 0.56, r * 0.56, width * 0.8, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.34, metalness: 0.82 });
  g.add(new THREE.Mesh(rimGeo, rimMat));
  const spokeGeo = new THREE.BoxGeometry(width * 0.5, r * 1.02, 0.028);
  for (let k = 0; k < 5; k++) {
    const s = new THREE.Mesh(spokeGeo, rimMat);
    s.rotation.x = (k / 5) * Math.PI;
    g.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.17, r * 0.17, width * 0.9, 8), rimMat);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.44, r * 0.44, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x6a6d72, roughness: 0.5, metalness: 0.7 }));
  disc.rotation.z = Math.PI / 2;
  disc.position.x = width * 0.2;
  g.add(disc);
  return g;
}

/**
 * Build a car body. `color` is the paint; the greenhouse is always dark glass,
 * because a car with body-coloured windows looks like a toy.
 */
export function makeCarBody(color: number, shapeId: BodyShape = 'sedan'): BodyMesh {
  const S = SHAPES[shapeId] ?? SHAPES.sedan;
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x10161c, roughness: 0.06, metalness: 0.85 });

  const bodyGeo = loft(S.body, 18);
  const body = new THREE.Mesh(bodyGeo, paint);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(loft(S.cabin, 16), glass);
  cabin.castShadow = true;
  group.add(cabin);

  // Pillars: thin body-coloured bars across the glasshouse, so the cabin reads
  // as a cabin and not a smoked bubble.
  const pillarMat = paint;
  for (const [z, w] of [[0.3, 0.76], [-0.75, 0.84], [-1.5, 0.7]] as const) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.46, w * 2), pillarMat);
    bar.position.set(0, 1.05, z);
    group.add(bar);
  }
  // Roof panel
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.07, 1.5), pillarMat);
  roof.position.set(0, 1.24, -0.55);
  group.add(roof);

  // Lights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe6b0, emissiveIntensity: 2.4 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x4a0d10, emissive: 0xff2020, emissiveIntensity: 1.8 });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), headMat);
    hl.scale.set(0.5, 0.62, 1.15);
    hl.position.set(sx * 0.46, 0.55, S.frontZ - 0.08);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.07), tailMat);
    tl.position.set(sx * 0.5, 0.6, S.rearZ + 0.06);
    group.add(tl);
    // Wing mirror
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.06), pillarMat);
    mir.position.set(sx * 0.9, 0.98, 0.3);
    group.add(mir);
  }
  // Bumpers — chrome front, dark rear. Two horizontal bands is all it takes.
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.3, metalness: 0.85 });
  const fb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.14), chrome);
  fb.position.set(0, 0.36, S.frontZ - 0.02);
  group.add(fb);
  const rb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.12), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 }));
  rb.position.set(0, 0.38, S.rearZ + 0.02);
  group.add(rb);
  // Grille
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.08), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.4 }));
  grille.position.set(0, 0.6, S.frontZ - 0.04);
  group.add(grille);

  // Wheels
  const steerWheels: THREE.Object3D[] = [];
  for (const z of [S.axle, -S.axle]) {
    for (const sx of [-1, 1]) {
      const w = wheel(S.wheelR, 0.26);
      w.position.set(sx * S.track, S.wheelR, z);
      group.add(w);
      if (z > 0) steerWheels.push(w);
    }
  }

  group.scale.setScalar(S.scale);
  return { group, steerWheels };
}
