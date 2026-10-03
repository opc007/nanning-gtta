/**
 * Nanning scenery: the things a city generator can't infer. Ground surfaces
 * (青石板 bluestone vs asphalt), 邕江, the 南宁大桥 crossing, the 夜市 stall
 * rows, and the string lights that make the night market glow.
 *
 * Everything static merges into one vertex-coloured mesh per category, so the
 * whole district is a handful of draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NanningCity } from './layout';
import { RIVER_Z, BRIDGE_Z0, BRIDGE_Z1, MAP_HALF } from './layout';
import { makeBanyanGeometry } from '../render/nnArch';

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

/** Water surface: banded ripples that scroll, cheap but reads as moving water. */
function waterTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d2a2e';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 180; i++) {
    const y = Math.random() * S;
    const x = Math.random() * S;
    const w = 12 + Math.random() * 60;
    g.strokeStyle = `rgba(150,210,215,${0.03 + Math.random() * 0.08})`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w / 2, y + (Math.random() - 0.5) * 6, x + w, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
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
 * The bridge is the one thing in the map you can drive across, so it needs to
 * read as a bridge from a distance: a white deck, twin arch ribs, and a
 * cross-braced portal. Built from a Catmull-Rom tube for the arch so it curves
 * like the real span rather than reading as a box.
 */
function bridgeGroup(): THREE.Group {
  const g = new THREE.Group();
  const span = BRIDGE_Z1 - BRIDGE_Z0;
  const zc = (BRIDGE_Z0 + BRIDGE_Z1) / 2;
  const DECK_W = 20;

  const white = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.6, metalness: 0.1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.45, metalness: 0.5 });
  const road = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.95 });

  const deck = new THREE.Mesh(new THREE.BoxGeometry(DECK_W, 1.1, span), white);
  deck.position.set(0, -0.55, zc);
  deck.receiveShadow = true;
  g.add(deck);

  const roadTop = new THREE.Mesh(new THREE.PlaneGeometry(17, span), road);
  roadTop.rotation.x = -Math.PI / 2;
  roadTop.position.set(0, 0.01, zc);
  g.add(roadTop);

  // Twin arch ribs, one each side of the deck, rising 34 m at the crown.
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    const RISE = 34;
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const z = BRIDGE_Z0 + t * span;
      // Segmental parabola — a real arch, not a semicircle.
      const y = RISE * (1 - Math.pow((t - 0.5) * 2, 2));
      pts.push(new THREE.Vector3(side * 9.4, Math.max(0, y), z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.85, 8, false), steel);
    g.add(tube);
    // Hangers
    for (let i = 2; i < N - 1; i += 3) {
      const p = pts[i];
      if (p.y < 3) continue;
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, p.y, 6), steel);
      h.position.set(side * 9.4, p.y / 2, p.z);
      g.add(h);
    }
  }

  // Cross bracing between the ribs at deck level
  for (let i = 0; i <= 10; i++) {
    const z = BRIDGE_Z0 + (i / 10) * span;
    const b = new THREE.Mesh(new THREE.BoxGeometry(18.8, 0.7, 0.7), steel);
    b.position.set(0, 0.4, z);
    g.add(b);
  }

  // Railings
  for (const side of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, span), white);
    r.position.set(side * 10, 0.6, zc);
    g.add(r);
  }

  // Piers
  for (const z of [BRIDGE_Z0 + span * 0.3, BRIDGE_Z0 + span * 0.7]) {
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 7, 10), white);
      p.position.set(side * 7, -3.4, z);
      g.add(p);
    }
  }

  return g;
}


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

// ── Entry point ──────────────────────────────────────────────────────────────

export function addNanningScenery(scene: THREE.Scene, city: NanningCity): void {
  // ── Ground surfaces ───────────────────────────────────────────────────
  const stoneTex = bluestoneTexture();
  const TINT: Record<string, number | null> = { bluestone: null, asphalt: 0x22242a, plaza: 0xbfb8a8, riverside: 0xa8a396 };
  for (const q of city.surfaceQuads) {
    let mat: THREE.MeshStandardMaterial;
    if (TINT[q.kind] !== null && TINT[q.kind] !== undefined) {
      mat = new THREE.MeshStandardMaterial({ color: TINT[q.kind]!, roughness: 0.98 });
    } else {
      // Fresh texture clone per patch: the tiling must follow each quad's real
      // size, and sharing one repeat across differently-sized quads stretches it.
      const t = stoneTex.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(q.w / 6, q.d / 6);
      mat = new THREE.MeshStandardMaterial({
        map: t,
        color: TINT[q.kind] ?? 0xffffff,
        roughness: 0.93,
        metalness: 0.02,
      });
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(q.w, q.d), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(q.x, 0.03, q.z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ── 邕江 ──────────────────────────────────────────────────────────────
  const wTex = waterTexture();
  wTex.repeat.set(24, 24);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2.4, 320),
    new THREE.MeshStandardMaterial({
      map: wTex,
      color: 0x2c5a5e,
      roughness: 0.16,
      metalness: 0.62,
      transparent: true,
      opacity: 0.95,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.35, RIVER_Z + 160);
  scene.add(water);
  // Scroll the ripples so the river reads as moving even when the camera is still.
  const waterMat = water.material as THREE.MeshStandardMaterial;
  const wm = waterMat.map as THREE.Texture;
  window.setInterval(() => {
    wm.offset.y = (wm.offset.y - 0.0025) % 1;
    wm.offset.x = (wm.offset.x + 0.0012) % 1;
  }, 40);
  // Emissive sheen on the water at night — the 邕江夜游 look.
  const sheen = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2.4, 320),
    new THREE.MeshBasicMaterial({ color: 0x1a4a52, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.set(0, -0.3, RIVER_Z + 160);
  scene.add(sheen);

  // River bank walls so you can't wade out
  scene.add(bridgeGroup());

  // ── 夜市 stalls ───────────────────────────────────────────────────────
  if (city.stalls.length) {
    const parts: THREE.BufferGeometry[] = [];
    for (const s of city.stalls) parts.push(...stallGeometry(s.x, s.z, s.rot, s.hue));
    const mesh = new THREE.Mesh(
      merge(parts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ── 百叶纸灯笼 garlands over the night market ──────────────────────────
  // The reference photo is unmistakable: ribbed paper lanterns in cream, pink,
  // purple and stripe, on sagging wires across the alley. These are the single
  // strongest night read of the whole district, so they are real geometry (an
  // emissive lathe shape) rather than the generic bulbs the base game used.
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
    9,
  );
  const wireMat = new THREE.LineBasicMaterial({ color: 0x141414 });
  const bulbs: THREE.Mesh[] = [];
  let lseed = 5;
  const lrnd = (): number => {
    lseed = (lseed * 1664525 + 1013904223) >>> 0;
    return lseed / 4294967296;
  };

  for (let line = 0; line < 9; line++) {
    const z = -46 + line * 7.5;
    const pts: THREE.Vector3[] = [];
    const sag = 1.3 + lrnd() * 0.7;
    const y0 = 5.6 + lrnd() * 0.7;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = -10.5 + t * 21;
      pts.push(new THREE.Vector3(x, y0 - Math.sin(t * Math.PI) * sag, z));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));

    for (let i = 1; i < 14; i++) {
      const p = pts[i];
      const m = new THREE.MeshBasicMaterial({
        color: LANTERN_HUES[Math.floor(lrnd() * LANTERN_HUES.length)],
        toneMapped: false,
      });
      const l = new THREE.Mesh(lanternGeo, m);
      const sc = 0.72 + lrnd() * 0.4;
      l.scale.setScalar(sc);
      l.position.set(p.x + (lrnd() - 0.5) * 0.5, p.y - 0.82 * sc, p.z + (lrnd() - 0.5) * 0.5);
      l.rotation.y = lrnd() * Math.PI;
      scene.add(l);
      bulbs.push(l);
      // Tassel
      const t = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.005, 0.3, 4),
        new THREE.MeshBasicMaterial({ color: 0xb03a2a }),
      );
      t.position.set(l.position.x, l.position.y - 0.78 * sc - 0.15, l.position.z);
      scene.add(t);
    }
  }

  // A second, sparser set down the 三街两巷 lanes, where the reference photo
  // shows the same garlands over a much narrower alley.
  for (const lz of [-70, -96]) {
    for (let line = 0; line < 4; line++) {
      const x = -20 - line * 13;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(new THREE.Vector3(x, 5.2 - Math.sin(t * Math.PI) * 0.9, lz - 6 + t * 12));
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
      for (let i = 1; i < 8; i++) {
        const p = pts[i];
        const m = new THREE.MeshBasicMaterial({
          color: LANTERN_HUES[Math.floor(lrnd() * LANTERN_HUES.length)],
          toneMapped: false,
        });
        const l = new THREE.Mesh(lanternGeo, m);
        l.scale.setScalar(0.6 + lrnd() * 0.25);
        l.position.set(p.x, p.y - 0.7, p.z);
        scene.add(l);
        bulbs.push(l);
      }
    }
  }

  // Gentle flicker — a cheap sine per lantern, offset by index so they don't
  // pulse in lockstep like a disco.
  const baseIntensity = bulbs.map(() => 0.7 + Math.random() * 0.3);
  scene.userData.bulbs = bulbs;
  scene.userData.bulbPhase = bulbs.map((_, i) => i * 0.7);
  scene.userData.bulbBase = baseIntensity;
}

/** Called every frame from the main loop for the animated bits. */
export function updateNanningScenery(scene: THREE.Scene, t: number, daylight: number): void {
  const bulbs = scene.userData.bulbs as THREE.Mesh[] | undefined;
  const phase = scene.userData.bulbPhase as number[] | undefined;
  const base = scene.userData.bulbBase as number[] | undefined;
  if (bulbs && phase && base) {
    for (let i = 0; i < bulbs.length; i++) {
      const m = bulbs[i].material as THREE.MeshBasicMaterial;
      const k = base[i] * (0.72 + 0.28 * Math.sin(t * 2.1 + phase[i])) * (1 - daylight * 0.92);
      m.color.setScalar(1).multiplyScalar(Math.max(0.12, k));
    }
  }
}
