/**
 * Nanning architecture, rebuilt from the 实拍 reference set.
 *
 * The photos corrected an earlier assumption: 邕州古城 is NOT a 1920s 南洋骑楼
 * arcade. It is 岭南明清砖木 — grey 青砖 walls, white plaster string courses,
 * 满洲窗 coloured glass, a cantilevered shopfront awning carried on dark 牛腿
 * brackets, and the stepped 山墙 parapet that does most of the skyline work.
 *
 * The second reference set (机械厂 / 新桂路1952 文创园) is a completely different
 * material vocabulary: red brick, sawtooth factory roofs, safety-yellow steel
 * staircases, industrial multi-pane windows. Keeping the two districts apart
 * visually is what stops the map reading as one generic "old China" block.
 *
 * Everything static merges per building into one vertex-coloured geometry, so a
 * 60-unit street is a few draw calls rather than a few thousand.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NanningBuilding } from '../nanning/layout';
import type { ShopDef } from '../nanning/data';

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

// ── Palette lifted off the reference photos ─────────────────────────────────
export const C = {
  qingzhuan: 0x646b73, // 青砖 grey-blue brick
  qingzhuanLo: 0x4e555c,
  plaster: 0xe4e0d6, // white plaster string courses + parapet panels
  plasterLo: 0xcfc9bc,
  stone: 0x9a958b, // granite plinth / paving kerb
  timber: 0x4a3427, // 牛腿 brackets, exposed rafters
  timberLo: 0x33241b,
  tile: 0x35373a, // 小青瓦 roof
  railBlack: 0x1c1c1e, // 挂壁灯笼 frames, balcony railings
  glassWarm: 0xffd9a0,
  // 机械厂文创园
  redBrick: 0x8e3d30,
  redBrickLo: 0x6e2e25,
  whiteBrick: 0xe8e4dc,
  safetyYellow: 0xe8a317,
  burgundy: 0xa83b3b,
  steelBlack: 0x24262a,
  industrialGlass: 0x46505a,
};

export interface ArchMesh {
  group: THREE.Group;
  sign: THREE.Mesh | null;
  signMat: THREE.MeshBasicMaterial | null;
  manzhouMat: THREE.MeshStandardMaterial | null;
  neonMat: THREE.MeshBasicMaterial | null;
  /** Wall lanterns: emissive, so they need the day/night ramp. */
  lanternMats: THREE.MeshBasicMaterial[];
  /** Set once the shop is trashed so the day/night ramp stops re-lighting it. */
  brokenManzhou?: number;
}

// ── Procedural textures ─────────────────────────────────────────────────────

/** 满洲窗: timber frame, grid of coloured panes. The face of the whole street. */
export function makeManzhouWindowTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  const g = c.getContext('2d')!;
  const palette = ['#c8342b', '#2e7d5b', '#2a5fa8', '#d9902b', '#7a3f9e', '#c8a33a'];
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  g.fillStyle = '#3a2a1c';
  g.fillRect(0, 0, 192, 128);
  const cols = 4;
  const rows = 3;
  const m = 6;
  const cw = (192 - m * 2) / cols;
  const ch = (128 - m * 2) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      g.fillStyle = palette[Math.floor(rnd() * palette.length)];
      g.globalAlpha = 0.5 + rnd() * 0.5;
      g.fillRect(m + i * cw + 2, m + j * ch + 2, cw - 4, ch - 4);
      g.globalAlpha = 0.4;
      g.fillStyle = '#f2e2b8';
      g.beginPath();
      g.ellipse(m + i * cw + cw / 2, m + j * ch + ch / 2, cw * 0.16, ch * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#33251a';
  g.lineWidth = 4;
  for (let i = 0; i <= cols; i++) {
    g.beginPath();
    g.moveTo(m + i * cw, 0);
    g.lineTo(m + i * cw, 128);
    g.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    g.beginPath();
    g.moveTo(0, m + j * ch);
    g.lineTo(192, m + j * ch);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Shop signboard: name on its brand colour, or a wrecked board after smashing. */
export function makeSignTexture(shop: ShopDef, broken = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(shop.signColor);
  let s = 7;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  if (broken) {
    g.fillStyle = '#17130f';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#3a2a22';
    g.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      g.beginPath();
      g.moveTo(256, 64);
      g.lineTo(256 + (rnd() - 0.5) * 470, 64 + (rnd() - 0.5) * 230);
      g.stroke();
    }
    g.fillStyle = '#5c4b40';
    g.font = 'bold 58px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('砸 烂 咗', 256, 68);
  } else {
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, `#${col.clone().multiplyScalar(1.3).getHexString()}`);
    grad.addColorStop(1, `#${col.clone().multiplyScalar(0.5).getHexString()}`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = 'rgba(255,238,200,0.85)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 506, 122);
    let size = 74;
    g.font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    while (g.measureText(shop.name).width > 462 && size > 24) {
      size -= 3;
      g.font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff6e0';
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 9;
    g.fillText(shop.name, 256, 68);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ── 岭南砖木 shop-house ─────────────────────────────────────────────────────

const GROUND_H = 3.7; // shopfront height, awning sits on top of it
const AWNING_D = 2.4; // how far the awning reaches over the walkway
const AWNING_Y = GROUND_H;

export function makeLingnan(b: NanningBuilding, idx: number, shop: ShopDef | undefined): ArchMesh {
  const group = new THREE.Group();
  const W = b.depth; // frontage
  const D = b.width; // depth inland
  const H = b.height;
  const halfW = W / 2;
  const parts: THREE.BufferGeometry[] = [];

  const brick = b.color || C.qingzhuan;
  const brickLo = new THREE.Color(brick).multiplyScalar(0.78).getHex();

  // ── Stone plinth + shopfront ──────────────────────────────────────────
  parts.push(box(D, 0.5, W, D / 2, 0.25, 0, C.stone));
  // Recessed shopfront: dark timber frame + glazing, set back 0.5 m.
  parts.push(box(0.35, GROUND_H - 0.5, W, D - 0.25, 0.5 + (GROUND_H - 0.5) / 2, 0, brickLo));
  parts.push(box(0.12, GROUND_H - 0.9, W - 0.7, 0.62, 0.7 + (GROUND_H - 0.9) / 2, 0, 0x2a2e33));
  // Door + window mullions
  parts.push(box(0.1, GROUND_H - 0.5, 0.1, 0.55, 0.5 + (GROUND_H - 0.5) / 2, 0, C.timber));

  // ── 牛腿 brackets + cantilevered awning ───────────────────────────────
  // Dark timber brackets stepping out from the wall to carry the awning.
  const bracketZ = W > 8 ? [-halfW + 0.5, 0, halfW - 0.5] : [-halfW + 0.6, halfW - 0.6];
  for (const bz of bracketZ) {
    parts.push(box(0.22, 0.22, 0.22, AWNING_D * 0.75, AWNING_Y - 0.5, bz, C.timber));
    parts.push(box(0.18, 0.18, 0.18, AWNING_D * 0.45, AWNING_Y - 0.95, bz, C.timber));
  }
  // Awning slab, sloping out and down, cream like the reference shopfront.
  const aw = new THREE.BoxGeometry(AWNING_D, 0.16, W);
  aw.rotateZ(-0.07);
  aw.translate(AWNING_D / 2 - 0.1, AWNING_Y - 0.2, 0);
  parts.push(paint(aw, C.plaster));
  // Exposed rafters underneath — the detail that sells it in the photos.
  const rafters = Math.max(3, Math.floor(W / 0.85));
  for (let i = 0; i <= rafters; i++) {
    const rz = -halfW + (i * W) / rafters;
    parts.push(box(AWNING_D, 0.12, 0.1, AWNING_D / 2 - 0.1, AWNING_Y - 0.34, rz, C.timberLo));
  }
  parts.push(box(0.16, 0.3, W, 0.05, AWNING_Y - 0.3, 0, C.timber));

  // ── Upper mass ────────────────────────────────────────────────────────
  const upperH = H - GROUND_H;
  const upperY = GROUND_H;
  parts.push(box(D, upperH, W, D / 2, upperY + upperH / 2, 0, brick));

  // White plaster string course between every storey + a white base band.
  const floors = Math.max(1, b.floors ?? 2);
  for (let f = 1; f <= floors; f++) {
    const y = upperY + (upperH * f) / (floors + 0.001);
    parts.push(box(D + 0.22, 0.26, W + 0.22, D / 2, Math.min(y, H - 0.2), 0, C.plaster));
  }
  parts.push(box(D + 0.3, 0.34, W + 0.3, D / 2, GROUND_H + 0.17, 0, C.plaster));

  // White 罗马柱 pilasters on the front corners.
  for (const sz of [-1, 1]) {
    parts.push(box(0.5, upperH - 0.2, 0.5, 0.25, upperY + upperH / 2, sz * (halfW - 0.3), C.plasterLo));
  }

  // ── 阶梯山墙 stepped gable parapet ────────────────────────────────────
  // Three steps up to the centre, each capped in white. This silhouette is the
  // single most recognisable thing in 桂花公社 / 三街两巷.
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const inset = 0.55 * (i + 1);
    const sw = W - inset * 2;
    if (sw < 1.2) break;
    const sh = 0.55;
    const sy = H + sh / 2 + i * sh;
    parts.push(box(0.6, sh, sw, 0.3, sy, 0, brick));
    parts.push(box(0.78, 0.14, sw + 0.1, 0.3, sy + sh / 2 + 0.07, 0, C.plaster));
  }
  // Dark tile cap behind the parapet.
  parts.push(box(D - 0.3, 0.3, W - 0.1, D / 2, H - 0.05, 0, C.tile));

  const mass = new THREE.Mesh(
    merge(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }),
  );
  mass.castShadow = true;
  mass.receiveShadow = true;
  group.add(mass);

  // ── 满洲窗 band on the top storey ─────────────────────────────────────
  const winTex = makeManzhouWindowTexture(idx * 7919 + 13);
  const manzhouMat = new THREE.MeshStandardMaterial({
    map: winTex,
    emissiveMap: winTex,
    emissive: 0xffffff,
    emissiveIntensity: 0.2,
    roughness: 0.22,
    metalness: 0.1,
  });
  const bandY = H - 1.55;
  const bandGeo = new THREE.PlaneGeometry(W - 1.2, 1.35);
  for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(bandGeo, manzhouMat);
    w.position.set(-0.03, bandY, sz * (W * 0.26));
    w.rotation.y = -Math.PI / 2;
    group.add(w);
  }
  // Plain white-framed windows on the middle storeys.
  const winMat = new THREE.MeshStandardMaterial({ color: 0x2f3439, emissive: 0xffcf8a, emissiveIntensity: 0.15, roughness: 0.3 });
  const winGeo = new THREE.PlaneGeometry(1.25, 1.6);
  for (let f = 0; f < floors - 1; f++) {
    const y = upperY + 1.9 + f * (upperH / floors);
    if (y > H - 2.4) break;
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(winGeo, winMat);
      w.position.set(-0.03, y, sz * (W * 0.3));
      w.rotation.y = -Math.PI / 2;
      group.add(w);
      // White reveal
      const rev = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.9), new THREE.MeshStandardMaterial({ color: C.plaster }));
      rev.position.set(-0.05, y, sz * (W * 0.3));
      rev.rotation.y = -Math.PI / 2;
      group.add(rev);
    }
  }

  // ── 挂壁灯笼: the warm points that carry the night street ─────────────
  const lanternMats: THREE.MeshBasicMaterial[] = [];
  const lanternGeo = new THREE.BoxGeometry(0.22, 0.46, 0.22);
  const lanternArm = new THREE.BoxGeometry(0.5, 0.06, 0.06);
  for (const sz of [-1, 1]) {
    const m = new THREE.MeshBasicMaterial({ color: C.glassWarm, toneMapped: false });
    lanternMats.push(m);
    const arm = new THREE.Mesh(lanternArm, new THREE.MeshBasicMaterial({ color: C.railBlack }));
    arm.position.set(0.3, AWNING_Y - 0.75, sz * (halfW - 0.55));
    group.add(arm);
    const l = new THREE.Mesh(lanternGeo, m);
    l.position.set(0.55, AWNING_Y - 1.05, sz * (halfW - 0.55));
    group.add(l);
  }

  // ── Signboard under the awning ───────────────────────────────────────
  let sign: THREE.Mesh | null = null;
  let signMat: THREE.MeshBasicMaterial | null = null;
  let neonMat: THREE.MeshBasicMaterial | null = null;
  if (shop) {
    signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(shop), toneMapped: false });
    const sw = Math.min(W - 0.9, 5.0);
    sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.25), signMat);
    sign.position.set(AWNING_D * 0.55, AWNING_Y - 0.95, 0);
    sign.rotation.y = -Math.PI / 2;
    group.add(sign);

    // Neon strip along the underside of the awning.
    neonMat = new THREE.MeshBasicMaterial({ color: shop.signColor, toneMapped: false, transparent: true, opacity: 0.9 });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.6, 0.14), neonMat);
    neon.position.set(AWNING_D * 0.72, AWNING_Y - 0.42, 0);
    neon.rotation.set(0, -Math.PI / 2, 0);
    neon.rotation.x = Math.PI / 2;
    group.add(neon);

    // Floor glow in the doorway.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 1.2),
      new THREE.MeshBasicMaterial({ color: shop.signColor, toneMapped: false, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0.9, 0.05, 0);
    group.add(glow);
  }

  const side = Math.sign(b.cx) || 1;
  group.position.set(b.cx, 0, b.cz);
  group.rotation.y = side < 0 ? Math.PI : 0;
  return { group, sign, signMat, manzhouMat, neonMat, lanternMats };
}

// ── 机械厂文创园 factory shed ───────────────────────────────────────────────

export function makeFactory(b: NanningBuilding): THREE.Group {
  const g = new THREE.Group();
  const W = b.width; // frontage
  const D = b.depth; // depth
  const H = b.height;
  const halfW = W / 2;
  const parts: THREE.BufferGeometry[] = [];

  const brick = b.color || C.redBrick;
  parts.push(box(D, 0.6, W, D / 2, 0.3, 0, C.steelBlack)); // plinth
  parts.push(box(D, H, W, D / 2, 0.6 + H / 2, 0, brick));
  // Black steel pilasters, the structural rhythm of the reference sheds.
  const bays = Math.max(2, Math.floor(W / 5));
  for (let i = 0; i <= bays; i++) {
    const bz = -halfW + (i * W) / bays;
    parts.push(box(0.35, H, 0.45, 0.1, 0.6 + H / 2, bz, C.steelBlack));
  }
  // Sawtooth (锯齿形) roof — a run of north-light sheds, the giveaway silhouette.
  const teeth = Math.max(2, Math.floor(D / 7));
  for (let i = 0; i < teeth; i++) {
    const z0 = -D / 2 + (i * D) / teeth;
    const td = D / teeth;
    const slope = new THREE.BoxGeometry(td * 0.95, 0.28, W);
    slope.rotateX(-0.55);
    slope.translate(D / 2 - z0 - td / 2, 0.6 + H + 1.5, 0);
    parts.push(paint(slope, C.tile));
    // The glazed north face of each tooth.
    parts.push(box(0.2, 1.9, W - 0.4, D / 2 - z0 - 0.3, 0.6 + H + 0.9, 0, C.industrialGlass));
  }
  // Parapet band.
  parts.push(box(D + 0.4, 0.4, W + 0.4, D / 2, 0.6 + H + 0.2, 0, C.redBrickLo));

  // 工业钢窗: tall multi-pane steel windows in each bay.
  const glassMat = new THREE.MeshStandardMaterial({
    color: C.industrialGlass,
    emissive: 0xffc27a,
    emissiveIntensity: 0.12,
    roughness: 0.35,
    metalness: 0.45,
  });
  for (let i = 0; i < bays; i++) {
    const bz = -halfW + ((i + 0.5) * W) / bays;
    const ww = Math.min(2.6, W / bays - 1.2);
    const wh = Math.min(3.2, H * 0.42);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), glassMat);
    pane.position.set(-0.05, 0.6 + H * 0.55, bz);
    pane.rotation.y = -Math.PI / 2;
    g.add(pane);
    // Muntin grid so it reads as an industrial window, not a hole.
    const gridMat = new THREE.MeshStandardMaterial({ color: C.steelBlack });
    for (let c = 1; c < 3; c++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, wh, 0.05), gridMat);
      bar.position.set(-0.09, 0.6 + H * 0.55, bz - ww / 2 + (c * ww) / 3);
      g.add(bar);
    }
    for (let c = 1; c < 4; c++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, ww), gridMat);
      bar.position.set(-0.09, 0.6 + H * 0.55 - wh / 2 + (c * wh) / 4, bz);
      g.add(bar);
    }
  }

  // 安全黄 external steel staircase — the loudest colour on the whole block.
  const yellow = C.safetyYellow;
  const sx = -halfW + 2.2;
  const stRuns = 3;
  for (let i = 0; i < stRuns; i++) {
    const y = 1.0 + i * 2.4;
    const flight = new THREE.BoxGeometry(2.0, 0.14, 1.5);
    flight.rotateX(-0.72);
    flight.translate(-1.1, y, sx + i * 3.0);
    parts.push(paint(flight, yellow));
    // Railing on the outer edge.
    const rail = new THREE.BoxGeometry(0.08, 0.08, 3.2);
    rail.rotateX(-0.72);
    rail.translate(-2.0, y + 0.95, sx + i * 3.0);
    parts.push(paint(rail, yellow));
  }
  parts.push(box(0.12, 0.12, 9.4, -2.0, 3.9, sx + 3.0, yellow));

  // Burgundy accent panel + a flat entrance canopy.
  parts.push(box(0.25, 2.6, Math.min(6, W - 3), -0.1, 1.9, halfW - 3.2, C.burgundy));
  const canopy = new THREE.BoxGeometry(2.6, 0.18, 6);
  canopy.rotateZ(-0.08);
  canopy.translate(1.2, 3.7, halfW - 3.2);
  parts.push(paint(canopy, C.steelBlack));

  const mass = new THREE.Mesh(
    merge(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.08 }),
  );
  mass.castShadow = true;
  mass.receiveShadow = true;
  g.add(mass);

  g.position.set(b.cx, 0, b.cz);
  return g;
}

// ── 榕树 banyan ─────────────────────────────────────────────────────────────

/**
 * 榕树 — the reason Nanning is called 半城绿树半城楼. A gta7 cone tree next to a
 * real one is an insult, so this gets a broad umbrella canopy, buttressed roots
 * and a few aerial root strands.
 */
export function makeBanyanGeometry(): { geo: THREE.BufferGeometry; mats: THREE.Material[] } {
  const parts: THREE.BufferGeometry[] = [];
  const bark = paint(new THREE.CylinderGeometry(0.34, 0.55, 3.2, 8), 0x5b4b3a);
  bark.translate(0, 1.6, 0);
  parts.push(bark);
  // Buttress roots flaring at the base — the tell of an old banyan.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const root = new THREE.BoxGeometry(0.22, 1.5, 0.7);
    root.translate(0, 0.55, 0.55);
    root.rotateX(-0.5);
    root.rotateY(a);
    parts.push(paint(root, 0x50412f));
  }
  // Broad umbrella canopy: overlapping spheres, flattened.
  let s = 41;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const greens = [0x2f5a34, 0x37663a, 0x284c2d, 0x3d7041];
  for (let i = 0; i < 7; i++) {
    const r = 1.5 + rnd() * 1.5;
    const c = new THREE.SphereGeometry(r, 7, 5);
    c.scale(1, 0.62, 1);
    c.translate((rnd() - 0.5) * 3.2, 3.5 + rnd() * 1.7, (rnd() - 0.5) * 3.2);
    parts.push(paint(c, greens[i % greens.length]));
  }
  // Aerial roots hanging out of the canopy.
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2;
    const len = 1.0 + rnd() * 1.4;
    const root = new THREE.CylinderGeometry(0.05, 0.03, len, 4);
    root.translate(Math.cos(a) * (1.2 + rnd()), 3.4 - len / 2, Math.sin(a) * (1.2 + rnd()));
    parts.push(paint(root, 0x6b5a44));
  }
  return { geo: merge(parts), mats: [new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })] };
}
