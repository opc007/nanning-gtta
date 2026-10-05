/**
 * Nanning scenery for the single 中山路 run: bluestone carriageway, the raised
 * qilou arcade, end barriers, night-market stalls, and the lanterns over the
 * middle of the street.
 *
 * Everything static merges into one vertex-coloured mesh per category, so the
 * whole district is a handful of draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NanningCity } from './layout';
import {
  STREET_Z0,
  STREET_Z1,
  STREET_HALF,
  ARCADE_DEPTH,
  ARCADE_RAISE,
  ALLEY_WIDTH,
  MIDDLE_Z0,
  MIDDLE_Z1,
} from './layout';
import { nightMarketOpen } from './clock';
import { makeBanyanGeometry, makeSignTexture } from '../render/nnArch';
import type { ShopVisual } from '../render/modernCity';

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry =>
  mergeGeometries(parts) as THREE.BufferGeometry;

function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
};

// ── Surface textures ─────────────────────────────────────────────────────────

/** Irregular 青石板 — the grey-green bluestone paving of 中山路. */
function bluestoneTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f3336';
  g.fillRect(0, 0, S, S);
  let s = 99;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // Rows of slabs, offset every other row, each with its own value.
  const rows = 6;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 3;
    const cw = S / cols;
    const off = (r % 2) * (cw / 2);
    for (let i = -1; i <= cols; i++) {
      const x = i * cw + off;
      const v = 0.82 + rnd() * 0.36;
      const base = Math.round(58 * v);
      g.fillStyle = `rgb(${base},${Math.round(base * 1.06)},${Math.round(base * 1.0)})`;
      g.fillRect(x + 1, r * rh + 1, cw - 2, rh - 2);
      // Wear highlight
      g.fillStyle = `rgba(255,255,255,${0.015 + rnd() * 0.03})`;
      g.fillRect(x + 1, r * rh + 1, cw - 2, 2);
    }
  }
  // Damp patches
  for (let i = 0; i < 22; i++) {
    g.fillStyle = `rgba(20,26,24,${0.05 + rnd() * 0.08})`;
    g.beginPath();
    g.ellipse(rnd() * S, rnd() * S, 8 + rnd() * 26, 6 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ── 夜市 stall ───────────────────────────────────────────────────────────────

/** One market stall: canopy, poles, table, stools, and a little sign board. */
function stallGeometry(x: number, z: number, rot: number, hue: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const rotG = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
    if (rot !== 0) g.rotateY(rot);
    g.translate(x, 0, z);
    return g;
  };

  // Canopy colours: the usual red/blue/yellow plastic tarpaulin of a 夜市.
  const canopyHex = [0xd94a3d, 0x2f6fb5, 0xe0b13c, 0x3f9d6d, 0xb04a8a][Math.floor(hue * 5) % 5];
  // Canopy: two shallow sloped slabs meeting at a ridge.
  for (const s of [-1, 1]) {
    const c = new THREE.BoxGeometry(1.5, 0.07, 3.0);
    c.rotateZ(s * 0.18);
    c.translate(s * 0.7, 2.35, 0);
    parts.push(rotG(paint(c, canopyHex)));
  }
  parts.push(rotG(box(3.1, 0.1, 0.12, 0, 2.42, 0, 0xf0e6d2))); // ridge pole
  // Four corner posts
  for (const px of [-1, 1]) {
    for (const pz of [-1, 1]) {
      parts.push(rotG(box(0.08, 2.3, 0.08, px * 1.3, 1.15, pz * 1.4, 0x4a4640)));
    }
  }
  // Table + stools
  parts.push(rotG(box(2.6, 0.08, 0.8, 0, 0.9, -0.4, 0xbfae94)));
  parts.push(rotG(box(0.1, 0.9, 0.1, -1.1, 0.45, -0.4, 0x5a554e)));
  parts.push(rotG(box(0.1, 0.9, 0.1, 1.1, 0.45, -0.4, 0x5a554e)));
  for (const sx of [-1, 1]) {
    parts.push(rotG(box(0.36, 0.06, 0.36, sx * 0.9, 0.46, 0.7, 0xd8532f))); // plastic stool
    for (const lx of [-1, 1]) {
      parts.push(rotG(box(0.05, 0.45, 0.05, sx * 0.9 + lx * 0.13, 0.22, 0.7, 0xd8532f)));
    }
  }
  // Sign board above the front
  parts.push(rotG(box(1.9, 0.42, 0.06, 0, 2.85, -1.35, 0xf5e9cf)));
  return parts;
}

// ── 南宁大桥 ─────────────────────────────────────────────────────────────────

/**
 * 榕树 as one InstancedMesh. The base game's cone tree is fine for a generic
 * city; here it would be actively wrong, because the banyan canopy is the
 * defining feature of the Nanning skyline.
 */
export function addBanyans(scene: THREE.Scene, props: { x: number; z: number; rot: number }[]): void {
  if (!props.length) return;
  const { geo, mats } = makeBanyanGeometry();
  const inst = new THREE.InstancedMesh(geo, mats[0], props.length);
  inst.castShadow = true;
  inst.receiveShadow = true;
  const d = new THREE.Object3D();
  const r = mulberry(props.length);
  props.forEach((p, i) => {
    d.position.set(p.x, 0, p.z);
    // Vary scale 0.8–1.35 and yaw so a row of banyans doesn't clone.
    const s = 0.62 + r() * 0.34;
    d.scale.set(s, s * (0.9 + r() * 0.35), s);
    d.rotation.set(0, p.rot, 0);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
  });
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StreetScenery {
  /** Night-market group. Hidden before 18:00. */
  stalls: THREE.Group;
  stallMeshes: Map<number, ShopVisual>;
  /** Stall signboards: opaque, ramped by colour like the shop fascia signs. */
  signMats: THREE.MeshBasicMaterial[];
}

const COL_H = 3.15;

function arcadeSlabs(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const y = ARCADE_RAISE / 2;
  const h = ARCADE_RAISE;
  const span = (z0: number, z1: number, side: -1 | 1): void => {
    const cx = side * (STREET_HALF + ARCADE_DEPTH / 2);
    parts.push(box(ARCADE_DEPTH, h, z1 - z0, cx, y, (z0 + z1) / 2, 0x6d7370));
    // Lip at the carriageway edge so the 15 cm step reads from the street.
    parts.push(box(0.08, h, z1 - z0, side * STREET_HALF, y, (z0 + z1) / 2, 0x8a8478));
    // Ceiling, then the upper floors that actually cover the walkway.
    parts.push(box(ARCADE_DEPTH + 0.12, 0.22, z1 - z0, cx, COL_H, (z0 + z1) / 2, 0x7c756c));
    parts.push(box(ARCADE_DEPTH, 3.5, z1 - z0, cx - side * 0.04, COL_H + 0.22 + 1.75, (z0 + z1) / 2, 0x8a8680));
    parts.push(box(ARCADE_DEPTH + 0.2, 0.35, z1 - z0, cx, COL_H + 3.9, (z0 + z1) / 2, 0x5e4130));
  };
  span(STREET_Z0, STREET_Z1, 1);
  // West arcade is broken by the alley mouth.
  span(STREET_Z0, -ALLEY_WIDTH / 2, -1);
  span(ALLEY_WIDTH / 2, STREET_Z1, -1);
  return parts;
}

function columnRun(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const step = 4.4;
  for (let z = STREET_Z0 + 1.2; z < STREET_Z1 - 0.6; z += step) {
    for (const side of [-1, 1] as const) {
      if (side < 0 && Math.abs(z) < ALLEY_WIDTH / 2 + 0.4) continue;
      const x = side * STREET_HALF;
      parts.push(box(0.32, COL_H, 0.32, x, COL_H / 2, z, 0x9c968b));
      parts.push(box(0.48, 0.16, 0.48, x, COL_H - 0.08, z, 0xb7b1a6));
    }
  }
  return parts;
}

function barrierRun(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [STREET_Z0 - 0.2, STREET_Z1 + 0.2]) {
    parts.push(box(36, 0.08, 0.08, 0, 0.95, z, 0xd5d8de));
    parts.push(box(36, 0.08, 0.08, 0, 0.55, z, 0xd5d8de));
    for (let x = -16; x <= 16; x += 2.4) {
      parts.push(box(0.08, 1.15, 0.08, x, 0.58, z, 0x9aa0a8));
    }
  }
  return parts;
}

function alleyClutter(city: NanningCity): THREE.BufferGeometry[] {
  const a = city.alley;
  const parts: THREE.BufferGeometry[] = [];
  // Bins and a dead-end wall, so the alley reads as a place and not a gap.
  parts.push(box(0.35, 2.4, ALLEY_WIDTH, a.minX, 1.2, 0, 0x5c5852));
  parts.push(box(0.7, 0.9, 0.55, a.cx, 0.45, -0.7, 0x2f6a3a));
  parts.push(box(0.7, 0.9, 0.55, a.cx - 1.2, 0.45, 0.6, 0x2a3f55));
  return parts;
}

function stallVisuals(
  city: NanningCity,
  parent: THREE.Group,
): { meshes: Map<number, ShopVisual>; signMats: THREE.MeshBasicMaterial[] } {
  const map = new Map<number, ShopVisual>();
  const signMats: THREE.MeshBasicMaterial[] = [];
  for (const unit of city.shops) {
    if (!unit.nightOnly) continue;
    const glass = new THREE.MeshStandardMaterial({
      color: 0x1b2228,
      emissive: 0xffb768,
      emissiveIntensity: 0,
      roughness: 0.4,
    });
    const signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(unit.def), toneMapped: false });
    signMat.userData.dayK = 0.55;
    signMat.userData.nightK = 0.85;
    signMat.userData.shopDriven = true;
    signMats.push(signMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.4), signMat);
    // Face the middle of the street. Plane normal +Z, so ±π/2 turns it onto ±X.
    const face = unit.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    sign.position.set(unit.x, 2.15, unit.z);
    sign.rotation.y = face;
    parent.add(sign);
    const neonMat = new THREE.MeshBasicMaterial({
      color: unit.def.signColor,
      toneMapped: false,
      transparent: true,
      opacity: 0.9,
    });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.06), neonMat);
    neon.position.set(unit.x, 1.88, unit.z);
    neon.rotation.y = face;
    parent.add(neon);
    map.set(unit.building, { sign, signMat, neon: neonMat, glass, litMats: [neonMat] });
  }
  return { meshes: map, signMats };
}

/**
 * Storefront signboards on the qilou facade itself.
 *
 * The arcade, the columns and the stall boards were all here already; what was
 * missing was the one thing that makes the street read as 中山路 rather than as
 * a generic covered walkway — the shop's name over its own door. 复记老友粉,
 * 中山粉饺, 阿光豆浆油条, all of it was in the data and none of it was on a wall.
 *
 * Placed above the 3.3 m overhang so the covered walkway stays walkable, sized
 * off the unit's real frontage, and keyed by building so the shop system can
 * swap in the "砸烂咗" texture when the player trashes the place.
 */
function facadeSigns(
  city: NanningCity,
  parent: THREE.Group,
): { meshes: Map<number, ShopVisual>; signMats: THREE.MeshBasicMaterial[] } {
  const map = new Map<number, ShopVisual>();
  const signMats: THREE.MeshBasicMaterial[] = [];
  for (const unit of city.shops) {
    if (unit.nightOnly) continue; // stalls already carry their own board
    const signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(unit.def), toneMapped: false });
    // Daytime boards are painted, not lit: keep them close to full colour so the
    // name stays readable, and let the night ramp take them the rest of the way.
    signMat.userData.dayK = 0.88;
    signMat.userData.nightK = 1.0;
    signMat.userData.shopDriven = true;
    signMats.push(signMat);
    // Shopfronts stay open through the day, so their interior light is on from
    // dawn rather than ramping with the night market.
    const glass = new THREE.MeshStandardMaterial({
      color: 0x1b2228,
      emissive: 0xffb768,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    });

    const w = Math.max(1.8, Math.min(unit.width - 0.7, 5.2));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.25), signMat);
    // Face the middle of the street. Plane normal +Z, so ±π/2 turns it onto ±X.
    const face = unit.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    // Nudge proud of the facade along its own normal so it never z-fights.
    sign.position.set(unit.x + unit.nx * 0.35, 3.02, unit.z + unit.nz * 0.35);
    sign.rotation.y = face;
    parent.add(sign);

    // Neon underline, the strip that carries the shop colour after dark.
    const neonMat = new THREE.MeshBasicMaterial({
      color: unit.def.signColor,
      toneMapped: false,
      transparent: true,
      opacity: 0.9,
    });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, 0.07), neonMat);
    neon.position.set(unit.x + unit.nx * 0.37, 2.74, unit.z + unit.nz * 0.37);
    neon.rotation.y = face;
    parent.add(neon);

    map.set(unit.building, { sign, signMat, neon: neonMat, glass, litMats: [neonMat] });
  }
  return { meshes: map, signMats };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function addNanningScenery(scene: THREE.Scene, city: NanningCity): StreetScenery {
  const stoneTex = bluestoneTexture();
  const TINT: Record<string, number | null> = { bluestone: null, asphalt: 0x22242a, plaza: 0xbfb8a8, riverside: 0xa8a396 };
  for (const q of city.surfaceQuads) {
    let material: THREE.MeshStandardMaterial;
    const tint = TINT[q.kind];
    if (tint !== null && tint !== undefined) {
      material = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.98 });
    } else {
      const t = stoneTex.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(q.w / 6, q.d / 6);
      material = new THREE.MeshStandardMaterial({
        map: t,
        color: 0xffffff,
        roughness: 0.93,
        metalness: 0.02,
      });
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(q.w, q.d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(q.x, q.kind === 'bluestone' && Math.abs(q.x) > 1 ? 0.02 : 0.04, q.z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const dress = new THREE.Mesh(
    merge([...arcadeSlabs(), ...columnRun(), ...barrierRun(), ...alleyClutter(city)]),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.04 }),
  );
  dress.castShadow = true;
  dress.receiveShadow = true;
  scene.add(dress);

  const stallRoot = new THREE.Group();
  stallRoot.name = 'nn-stalls';
  if (city.stalls.length) {
    const parts: THREE.BufferGeometry[] = [];
    for (const s of city.stalls) parts.push(...stallGeometry(s.x, s.z, s.rot, s.hue));
    const mesh = new THREE.Mesh(
      merge(parts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    stallRoot.add(mesh);
  }
  const { meshes: stallMeshes, signMats: stallSignMats } = stallVisuals(city, stallRoot);
  scene.add(stallRoot);

  // Storefront boards go in their own root, NOT in stallRoot: the session hides
  // the stall group until 18:00, and these have to be readable at noon.
  const signRoot = new THREE.Group();
  signRoot.name = 'nn-facade-signs';
  const { meshes: facadeMeshes, signMats: facadeSignMats } = facadeSigns(city, signRoot);
  for (const [k, v] of facadeMeshes) stallMeshes.set(k, v);
  scene.add(signRoot);

  addLanterns(scene);
  return { stalls: stallRoot, stallMeshes, signMats: [...stallSignMats, ...facadeSignMats] };
}

function addLanterns(scene: THREE.Scene): void {
  const LANTERN_HUES = [0xf3e3c2, 0xf0c9c2, 0xd8c4e2, 0xe8d7a8, 0xdfa9a0, 0xf6efe0];
  const lanternGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.02, 0),
      new THREE.Vector2(0.14, 0.08),
      new THREE.Vector2(0.2, 0.26),
      new THREE.Vector2(0.2, 0.44),
      new THREE.Vector2(0.14, 0.62),
      new THREE.Vector2(0.02, 0.7),
    ],
    8,
  );
  const tasselGeo = new THREE.CylinderGeometry(0.018, 0.005, 0.28, 4);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x141414 });
  const MAX_L = 160;
  const lanternMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const bodyI = new THREE.InstancedMesh(lanternGeo, lanternMat, MAX_L);
  const tasselI = new THREE.InstancedMesh(tasselGeo, lanternMat, MAX_L);
  bodyI.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_L * 3), 3);
  tasselI.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_L * 3), 3);
  bodyI.frustumCulled = tasselI.frustumCulled = false;
  const ldum = new THREE.Object3D();
  const lcol = new THREE.Color();
  let li = 0;
  let lseed = 5;
  const lrnd = (): number => {
    lseed = (lseed * 1664525 + 1013904223) >>> 0;
    return lseed / 4294967296;
  };
  const addLantern = (x: number, y: number, z: number, sc: number): void => {
    if (li >= MAX_L) return;
    ldum.position.set(x, y, z);
    ldum.scale.setScalar(sc);
    ldum.rotation.set(0, 0, 0);
    ldum.updateMatrix();
    bodyI.setMatrixAt(li, ldum.matrix);
    ldum.position.set(x, y - 0.72 * sc, z);
    ldum.updateMatrix();
    tasselI.setMatrixAt(li, ldum.matrix);
    lcol.setHex(LANTERN_HUES[Math.floor(lrnd() * LANTERN_HUES.length)]);
    bodyI.setColorAt(li, lcol);
    tasselI.setColorAt(li, lcol);
    li++;
  };

  // Garlands across the night-market stretch only.
  const lines = 8;
  for (let line = 0; line < lines; line++) {
    const z = MIDDLE_Z0 + 8 + ((MIDDLE_Z1 - MIDDLE_Z0 - 16) * line) / (lines - 1);
    const pts: THREE.Vector3[] = [];
    const sag = 0.7;
    const y0 = 5.4;
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = -(STREET_HALF + 1.2) + t * (STREET_HALF * 2 + 2.4);
      pts.push(new THREE.Vector3(x, y0 - Math.sin(t * Math.PI) * sag, z));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
    for (let i = 1; i < n; i++) {
      const p = pts[i];
      addLantern(p.x, p.y - 0.55, p.z, 0.55 + lrnd() * 0.25);
    }
  }

  bodyI.count = tasselI.count = li;
  bodyI.instanceMatrix.needsUpdate = tasselI.instanceMatrix.needsUpdate = true;
  if (bodyI.instanceColor) bodyI.instanceColor.needsUpdate = true;
  if (tasselI.instanceColor) tasselI.instanceColor.needsUpdate = true;
  scene.add(bodyI, tasselI);
}

/**
 * Show or hide the night market. `hour` is 0–24 from the game clock.
 */
export function updateNanningScenery(scene: THREE.Scene, hour: number, _daylight: number): void {
  const stalls = scene.getObjectByName('nn-stalls');
  if (stalls) stalls.visible = nightMarketOpen(hour);
}

